import {expect,test,vi} from 'vitest';
import {Actor} from './components.mjs';
import {attackTrajectory,selectMeleeAttack} from './melee-selection.mjs';
import {MELEE_ATTACKS} from '../content/melee-attacks.mjs';
import {WEAPONS} from '../content/catalog.mjs';
import {actorFeet,actorScale,rigs} from './animation.mjs';
import {weaponPose} from './weapon-pose.mjs';

const fighter=(values={})=>Object.assign(new Actor(),{id:'player',kind:'player',y:.845,grounded:true},values);
const enemy=(values={})=>fighter({id:'target',kind:'enemy',z:-1.5,...values});
const centre=a=>[a.x,actorFeet(a)[1]+(a.archetype==='hound'?.65:a.crouch?.6:1.05)*actorScale(a),a.z];
function bladeDistance(actor,clip,point){
  const [start,end]=WEAPONS[actor.weapon].active;let closest=Infinity;
  for(let i=0;i<=100;i++){
    const {start:from,end:to}=weaponPose({...actor,attackVariant:clip},start+(end-start)*i/100),d=to.map((v,j)=>v-from[j]);
    const t=Math.max(0,Math.min(1,point.reduce((sum,v,j)=>sum+(v-from[j])*d[j],0)/d.reduce((sum,v)=>sum+v*v,0)));
    closest=Math.min(closest,Math.hypot(...point.map((v,j)=>v-from[j]-d[j]*t)));
  }
  return closest;
}

test.each(Object.keys(MELEE_ATTACKS))('%s variants have authored clips and conservative boxes containing their actual blade travel',weapon=>{
  for(const crouch of [false,true])for(const clip of MELEE_ATTACKS[weapon]){
    expect(rigs.pilgrim.clips[clip]).toBeDefined();
    const actor=fighter({weapon,crouch,y:crouch?.495:.845,attackVariant:clip}),boxes=attackTrajectory(weapon,clip,crouch),[start,end]=WEAPONS[weapon].active;
    expect(boxes).toHaveLength(8);
    for(let i=0;i<boxes.length;i++)for(let sample=0;sample<=16;sample++){
      const box=boxes[i],pose=weaponPose(actor,start+(end-start)*(i+sample/16)/boxes.length);
      for(const point of [pose.start,pose.end])for(let axis=0;axis<3;axis++){
        expect(point[axis],`${clip} interval ${i}, axis ${axis}`).toBeGreaterThanOrEqual(box.min[axis]);
        expect(point[axis],`${clip} interval ${i}, axis ${axis}`).toBeLessThanOrEqual(box.max[axis]);
      }
    }
  }
});

test.each(Object.keys(MELEE_ATTACKS))('%s selects blade paths that reach hounds and enemies below or above the player',weapon=>{
  for(const target of [enemy({archetype:'hound'}),enemy({y:.345}),enemy({y:1.495})])for(let attackId=0;attackId<4;attackId++){
    const actor=fighter({weapon,attackId}),clip=selectMeleeAttack(actor,[target]),radius=target.archetype==='hound'?.3:.36;
    expect(bladeDistance(actor,clip,centre(target)),`${clip} reaching ${target.archetype} at ${target.y}`).toBeLessThan(radius+.11);
  }
});

test.each(Object.keys(MELEE_ATTACKS))('%s selection follows translated, turned and enlarged actors',weapon=>{
  const target=enemy({y:1.495}),ordinary=fighter({weapon}),expected=selectMeleeAttack(ordinary,[target]);
  for(const boss of [false,true])for(const yaw of [.7,-1.8,Math.PI]){
    const scale=boss?1.85:1,base=12,c=Math.cos(yaw),s=Math.sin(yaw);
    const actor=fighter({weapon,boss,yaw,x:40,y:base+(boss?1.2675:.845),z:70});
    const transformed=enemy({boss,x:40+c*target.x*scale+s*target.z*scale,z:70-s*target.x*scale+c*target.z*scale,y:base+(target.y-.845)*scale+(boss?1.2675:.845)});
    expect(selectMeleeAttack(actor,[transformed])).toBe(expected);
  }
});

test.each(Object.keys(MELEE_ATTACKS))('%s changes trajectory for the same enemy when either actor changes elevation',weapon=>{
  const actor=fighter({weapon}),target=enemy(),clips=[];
  for(const rise of [-.5,.65]){
    // These are the same relative arrangement: target on a ledge versus player
    // in a hollow, or target below a ledge versus player on higher ground.
    const movedTarget={...target,y:target.y+rise},movedActor={...actor,y:actor.y-rise};
    const clip=selectMeleeAttack(actor,[movedTarget]);clips.push(clip);
    expect(selectMeleeAttack(movedActor,[target])).toBe(clip);
    expect(bladeDistance(actor,clip,centre(movedTarget))).toBeLessThan(.47);
    expect(bladeDistance(movedActor,clip,centre(target))).toBeLessThan(.47);
  }
  expect(clips[0]).not.toBe(clips[1]);
  expect(clips[1]).toBe(weapon+'_high');
});

