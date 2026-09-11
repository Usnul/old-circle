import {expect,test,vi} from 'vitest';
import {WorldFootsteps,footstepScreenArea} from './footsteps.mjs';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Decal} from '@woosh/meep-engine/src/engine/graphics/ecs/decal/v2/Decal.js';
import {sort_decals_by_priority} from '@woosh/meep-engine/src/engine/graphics3/decal/decal_gpu_records.js';
import {ParticleEffect} from '@woosh/meep-engine/src/engine/graphics/ecs/particles/ParticleEffect.js';
import {PerspectiveCamera} from '@woosh/meep-engine/src/shade/renderer/camera/PerspectiveCamera.js';
import {t64_look_rotation} from '@woosh/meep-engine/src/engine/ecs/transform/t64_look_rotation.js';
import {Actor} from '@old-circle/game/simulation/components.mjs';
import {GameWorld} from '@old-circle/game/simulation/world.mjs';
import {FOOTSTEP_EFFECTS} from './effects.mjs';

function fixture(camera){
  const ecd=new EntityComponentDataset();for(const c of [Transform64,Decal,ParticleEffect])ecd.registerComponentType(c);
  const view={ecd,transients:[],ground:{surfaceMixAt:vi.fn(()=>[{surface:'snow',weight:1}])},audio:{footstep:vi.fn()},particles:{burst:vi.fn()},queryFootSurfaces:vi.fn()};
  if(camera)view.engine={graphics:{camera:{camera}}};
  return {view,feet:new WorldFootsteps(view)};
}
function lens(){
  const c=new PerspectiveCamera();c.fov=57*Math.PI/180;c.aspect=16/9;c.near=.12;
  c.transform.setTranslation(0,1,0);t64_look_rotation(c.transform,0,0,-1,0,1,0);c.update();return c;
}
const walker=(id='walker',z=-5,boss=false)=>Object.assign(new Actor(),{id,x:0,y:boss?1.2675:.845,z,boss,grounded:true,vz:-2});
const foot={name:'footL',scale:1,hound:false,heading:[0,0,-1]};
const hit={surface:'terrain',position:[0,0,-5],normal:[0,1,0]};

test('native footprint projectors face into slopes, fade, unlink and reuse bounded entities',()=>{
  const ecd=new EntityComponentDataset();for(const c of [Transform64,Decal])ecd.registerComponentType(c);
  const view={ecd,transients:[],ground:{surfaceMixAt:()=>[{surface:'snow',weight:1}]},audio:{footstep(){}},particles:{burst(){}},emitter(){this.transients.push({});return {id:0};}},feet=new WorldFootsteps(view);
  const actor={id:'walker',vx:0,vz:2},foot={name:'footL',scale:1,hound:false,heading:[0,0,-1]},normal=[.3,Math.sqrt(.91),0],hit={surface:'terrain',position:[2,4,8],normal};
  feet.contact(actor,foot,hit,0);const first=feet.pool[0],m=first.t.matrix;
  expect(normal.reduce((sum,v,i)=>sum+v*m[8+i]/Math.hypot(m[8],m[9],m[10]),0)).toBeCloseTo(-1,5);
  // Low V in the shipped boot mask is the toe: local -Y follows the heading.
  expect(foot.heading.reduce((sum,v,i)=>sum+v*m[4+i]/Math.hypot(m[4],m[5],m[6]),0)).toBeCloseTo(-1,5);
  expect(ecd.getComponent(first.id,Decal)).toBe(first.decal);
  feet.update([],actor.id,0,17,17);expect(first.decal.color.a).toBeGreaterThan(0);expect(first.decal.color.a).toBeLessThan(first.alpha);
  feet.update([],actor.id,0,19,2);expect(ecd.getComponent(first.id,Decal)).toBeUndefined();
  feet.contact(actor,foot,hit,20);expect(feet.pool[0]).toBe(first);expect(first.decal.color.a).toBe(first.alpha);
  for(let i=0;i<180;i++)feet.contact(actor,{...foot,hound:i%2===0},hit,21+i*.01);
  expect(feet.pool.length).toBeLessThanOrEqual(128);
  feet.update([],actor.id,0,22,.01);feet.update([],actor.id,0,23,1);
  expect(feet.pool.filter(m=>m.active).length).toBeLessThanOrEqual(88);
  feet.update([],actor.id,0,45,22);expect(feet.pool.every(m=>!m.active&&ecd.getComponent(m.id,Decal)===undefined)).toBe(true);
});

