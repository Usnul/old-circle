import {expect,test,vi} from 'vitest';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {TransformAttachment} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachment.js';
import {TransformAttachmentSystem} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachmentSystem.js';
import {ParticleEffect} from '@woosh/meep-engine/src/engine/graphics/ecs/particles/ParticleEffect.js';
import {GameAssetType} from '@woosh/meep-engine/src/engine/asset/GameAssetType.js';
import {heightAt} from '@old-circle/game/world/regions.mjs';
import {WorldVFX} from './particle-vfx.mjs';
import {PARTICLE_LAYERS} from './particle-layers.mjs';

const snapshot=(events=[],projectiles=[],presentationEpoch=1)=>({events,projectiles,presentationEpoch});
async function withVFX(run){
  const em=new EntityManager(),ecd=new EntityComponentDataset(),attachments=new TransformAttachmentSystem();
  em.addSystem(attachments);em.attachDataset(ecd);ecd.registerComponentType(ParticleEffect);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));
  const burst=vi.fn(),vfx=new WorldVFX({ecd,particles:{burst}});vfx.update(snapshot(),[],'self',0);
  const position=id=>Array.from(ecd.getComponent(id,Transform64).translation);
  const update=(state=snapshot(),actors=[],dt=0)=>{vfx.update(state,actors,'self',dt);attachments.update(dt);};
  try{await run({vfx,ecd,attachments,burst,position,update});}
  finally{for(const g of vfx.groups)vfx.remove(g);for(const id of vfx.palette??[])ecd.removeEntity(id);await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
}

test('preparation loads each palette sprite once and keeps dormant native atlas entries through transient cleanup',()=>withVFX(async({vfx,ecd,burst,update})=>{
  const assets={promise:vi.fn(async()=>({}))},textures=new Set(Object.values(PARTICLE_LAYERS).map(p=>`/assets/vfx/${p.texture}.png`));
  await vfx.prepare(assets);
  expect(assets.promise).toHaveBeenCalledTimes(textures.size);expect(new Set(assets.promise.mock.calls.map(([url])=>url))).toEqual(textures);
  for(const [,type] of assets.promise.mock.calls)expect(type).toBe(GameAssetType.Image);
  expect(vfx.palette).toHaveLength(textures.size);expect(burst).not.toHaveBeenCalled();
  const impact=vfx.create('physical',[1,2,3]);update(snapshot(),[],impact.life+.1);update(snapshot([],[],2));
  expect(vfx.groups.size).toBe(0);
  for(const id of vfx.palette){const c=ecd.getComponent(id,ParticleEffect);expect(c).toBeInstanceOf(ParticleEffect);expect(c.spawn_rate).toBe(0);expect(c.emitting).toBe(false);}
  expect(new Set(vfx.palette.map(id=>ecd.getComponent(id,ParticleEffect).texture))).toEqual(textures);
}));

test('steady braziers prewarm their fire layers while newly launched cinder wakes start empty',()=>withVFX(({vfx})=>{
  const fire=vfx.create('brazier',[1,2,3],{continuous:true}),wake=vfx.create('cinder-trail',[1,2,3],{continuous:true});
  for(const layer of fire.layers)expect(layer.c.prewarm).toBeGreaterThan(0);
  for(const layer of wake.layers)expect(layer.c.prewarm).toBe(0);
}));

test('layered fire follows one native attachment anchor in world space',()=>withVFX(({vfx,ecd,attachments,position})=>{
  const start=[12,4,-9],g=vfx.create('brazier',start,{continuous:true,persistent:true});attachments.update(0);
  expect(g.layers.length).toBeGreaterThan(3);
  for(const layer of g.layers){
    expect(ecd.getComponent(layer.id,ParticleEffect)).toBe(layer.c);
    expect(ecd.getComponent(layer.id,TransformAttachment).parent).toBe(g.id);expect(position(layer.id)).toEqual(start);
  }
  const moved=[17,6,-12];vfx.move(g,moved);attachments.update(0);
  for(const layer of g.layers)expect(position(layer.id)).toEqual(moved);
}));

test('stopped assemblies retain every layer until their longest particle tail has finished',()=>withVFX(({vfx,ecd,update})=>{
  const g=vfx.create('brazier',[0,4,0],{continuous:true}),entities=[g.id,...g.layers.map(layer=>layer.id)];
  update(snapshot(),[],10);expect(vfx.groups.has(g)).toBe(true);
  vfx.stop(g);expect(g.layers.every(layer=>!layer.c.emitting)).toBe(true);
  update(snapshot(),[],g.life-.01);for(const id of entities)expect(ecd.entityExists(id)).toBe(true);
  const age=g.age;vfx.stop(g);expect(g.age).toBe(age);
  update(snapshot(),[],.02);expect(vfx.groups.has(g)).toBe(false);for(const id of entities)expect(ecd.entityExists(id)).toBe(false);
}));

