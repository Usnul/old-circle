import {expect,test,vi} from 'vitest';
import {WorldFootsteps,footstepScreenArea} from './footsteps.mjs';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Decal} from '@woosh/meep-engine/src/engine/graphics/ecs/decal/v2/Decal.js';
import {ParticleEffect} from '@woosh/meep-engine/src/engine/graphics/ecs/particles/ParticleEffect.js';
import {PerspectiveCamera} from '@woosh/meep-engine/src/shade/renderer/camera/PerspectiveCamera.js';
import {t64_look_rotation} from '@woosh/meep-engine/src/engine/ecs/transform/t64_look_rotation.js';
import {Actor} from '@old-circle/game/simulation/components.mjs';
import {GameWorld} from '@old-circle/game/simulation/world.mjs';
import {FOOTSTEP_EFFECTS} from './effects.mjs';

function fixture(camera){
  const ecd=new EntityComponentDataset();for(const c of [Transform64,Decal,ParticleEffect])ecd.registerComponentType(c);
  const view={ecd,transients:[],ground:{surfaceAt:()=> 'snow'},audio:{footstep:vi.fn()},particles:{burst:vi.fn()},queryFootSurfaces:vi.fn()};
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
  const view={ecd,transients:[],ground:{surfaceAt:()=> 'snow'},audio:{footstep(){}},particles:{burst(){}},emitter(){this.transients.push({});return {id:0};}},feet=new WorldFootsteps(view);
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
  const {view,feet}=fixture(),a=walker(),normal=[.3,Math.sqrt(.91),0];view.ground.surfaceAt=()=>surface;
  feet.contact(a,{...foot,heading:normal},{...hit,normal},0);
  const selected=surface==='unknown'?'stone':surface,transient=view.transients[0],p=FOOTSTEP_EFFECTS['step-'+selected];
  expect(transient.c.texture).toBe(`/assets/vfx/${p.texture}.png`);
  expect(view.audio.footstep.mock.calls[0][3]).toBe(selected);
  const t=view.ecd.getComponent(transient.id,Transform64);
  for(let i=0;i<3;i++)expect(t.matrix[4+i]).toBeCloseTo(normal[i],6);
  expect(Array.from(feet.pool[0].t.matrix).every(Number.isFinite)).toBe(true);
  expect(transient.life).toBeGreaterThan(p.life);
  // A raised wooden floor wins over the terrain biome below it.
  feet.contact(a,foot,{...hit,surface:'wood'},1);
  expect(view.audio.footstep.mock.calls.at(-1)[3]).toBe('wood');
});

test('crowd particles leave a reserve for the player and all emission remains bounded',()=>{
  const {view,feet}=fixture();feet.playerId='player';
  for(let i=0;i<40;i++)feet.contact(walker('npc'),foot,hit,0);
  expect(view.transients).toHaveLength(28);
  for(let i=0;i<10;i++)feet.contact(walker('player'),foot,hit,0);
  expect(view.transients).toHaveLength(32);
});

test('a sustained crowd leaves decal slots available for every player footfall while old prints fade',()=>{
  const {feet}=fixture(),player=walker('player');let playerPrints=0;
  feet.playerId=player.id;
  for(let frame=0;frame<600;frame++){
    feet.update([],player.id,1,frame/60,1/60);
    if(frame%15)continue;
    for(let i=0;i<15;i++)feet.contact(walker('npc-'+i),foot,hit,frame/60);
    const before=feet.pool.filter(m=>m.active).length;
    feet.contact(player,foot,hit,frame/60);
    playerPrints+=feet.pool.filter(m=>m.active).length-before;
  }
  expect(playerPrints).toBe(40);expect(feet.pool.length).toBeLessThanOrEqual(64);
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