test('screen projection keeps large enemies farther away, rejects offscreen spheres and handles the eye plane',()=>{
  const camera=lens();
  expect(footstepScreenArea(walker('near',-20),camera)).toBeGreaterThan(0);
  expect(footstepScreenArea(walker('far',-38),camera)).toBe(0);
  expect(footstepScreenArea(walker('keeper',-38,true),camera)).toBeGreaterThan(0);
  expect(footstepScreenArea(walker('far-keeper',-70,true),camera)).toBe(0);
  expect(footstepScreenArea(walker('behind',10),camera)).toBe(0);
  expect(footstepScreenArea({...walker(),x:50},camera)).toBe(0);
  expect(footstepScreenArea(walker('eye',-.95),camera)).toBe(1);
  const ordinary=footstepScreenArea({...walker('a',-20),y:.895},camera);
  const enlarged=footstepScreenArea({...walker('b',-37,true),y:1.36},camera);
  expect(enlarged).toBeCloseTo(ordinary,5);
  camera.fov=90*Math.PI/180;camera.update();
  expect(footstepScreenArea(walker('wide-lens',-25),camera)).toBe(0);
});

test('worker budget prioritizes the player and visible keepers, while offscreen nearby feet retain sound only',()=>{
  const {view,feet}=fixture(lens()),player=walker('player',3),keeper=walker('keeper',-38,true);
  const crowd=Array.from({length:24},(_,i)=>walker('crowd-'+i,-10-i*.1));
  feet.update([...crowd,keeper,walker('invisible',-80),player],'player',1,1,.016);
  expect(feet.pending.feet.length).toBe(32);expect(feet.pending.feet[0].actor.id).toBe('player');
  expect(feet.pending.feet.some(f=>f.actor.id==='invisible')).toBe(false);
  feet.update([player,keeper],'player',1,1.2,.016);
  expect(feet.pending.feet.some(f=>f.actor.id==='keeper')).toBe(true);
  const behind=walker('audible',8);feet.contact(behind,foot,hit,1.2);
  expect(view.audio.footstep).toHaveBeenCalled();expect(view.transients).toHaveLength(0);expect(feet.pool).toHaveLength(0);
  feet.contact(player,foot,hit,1.2);expect(view.transients).toHaveLength(1);expect(feet.pool).toHaveLength(1);
});

test.each(['grass','gravel','sand','snow','stone','wood','unknown'])('%s contact uses the underfoot material, lit debris and a finite slope projector',surface=>{
  const {view,feet}=fixture(),a=walker(),normal=[.3,Math.sqrt(.91),0],selected=surface==='unknown'?'stone':surface;
  view.ground.surfaceMixAt.mockReturnValue([{surface:selected,weight:1}]);
  feet.contact(a,{...foot,heading:normal},{...hit,normal,...(surface==='unknown'?{surface}:{})},0);
  const transient=view.transients[0],p=FOOTSTEP_EFFECTS['step-'+selected];
  expect(transient.c.texture).toBe(`/assets/vfx/${p.texture}.png`);
  expect(view.audio.footstep.mock.calls[0][3]).toBe(selected);
  const t=view.ecd.getComponent(transient.id,Transform64);
  for(let i=0;i<3;i++)expect(t.matrix[4+i]).toBeCloseTo(normal[i],6);
  expect(Array.from(feet.pool[0].t.matrix).every(Number.isFinite)).toBe(true);
  expect(transient.life).toBeGreaterThan(p.life);
  const soft=['grass','gravel','sand','snow'].includes(selected),decal=feet.pool[0].decal,texture=selected==='grass'?'grass':soft?'imprint':'print';
  expect(decal.uri_albedo).toBe(`/assets/vfx/boot-${texture}.png`);
  expect(decal.uri_normal).toBe(soft?`/assets/vfx/boot-${texture}-normal.png`:'');
  // A raised wooden floor wins over the terrain biome below it.
  view.ground.surfaceMixAt.mockClear();
  feet.contact(a,foot,{...hit,surface:'wood'},1);
  expect(view.ground.surfaceMixAt).not.toHaveBeenCalled();
  expect(view.audio.footstep.mock.calls.at(-1)[3]).toBe('wood');
});

