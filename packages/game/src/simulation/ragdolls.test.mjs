import {afterEach,expect,test} from 'vitest';
import {Ragdolls,CORPSE_LIFETIME} from './ragdolls.mjs';
import {Actor} from './components.mjs';
import {heightAt} from '../world/regions.mjs';
import {Joint} from '@woosh/meep-engine/src/engine/physics/ecs/Joint.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
const simulations=[];
afterEach(async()=>{for(const sim of simulations)await sim.stop();simulations.length=0;});
async function setup(options){const sim=await new Ragdolls(options).start();simulations.push(sim);return sim;}
function dead(id='fallen'){return Object.assign(new Actor(),{id,x:160,y:heightAt(160,120)+.845,z:120,hp:0,grounded:true,deathVelocity:[2,.5,0]});}

test('Meep ragdoll joints retain their anchors as the body falls and settles',async()=>{
  const sim=await setup(),a=dead();sim.spawn(a);const start=structuredClone(sim.snapshot()[0]);
  for(let i=0;i<300;i++)sim.update(1/60,[a]);
  const corpse=sim.snapshot()[0];expect(corpse.joints[0].position[1]).toBeLessThan(start.joints[0].position[1]-.3);
  const record=[...sim.records.values()][0];
  for(const id of record.constraints){
    const joint=sim.world.ecd.getComponent(id,Joint),ta=sim.world.ecd.getComponent(joint.entityA,Transform64),tb=sim.world.ecd.getComponent(joint.entityB,Transform64);
    const a=new Vector3(...joint.localAnchorA).applyMatrix4(ta),b=new Vector3(...joint.localAnchorB).applyMatrix4(tb);
    expect(a.distanceTo(b)).toBeLessThan(.07);
  }
  expect(corpse.joints.every(j=>j.position.every(Number.isFinite)&&j.position[1]>heightAt(j.position[0],j.position[2])-.35)).toBe(true);
  expect(sim.snapshot()).toHaveLength(1);
});
test('physics budget freezes older corpses while preserving their visible bodies',async()=>{
  const sim=await setup({maxActive:1});sim.spawn(dead('first'));sim.spawn(dead('second'));
  expect(sim.records.size).toBe(2);expect([...sim.records.values()].filter(r=>r.active)).toHaveLength(1);
  const first=sim.snapshot().find(r=>r.actorId==='first');expect(first.joints.length).toBeGreaterThan(10);
  for(const record of sim.records.values())record.age=CORPSE_LIFETIME-.01;
  sim.update(.02,[]);expect(sim.records.size).toBe(0);
  sim.update(.02,[dead('first')]);expect(sim.records.size).toBe(0);
});
