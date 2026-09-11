import {afterEach,expect,test} from 'vitest';
import {GameWorld,BUTTON} from './world.mjs';
import {castBossMove,spawnHazard} from './boss-attacks.mjs';
import {BOSS_MOVES,nextBossMove} from '../content/boss-moves.mjs';
import {BOSSES} from '../content/catalog.mjs';
import {heightAt} from '../world/regions.mjs';
import {BoxShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/BoxShape3D.js';
import {BodyKind} from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import {animationPlan,actorJointPoses,rigs} from './animation.mjs';
const worlds=[],x=180,z=100,ground=(x,z,offset=.12)=>[x,heightAt(x,z)+offset,z];
async function setup(archetype='warden'){
  const w=await new GameWorld().start({populate:false,navigation:false});worlds.push(w);
  const p=w.addPlayer('target');w.teleport(p,ground(x+5,z,.86));
  const b=w.spawnActor('keeper',{boss:true,archetype,hp:BOSSES[archetype].health,healthMax:BOSSES[archetype].health,weapon:'spear'},ground(x,z,1.28));
  w.think=()=>{};for(let i=0;i<90;i++)w.step();
  return {w,p,b};
}
afterEach(async()=>{for(const w of worlds)await w.stop();worlds.length=0;});
const project=(w,n)=>{for(let i=0;i<n;i++)w.step();};

test('a swept bell wave hits once, waits for its delay and respects native wall cover',async()=>{
  const {w,p,b}=await setup(),hp=p.hp;
  spawnHazard(w,b,'wave',ground(x,z),{delay:.5,life:2.5,speed:8,maxRadius:12});
  project(w,30);expect(p.hp).toBe(hp);project(w,45);expect(p.hp).toBeLessThan(hp);
  const after=p.hp;project(w,70);expect(p.hp).toBe(after);
  w.body(ground(x+2.5,z,1.5),BoxShape3D.from(.3,3,3),BodyKind.Static);
  spawnHazard(w,b,'wave',ground(x,z),{speed:8,maxRadius:12,life:2});project(w,120);expect(p.hp).toBe(after);
});

test('a physical jump clears the low bell wave',async()=>{
  const {w,p,b}=await setup();w.think=()=>{};
  for(let i=0;i<50;i++)w.step();const hp=p.hp;
  w.input(p.id,{x:0,z:0,yaw:0,buttons:BUTTON.JUMP});w.step();w.input(p.id,{x:0,z:0,yaw:0,buttons:0});
  spawnHazard(w,b,'wave',ground(x,z),{speed:8,maxRadius:12,life:2});
  let peak=0;for(let i=0;i<100;i++){w.step();peak=Math.max(peak,p.y-heightAt(p.x,p.z)-.845);}
  expect(peak).toBeGreaterThan(1.2);expect(p.hp).toBe(hp);
});

test('root traps lock their position, allow escape, and retain their hit ledger across snapshot replay',async()=>{
  const {w,p,b}=await setup('rootbound');castBossMove(w,b,'roots');
  const before=w.snapshot(),trap=before.projectiles[0],hp=p.hp;expect(trap.position[0]).toBe(p.x);
  project(w,60);expect(p.hp).toBe(hp);w.teleport(p,ground(x+11,z,.86));project(w,40);expect(p.hp).toBe(hp);
  w.replaceSnapshot(before);project(w,86);expect(p.hp).toBeLessThan(hp);const after=p.hp,state=w.snapshot();
  expect(state.projectiles[0].hitIds).toContain(p.id);w.replaceSnapshot(state);project(w,10);expect(p.hp).toBe(after);expect(w.snapshot().projectiles[0].key).toBe(trap.key);
});

test('boss defeat clears casts immediately and the encounter stays active while a late participant lives',async()=>{
  const {w,p,b}=await setup();b.active=true;b.hp=40;
  const late=w.addPlayer('late');w.teleport(late,ground(x+10,z,.86));castBossMove(w,b,'judgment');
  p.hp=0;w.checkEncounters();expect(b.hp).toBe(40);expect(w.projectiles.size).toBe(5);
  const joined=w.snapshot(),copy=await new GameWorld().start({populate:false,navigation:false});worlds.push(copy);copy.replaceSnapshot(joined);
  expect(copy.snapshot().projectiles.map(p=>p.key)).toEqual(joined.projectiles.map(p=>p.key));
  late.hp=0;w.checkEncounters();expect(b.returning).toBe(true);expect(b.hp).toBe(40);expect(w.projectiles.size).toBe(0);expect(b.attackId).toBeGreaterThan(0);
  late.hp=late.healthMax;w.syncActorCollider(late);castBossMove(w,b,'cinders');expect(w.projectiles.size).toBeGreaterThan(0);
  w.damage(late,b,10000,0);expect(w.projectiles.size).toBe(0);
});

test.each(Object.keys(BOSSES))('%s has a distinct spell pattern, a stronger second phase and a complete planted cast animation',async archetype=>{
  const {w,p,b}=await setup(archetype);b.grounded=true;
  const first=Array.from({length:4},(_,i)=>{b.attackId=i;return nextBossMove(b);});b.hp=b.healthMax*.5;
  const second=Array.from({length:4},(_,i)=>{b.attackId=i;return nextBossMove(b);});expect(second).not.toEqual(first);
  const move=first.find(id=>id!=='weapon'),def=BOSS_MOVES[move];b.bossMove=move;b.attackKind='ritual';b.attackAge=-1;b.windup=.01;
  expect(animationPlan(b).find(p=>p.name===def.clip).time).toBeCloseTo(def.windup-.01);
  const before=actorJointPoses(b);b.windup=0;b.attackAge=0;const after=actorJointPoses(b);
  for(const foot of ['footL','footR']){const i=rigs.pilgrim.bones.findIndex(b=>b.name===foot);expect(Math.hypot(...before[i].position.map((v,j)=>v-after[i].position[j]))).toBeLessThan(.03);}
  b.attackAge=-1;b.windup=.001;b.targetId=p.id;w.mind.tick(b,1/60);
  expect(b.attackKind).toBe('ritual');expect(b.attackAge).toBe(0);expect(w.projectiles.size).toBeGreaterThan(0);
  const beforeAdvance=w.projectiles.size;w.advanceAttack(b,.3);expect(w.projectiles.size).toBe(beforeAdvance);
});