test.each([false,true])('pooled %s footprints switch relief off on hard floors and restore it on soft ground',hound=>{
  const {feet}=fixture(),a=walker(),f={...foot,hound};
  feet.contact(a,f,{...hit,surface:'grass'},0);const mark=feet.pool[0],shape=hound?'paw':'boot';
  expect(mark.decal.uri_normal).toBe(`/assets/vfx/${shape}-grass-normal.png`);
  feet.update([],a.id,1,8,8);feet.contact(a,f,{...hit,surface:'wood'},8);
  expect(feet.pool[0]).toBe(mark);expect(mark.decal.uri_normal).toBe('');
  expect(mark.decal.uri_albedo).toBe(`/assets/vfx/${shape}-print.png`);
  feet.update([],a.id,1,12,4);feet.contact(a,f,{...hit,surface:'snow'},12);
  expect(feet.pool[0]).toBe(mark);expect(mark.decal.uri_normal).toBe(`/assets/vfx/${shape}-imprint-normal.png`);
  expect(mark.decal.uri_albedo).toBe(`/assets/vfx/${shape}-imprint.png`);
});

test('a grass and gravel contact shares debris counts, decal coverage and lifetime at the same slope contact',()=>{
  const {feet,view}=fixture(),a=walker(),normal=[.3,Math.sqrt(.91),0],contact={...hit,normal};
  view.ground.surfaceMixAt.mockReturnValue([{surface:'grass',weight:.6},{surface:'gravel',weight:.4}]);
  feet.contact(a,foot,contact,0);
  expect(view.ground.surfaceMixAt).toHaveBeenCalledWith(hit.position[0],hit.position[2]);
  expect(view.audio.footstep).toHaveBeenCalledTimes(1);expect(view.audio.footstep.mock.calls[0][3]).toBe('grass');
  expect(view.transients.map(t=>t.c.texture)).toEqual(['/assets/vfx/step-leaf.png','/assets/vfx/step-grit.png']);
  expect(view.particles.burst.mock.calls).toEqual(view.transients.map(t=>[t.id,2]));
  expect(feet.pool).toHaveLength(2);
  const [grass,gravel]=feet.pool;
  expect(grass.decal.uri_albedo).toBe('/assets/vfx/boot-grass.png');expect(gravel.decal.uri_albedo).toBe('/assets/vfx/boot-imprint.png');
  expect(grass.decal.color.a).toBeCloseTo(.72*.6,10);expect(gravel.decal.color.a).toBeCloseTo(.65*.4,10);
  expect(grass.life).toBeCloseTo(.6*7+.4*10,10);expect(gravel.life).toBe(grass.life);
  expect(grass.stamp).toBe(gravel.stamp);
  expect(Array.from(grass.t.matrix)).toEqual(Array.from(gravel.t.matrix));
  const emitters=view.transients.map(t=>view.ecd.getComponent(t.id,Transform64));
  expect(Array.from(emitters[0].matrix)).toEqual(Array.from(emitters[1].matrix));
  for(let i=0;i<3;i++){
    expect(grass.t.matrix[12+i]).toBeCloseTo(hit.position[i]+normal[i]*.018,8);
    expect(grass.t.matrix[8+i]/.16).toBeCloseTo(-normal[i],8);
    expect(emitters[0].matrix[4+i]).toBeCloseTo(normal[i],8);
    expect(emitters[0].matrix[12+i]).toBeCloseTo(hit.position[i]+normal[i]*.045,8);
  }
});

