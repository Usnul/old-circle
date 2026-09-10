import {expect,test} from 'vitest';
import {WorldFootsteps} from './footsteps.mjs';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Decal} from '@woosh/meep-engine/src/engine/graphics/ecs/decal/v2/Decal.js';

test('native footprint projectors face into slopes, fade, unlink and reuse bounded entities',()=>{
  const ecd=new EntityComponentDataset();for(const c of [Transform64,Decal])ecd.registerComponentType(c);
  const view={ecd,transients:[],ground:{surfaceAt:()=> 'snow'},audio:{footstep(){}},particles:{burst(){}},emitter(){this.transients.push({});return {id:0};}},feet=new WorldFootsteps(view);
  const actor={id:'walker',vx:0,vz:2},foot={name:'footL',scale:1,hound:false,heading:[0,0,-1]},normal=[.3,Math.sqrt(.91),0],hit={surface:'terrain',position:[2,4,8],normal};
  feet.contact(actor,foot,hit,0);const first=feet.pool[0],m=first.t.matrix;
  expect(normal.reduce((sum,v,i)=>sum+v*m[8+i]/.12,0)).toBeCloseTo(-1,5);
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