test.each(Object.keys(MELEE_ATTACKS))('%s can choose a high swing for the same hound on a ledge',weapon=>{
  const actor=fighter({weapon}),hound=enemy({archetype:'hound'}),raised={...hound,y:hound.y+1};
  const groundClip=selectMeleeAttack(actor,[hound]),ledgeClip=selectMeleeAttack(actor,[raised]);
  expect(groundClip).not.toBe(ledgeClip);expect(ledgeClip).toBe(weapon+'_high');
  expect(bladeDistance(actor,groundClip,centre(hound))).toBeLessThan(.41);
  expect(bladeDistance(actor,ledgeClip,centre(raised))).toBeLessThan(.41);
});

test.each(Object.keys(MELEE_ATTACKS))('%s elevation and camera choices are invariant when the whole encounter changes altitude',weapon=>{
  const low=enemy({id:'low',x:.2,y:.345}),high=enemy({id:'high',x:-.5,y:1.495});
  for(let attackId=0;attackId<4;attackId++)for(const pitch of [.8,-.5]){
    const actor=fighter({weapon,attackId,intent:{pitch}}),targets=[low,high];
    const expected=selectMeleeAttack(actor,targets),intended=pitch>0?low:high;
    expect(expected).toBe(selectMeleeAttack(actor,[intended]));
    expect(bladeDistance(actor,expected,centre(intended))).toBeLessThan(.47);
    for(const altitude of [-120,35,450]){
      const shiftedActor={...actor,y:actor.y+altitude},shiftedTargets=targets.map(t=>({...t,y:t.y+altitude}));
      expect(selectMeleeAttack(shiftedActor,shiftedTargets)).toBe(expected);
      expect(selectMeleeAttack(shiftedActor,shiftedTargets.reverse())).toBe(expected);
    }
  }
});

test.each(Object.keys(MELEE_ATTACKS))('%s ignores dead, allied, distant, behind and occluded targets',weapon=>{
  const actor=fighter({weapon}),target=enemy({y:1.495}),expected=selectMeleeAttack(actor,[target]);
  const ignored=[enemy({id:'dead',hp:0}),enemy({id:'friend',kind:'player'}),enemy({id:'far',z:-20}),enemy({id:'behind',z:1}),enemy({id:'occluded',archetype:'hound'})];
  const visible=vi.fn(t=>t.id!=='occluded');
  expect(selectMeleeAttack(actor,[...ignored,target],visible)).toBe(expected);
  expect(visible.mock.calls.some(([t])=>['dead','friend','far','behind'].includes(t.id))).toBe(false);
  expect(selectMeleeAttack(actor,ignored,visible)).toBe(selectMeleeAttack(actor,[]));
});

test.each(Object.keys(MELEE_ATTACKS))('%s prioritizes the front target and changes height with camera intent',weapon=>{
  const actor=fighter({weapon}),low=enemy({id:'low',x:.2,y:.345}),high=enemy({id:'high',x:-.5,y:1.495});
  const lowClip=selectMeleeAttack(actor,[low]),highClip=selectMeleeAttack(actor,[high]);
  expect(lowClip).not.toBe(highClip);
  for(const targets of [[low,high],[high,low]]){
    // With level camera aim, the elevated body is closest to screen centre.
    expect(selectMeleeAttack(actor,targets)).toBe(highClip);
    expect(selectMeleeAttack({...actor,intent:{pitch:.8}},targets)).toBe(lowClip);
    expect(selectMeleeAttack({...actor,intent:{pitch:-.5}},targets)).toBe(highClip);
  }
});

test.each(Object.keys(MELEE_ATTACKS))('%s varies repeated unconstrained attacks without repeating the previous clip',weapon=>{
  const actor=fighter({weapon}),chosen=[];
  for(let i=0;i<12;i++){
    const next=selectMeleeAttack(actor,[]);expect(next).not.toBe(actor.attackVariant);
    chosen.push(next);actor.attackVariant=next;actor.attackId++;
  }
  expect(new Set(chosen)).toEqual(new Set(MELEE_ATTACKS[weapon]));
});

test('ranged weapons and the hound bite keep their own animations',()=>{
  for(const actor of [fighter({weapon:'staff'}),fighter({weapon:'bow'}),fighter({archetype:'hound'})])expect(selectMeleeAttack(actor,[enemy()])).toBe(actor.weapon);
});