test('blended decals retain material draw order when the dominant ground material swaps',()=>{
  const {feet,view}=fixture(),a=walker();
  view.ground.surfaceMixAt.mockReturnValue([{surface:'grass',weight:.6},{surface:'gravel',weight:.4}]);
  feet.contact(a,foot,hit,0);const first=[...feet.pool];
  view.ground.surfaceMixAt.mockReturnValue([{surface:'gravel',weight:.6},{surface:'grass',weight:.4}]);
  feet.contact(a,foot,hit,.3);const second=feet.pool.slice(2);
  // Meep composites source-over in this order, so a priority tie would cause a seam.
  const drawOrder=marks=>sort_decals_by_priority([...marks]).map(m=>m.decal.uri_albedo);
  expect(drawOrder(first)).toEqual(drawOrder(second));
  expect(new Set(first.map(m=>m.decal.priority)).size).toBe(2);
});

test('mixed debris rounds the shared particle budget once, preserving both material sprites',()=>{
  const {feet,view}=fixture();
  view.ground.surfaceMixAt.mockReturnValue([{surface:'gravel',weight:.5},{surface:'snow',weight:.5}]);
  feet.contact(walker(),foot,hit,0);
  expect(view.transients.map(t=>t.c.texture)).toEqual(['/assets/vfx/step-grit.png','/assets/vfx/step-dust.png']);
  const counts=view.particles.burst.mock.calls.map(([,count])=>count);
  expect(counts.every(count=>Number.isInteger(count)&&count>0)).toBe(true);
  expect(counts.reduce((sum,count)=>sum+count,0)).toBe(5);
});

test.each([false,true])('blended %s prints fade and unlink together, then both slots can become flat wood scuffs',hound=>{
  const {feet,view}=fixture(),a=walker(),f={...foot,hound},shape=hound?'paw':'boot';
  view.ground.surfaceMixAt.mockReturnValue([{surface:'grass',weight:.6},{surface:'gravel',weight:.4}]);
  feet.contact(a,f,hit,0);const marks=[...feet.pool],life=marks[0].life;
  expect(marks.map(m=>m.decal.uri_normal)).toEqual([`/assets/vfx/${shape}-grass-normal.png`,`/assets/vfx/${shape}-imprint-normal.png`]);
  feet.update([],a.id,1,life-1,life-1);
  for(const mark of marks){expect(mark.decal.color.a).toBeCloseTo(mark.alpha*.5,10);expect(view.ecd.getComponent(mark.id,Decal)).toBe(mark.decal);}
  feet.update([],a.id,1,life+.1,1.1);
  for(const mark of marks){expect(mark.active).toBe(false);expect(mark.decal.color.a).toBe(0);expect(view.ecd.getComponent(mark.id,Decal)).toBeUndefined();}
  view.ground.surfaceMixAt.mockClear();
  feet.contact(a,f,{...hit,surface:'wood'},life+.2);feet.contact(a,f,{...hit,surface:'wood'},life+.3);
  expect(view.ground.surfaceMixAt).not.toHaveBeenCalled();expect(feet.pool).toEqual(marks);
  for(const mark of marks){expect(mark.active).toBe(true);expect(mark.decal.uri_normal).toBe('');expect(mark.decal.uri_albedo).toBe(`/assets/vfx/${shape}-print.png`);expect(mark.decal.color.a).toBe(.24);}
});

test('mixed contacts count actual particle components and reserve four complete pairs for the player',()=>{
  const {feet,view}=fixture();feet.playerId='player';
  view.ground.surfaceMixAt.mockReturnValue([{surface:'grass',weight:.6},{surface:'gravel',weight:.4}]);
  for(let i=0;i<30;i++)feet.contact(walker('npc'),foot,hit,0);
  expect(view.transients).toHaveLength(24);expect(view.particles.burst).toHaveBeenCalledTimes(24);
  for(let i=0;i<10;i++)feet.contact(walker('player'),foot,hit,0);
  expect(view.transients).toHaveLength(32);expect(view.particles.burst).toHaveBeenCalledTimes(32);
  for(const transient of view.transients)expect(view.ecd.getComponent(transient.id,ParticleEffect)).toBe(transient.c);
});