test('contact events use the supplied surface, render a fresh burst after a long frame, and deduplicate replayed objects',()=>withVFX(({vfx,burst,position,update})=>{
  const event={type:'hit',key:'sword:contact:1',id:'target',weapon:'sword',damage:24,position:[11,3,7],normal:[0,0,1]};
  const actors=[{id:'target',x:70,y:4,z:80,hp:100}];update(snapshot([event]),actors,4);
  const g=[...vfx.groups][0];expect(g.kind).toBe('physical');expect(g.age).toBe(0);
  expect(position(g.id)).toEqual([11,3,7.025]);for(const layer of g.layers)expect(position(layer.id)).toEqual([11,3,7.025]);
  const count=burst.mock.calls.length;expect(count).toBeGreaterThan(1);
  update(snapshot([structuredClone(event)]),actors,.02);expect(burst).toHaveBeenCalledTimes(count);expect([...vfx.groups]).toEqual([g]);
  update(snapshot([{...event,type:'impact',key:'wall:1',weapon:'staff',effect:'cinder'}]),actors,0);
  expect([...vfx.groups].some(group=>group.kind==='cinder')).toBe(true);
}));

test('healing layers follow the living presentation actor together',()=>withVFX(({vfx,position,update})=>{
  const actor={id:'self',x:3,y:4,z:5,hp:40},event={type:'heal',key:'heal:1',id:'self',position:[90,90,90]};
  update(snapshot([event]),[actor]);const g=[...vfx.groups][0];expect(g.kind).toBe('heal');expect(position(g.id)).toEqual([3,4,5]);
  actor.x=6;actor.y=5;update(snapshot(),[actor],.2);
  for(const layer of g.layers)expect(position(layer.id)).toEqual([6,5,5]);
}));

test('presentation epoch changes remove transient assemblies and missile wakes while retaining persistent fire',()=>withVFX(({vfx,ecd,update})=>{
  const fire=vfx.create('brazier',[3,4,5],{continuous:true,persistent:true});
  const event={type:'hit',key:'old-hit',id:'target',position:[1,2,3],normal:[1,0,0]};
  const missile={id:1,key:'old-spell',weapon:'staff',position:[2,4,6],age:.1};update(snapshot([event],[missile]));
  const removed=[...vfx.groups].filter(g=>g!==fire).flatMap(g=>[g.id,...g.layers.map(layer=>layer.id)]);
  expect(removed.length).toBeGreaterThan(0);update(snapshot([],[],2));
  expect([...vfx.groups]).toEqual([fire]);expect(vfx.missiles.size).toBe(0);expect(vfx.seen.size).toBe(0);
  for(const id of removed)expect(ecd.entityExists(id)).toBe(false);
  for(const id of [fire.id,...fire.layers.map(layer=>layer.id)])expect(ecd.entityExists(id)).toBe(true);
}));

test('projectile wakes follow movement, stop spawning at disappearance, then retire after their tails',()=>withVFX(({vfx,ecd,position,update})=>{
  const missile={id:1,key:'spell:1',weapon:'staff',position:[2,4,6],age:.1};update(snapshot([],[missile]));
  const g=vfx.missiles.get(missile.key);expect(g.continuous).toBe(true);
  missile.position=[3,4,6];missile.age=.2;update(snapshot([],[missile]),[],.1);
  expect(vfx.missiles.get(missile.key)).toBe(g);for(const layer of g.layers)expect(position(layer.id)).toEqual(missile.position);
  update(snapshot(),[],.1);expect(vfx.missiles.size).toBe(0);expect(g.continuous).toBe(false);expect(g.layers.every(layer=>!layer.c.emitting)).toBe(true);
  update(snapshot(),[],g.life-.01);expect(ecd.entityExists(g.id)).toBe(true);
  update(snapshot(),[],.02);expect(ecd.entityExists(g.id)).toBe(false);for(const layer of g.layers)expect(ecd.entityExists(layer.id)).toBe(false);
}));

test('ground bursts distribute wave jets on the radius and trap jets within the actual terrain footprint',()=>withVFX(({vfx,attachments,position})=>{
  const origin=[100,200,35],radius=6;
  for(const wave of [false,true]){
    const groups=vfx.groundBurst('frost',origin,radius,{wave});attachments.update(0);expect(groups.length).toBeGreaterThan(3);
    const radii=[];
    for(const g of groups){
      const [x,y,z]=position(g.id),r=Math.hypot(x-origin[0],z-origin[2]);radii.push(r);
      expect(y).toBeCloseTo(heightAt(x,z)+.12,6);expect(g.kind).toBe('frost-ground');
      if(wave)expect(r).toBeCloseTo(radius,6);else{expect(r).toBeGreaterThan(0);expect(r).toBeLessThan(radius);}
      for(const layer of g.layers)expect(position(layer.id)).toEqual([x,y,z]);
    }
    if(!wave)expect(Math.max(...radii)-Math.min(...radii)).toBeGreaterThan(radius*.4);
  }
}));
