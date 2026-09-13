import {expect,test} from 'vitest';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {WorldWind} from './wind.mjs';
import {WorldCloth} from './cloth.mjs';
import {heightAt} from '@old-circle/game/world/regions.mjs';
import {WorkerFluidSystem} from '@woosh/meep-engine/src/engine/physics/fluid/ecs/WorkerFluidSystem.js';
import {fluidWorker,stepWorker} from './worker-test-helpers.mjs';

test('native wind follows travel and remains bounded after a distant relocation',async()=>{
  const em=new EntityManager(),ecd=new EntityComponentDataset(),wind=new WorldWind({worker_factory:fluidWorker});em.addSystem(wind);em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));wind.attach(ecd);
  try{
    for(const [x,z] of [[0,23],[7,20],[95,-250]]){
      const y=heightAt(x,z)+1;wind.follow(x,y,z);
      for(let i=0;i<120;i++)stepWorker(wind);
      const velocity=wind.sample([0,0,0],x,y+4,z);
      expect(velocity.every(Number.isFinite)).toBe(true);expect(Math.hypot(...velocity)).toBeGreaterThan(.1);expect(Math.hypot(...velocity)).toBeLessThan(5);
      const grid=wind.fluid.worldToGrid([0,0,0],x,y,z);expect(grid.every((v,i)=>v>1&&v<wind.fluid.field.getResolution()[i]-1)).toBe(true);
      expect(wind.fluid.field.solid.some(Boolean)).toBe(true);
    }
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
});

test('native cloth wind converts fluid cells to metres and uses ambient wind outside disabled fields',async()=>{
  const em=new EntityManager(),ecd=new EntityComponentDataset(),wind=new WorldWind({worker_factory:fluidWorker});em.addSystem(wind);em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));wind.attach(ecd);
  try{
    const source=new WorldCloth(wind).wind,out=new Float64Array(3),c=wind.fluid;
    wind.source.wind=[-.5,0,1];c.enabled=true;
    c.field.velocity_x.fill(2);c.field.velocity_y.fill(0);c.field.velocity_z.fill(-1);
    wind.apply(0);
    source.begin(0,ecd);const inside=c.origin.map(v=>v+c.cell_size*3);
    expect(Array.from(source.sample(out,...inside))).toEqual([6,0,-3]);
    expect(source.varies(...inside,...inside)).toBe(true);
    expect(Array.from(source.sample(out,10000,10000,10000))).toEqual(wind.source.wind);
    expect(source.varies(10000,10000,10000,10001,10001,10001)).toBe(false);
    c.enabled=false;source.begin(1,ecd);
    expect(Array.from(source.sample(out,...inside))).toEqual(wind.source.wind);
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
});

test('worker wind publishes completed velocities and placement without exposing an outstanding solve',async()=>{
  const worker=fluidWorker(),wind=new WorldWind({worker_factory:()=>worker});
  const em=new EntityManager(),ecd=new EntityComponentDataset();em.addSystem(wind);em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));wind.attach(ecd);
  try{
    expect(wind).toBeInstanceOf(WorkerFluidSystem);expect(wind.fluid.field.isSharedMemory()).toBe(true);
    wind.follow(0,10,23);stepWorker(wind,.05);
    const point=[0,14,23],velocity=Array.from(wind.sample([0,0,0],...point));
    const origin=[...wind.published.origin],published=wind.published.field.velocity_x.slice();
    const cloth=new WorldCloth(wind);
    wind.follow(300,40,-200);em.simulate(.05);
    expect(wind.is_step_in_flight).toBe(true);expect(wind.may_advance(em.fixedStepTick+1)).toBe(false);
    expect(wind.fluid.origin).not.toEqual(origin);expect(wind.published.origin).toEqual(origin);
    expect(wind.published.field.velocity_x).toEqual(published);
    expect(Array.from(wind.sample([0,0,0],...point))).toEqual(velocity);
    expect(Array.from(cloth.wind.sample(new Float64Array(3),...point))).toEqual(velocity);
    const tick=em.fixedStepTick;em.simulate(1/60);expect(em.fixedStepTick).toBe(tick);
    worker.host.runPendingStep();
    // Disabling the field must still join its last solve on the next tick.
    wind.fluid.enabled=false;em.simulate(0);
    expect(wind.is_step_in_flight).toBe(false);expect(wind.last_joined_tick).toBeGreaterThan(0);
    expect(wind.published.origin).toEqual(wind.fluid.origin);
    expect(Array.from(wind.sample([0,0,0],...point))).toEqual(wind.source.wind);
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
  expect(worker.terminated).toBe(true);expect(wind.is_worker_alive).toBe(false);
});
