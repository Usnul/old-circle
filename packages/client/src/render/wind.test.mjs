import {expect,test} from 'vitest';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {WorldWind} from './wind.mjs';
import {WorldCloth} from './cloth.mjs';
import {heightAt} from '@old-circle/game/world/regions.mjs';

test('native wind follows travel and remains bounded after a distant relocation',async()=>{
  const em=new EntityManager(),ecd=new EntityComponentDataset(),wind=new WorldWind();em.addSystem(wind);em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));wind.attach(ecd);
  try{
    for(const [x,z] of [[0,23],[7,20],[95,-250]]){
      const y=heightAt(x,z)+1;wind.follow(x,y,z);
      for(let i=0;i<120;i++)em.simulate(1/60);
      const velocity=wind.sample([0,0,0],x,y+4,z);
      expect(velocity.every(Number.isFinite)).toBe(true);expect(Math.hypot(...velocity)).toBeGreaterThan(.1);expect(Math.hypot(...velocity)).toBeLessThan(5);
      const grid=wind.fluid.worldToGrid([0,0,0],x,y,z);expect(grid.every((v,i)=>v>1&&v<wind.fluid.field.getResolution()[i]-1)).toBe(true);
      expect(wind.fluid.field.solid.some(Boolean)).toBe(true);
    }
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
});

test('native cloth wind converts fluid cells to metres and uses ambient wind outside disabled fields',async()=>{
  const em=new EntityManager(),ecd=new EntityComponentDataset(),wind=new WorldWind();em.addSystem(wind);em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));wind.attach(ecd);
  try{
    const source=new WorldCloth(wind).wind,out=new Float64Array(3),c=wind.fluid;
    wind.source.wind=[-.5,0,1];c.enabled=true;
    c.field.velocity_x.fill(2);c.field.velocity_y.fill(0);c.field.velocity_z.fill(-1);
    source.begin(0,ecd);const inside=c.origin.map(v=>v+c.cell_size*3);
    expect(Array.from(source.sample(out,...inside))).toEqual([6,0,-3]);
    expect(source.varies(...inside,...inside)).toBe(true);
    expect(Array.from(source.sample(out,10000,10000,10000))).toEqual(wind.source.wind);
    expect(source.varies(10000,10000,10000,10001,10001,10001)).toBe(false);
    c.enabled=false;source.begin(1,ecd);
    expect(Array.from(source.sample(out,...inside))).toEqual(wind.source.wind);
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
});