test.each([false,true])('mixed %s decal pairs respect component caps and preserve four complete player contacts',hound=>{
  const {feet,view}=fixture(),f={...foot,hound};feet.playerId='player';
  view.ground.surfaceMixAt.mockReturnValue([{surface:'grass',weight:.6},{surface:'gravel',weight:.4}]);
  for(let i=0;i<50;i++)feet.contact(walker('npc'),f,hit,0);
  expect(feet.pool).toHaveLength(56);expect(new Set(feet.pool.map(m=>m.stamp)).size).toBe(28);
  for(let i=0;i<10;i++)feet.contact(walker('player'),f,hit,0);
  expect(feet.pool).toHaveLength(64);expect(new Set(feet.pool.map(m=>m.stamp)).size).toBe(32);
  for(const mark of feet.pool)expect(view.ecd.getComponent(mark.id,Decal)).toBe(mark.decal);
});

test('a remaining single budget slot never emits half a blended contact',()=>{
  const {feet,view}=fixture();feet.playerId='player';
  for(let i=0;i<55;i++)feet.contact(walker('npc'),foot,{...hit,surface:'stone'},0);
  // Reach an odd particle count as well, independently of the larger decal pool.
  const removed=view.transients.pop();view.ecd.removeEntity(removed.id);
  expect(view.transients).toHaveLength(23);expect(feet.pool).toHaveLength(55);
  view.ground.surfaceMixAt.mockReturnValue([{surface:'grass',weight:.6},{surface:'gravel',weight:.4}]);
  const bursts=view.particles.burst.mock.calls.length;
  feet.contact(walker('npc'),foot,hit,0);
  expect(view.transients).toHaveLength(23);expect(view.particles.burst).toHaveBeenCalledTimes(bursts);expect(feet.pool).toHaveLength(55);
  feet.contact(walker('player'),foot,hit,0);
  expect(view.transients).toHaveLength(25);expect(feet.pool).toHaveLength(57);
});

test('crowd fade retires both layers when the cutoff lands inside the oldest blended contact',()=>{
  const {feet,view}=fixture(),a=walker();
  view.ground.surfaceMixAt.mockReturnValue([{surface:'grass',weight:.6},{surface:'gravel',weight:.4}]);
  feet.contact(a,foot,hit,0);const pair=[...feet.pool];
  feet.update([],a.id,1,.1,.1);
  for(let i=0;i<43;i++)feet.contact(a,foot,{...hit,surface:'snow'},.1);
  expect(feet.pool).toHaveLength(45);
  feet.update([],a.id,1,.2,.1);
  expect(pair[0].life).toBe(pair[1].life);expect(pair[0].life).toBeCloseTo(.8,10);
  feet.update([],a.id,1,.4,.2);
  expect(pair[0].decal.color.a/pair[0].alpha).toBeCloseTo(pair[1].decal.color.a/pair[1].alpha,10);
  feet.update([],a.id,1,.9,.5);
  for(const mark of pair){expect(mark.active).toBe(false);expect(view.ecd.getComponent(mark.id,Decal)).toBeUndefined();}
  expect(feet.pool.filter(m=>m.active)).toHaveLength(43);
});

test('crowd particles leave a reserve for the player and all emission remains bounded',()=>{
  const {view,feet}=fixture();feet.playerId='player';
  for(let i=0;i<40;i++)feet.contact(walker('npc'),foot,hit,0);
  expect(view.transients).toHaveLength(24);
  for(let i=0;i<10;i++)feet.contact(walker('player'),foot,hit,0);
  expect(view.transients).toHaveLength(32);
});

test('long-lived mixed dust leaves particle capacity for every player footfall in a sustained crowd',()=>{
  const {feet,view}=fixture(),player=walker('player'),births=new Map();let now=0,playerContacts=0;
  feet.playerId=player.id;
  view.ground.surfaceMixAt.mockReturnValue([{surface:'sand',weight:.6},{surface:'snow',weight:.4}]);
  view.particles.burst.mockImplementation(id=>births.set(id,now));
  for(let frame=0;frame<600;frame++){
    now=frame/60;
    // The scene retires transients after their authored lifetime.
    for(const transient of [...view.transients])if(now-births.get(transient.id)>transient.life){
      view.ecd.removeEntity(transient.id);view.transients.splice(view.transients.indexOf(transient),1);births.delete(transient.id);
    }
    feet.update([],player.id,1,now,1/60);
    if(frame%15)continue;
    for(let i=0;i<15;i++)feet.contact(walker('npc-'+i),foot,hit,now);
    const before=view.particles.burst.mock.calls.length;
    feet.contact(player,foot,hit,now);
    if(view.particles.burst.mock.calls.length-before===2)playerContacts++;
    expect(view.transients.length).toBeLessThanOrEqual(32);
  }
  expect(playerContacts).toBe(40);
});

test.each([false,true])('a sustained crowd leaves decal slots for every player footfall with mixed materials %s',mixed=>{
  const {feet,view}=fixture(),player=walker('player');let playerPrints=0;
  if(mixed)view.ground.surfaceMixAt.mockReturnValue([{surface:'grass',weight:.6},{surface:'gravel',weight:.4}]);
  feet.playerId=player.id;
  for(let frame=0;frame<600;frame++){
    feet.update([],player.id,1,frame/60,1/60);
    if(frame%15)continue;
    for(let i=0;i<15;i++)feet.contact(walker('npc-'+i),foot,hit,frame/60);
    const before=feet.pool.filter(m=>m.active).length;
    feet.contact(player,foot,hit,frame/60);
    playerPrints+=feet.pool.filter(m=>m.active).length-before;
  }
  expect(playerPrints).toBe(40*(mixed?2:1));expect(feet.pool.length).toBeLessThanOrEqual(64);
});

test('real physics and presented gaits deliver material contacts through asynchronous worker responses',async()=>{
  const world=await new GameWorld().start({populate:false,navigation:false});
  try{
    const a=world.addPlayer('walker'),{feet,view}=fixture();
    for(let i=0;i<60;i++)world.step();world.input(a.id,{x:0,z:-1,yaw:0,buttons:0});
    for(let i=0;i<240;i++){
      world.step();if(i%2)continue;const now=i/60;
      feet.update([{...a}],a.id,1,now,1/30);
      const q=view.queryFootSurfaces.mock.calls.at(-1)?.[0];
      if(q)feet.accept({...q,hits:q.feet.map(f=>world.footSurface(f.position,f.scale))},now+.005);
    }
    expect(view.audio.footstep.mock.calls.length).toBeGreaterThan(10);
    expect(feet.pool.filter(m=>m.active).length).toBeGreaterThan(10);
    expect(view.particles.burst).toHaveBeenCalled();
  }finally{await world.stop();}
});

test.each(['expired','old-id','old-epoch','jump','death','mantle','teleport'])('%s worker contact cannot leave a ghost footprint',mode=>{
  const {feet}=fixture(),a=walker();feet.update([a],a.id,1,1,.016);
  const q=feet.pending;feet.contacts.sample=vi.fn(()=>true);
  if(mode==='jump')feet.current.set(a.id,{...a,grounded:false});
  if(mode==='mantle')feet.current.set(a.id,{...a,mantle:{phase:'hang'}});
  if(mode==='death')feet.current.set(a.id,{...a,hp:0});
  if(mode==='teleport')feet.current.set(a.id,{...a,x:10});
  feet.contact=vi.fn();
  feet.accept({id:q.id+(mode==='old-id'?1:0),epoch:mode==='old-epoch'?0:1,hits:q.feet.map(()=>hit)},mode==='expired'?1.2:1.01);
  if(mode==='jump'||mode==='mantle')expect(feet.contacts.sample.mock.calls.every(([actor])=>!actor.grounded)).toBe(true);
  else expect(feet.contact).not.toHaveBeenCalled();
});
