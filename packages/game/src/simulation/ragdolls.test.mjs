import {afterEach,expect,test} from 'vitest';
import {Ragdolls,CORPSE_LIFETIME} from './ragdolls.mjs';
import {GameWorld,DT} from './world.mjs';
import {Actor} from './components.mjs';
import {heightAt} from '../world/regions.mjs';
import {Joint} from '@woosh/meep-engine/src/engine/physics/ecs/Joint.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {RigidBody} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {Quaternion} from '@woosh/meep-engine/src/core/geom/Quaternion.js';
import {weaponPose} from './weapon-pose.mjs';
const simulations=[];
afterEach(async()=>{for(const sim of simulations)await sim.stop();simulations.length=0;});
async function setup(options){const sim=await new Ragdolls(options).start();simulations.push(sim);return sim;}
function dead(id='fallen'){return Object.assign(new Actor(),{id,x:160,y:heightAt(160,120)+.845,z:120,hp:0,grounded:true,deathVelocity:[2,.5,0]});}

test('cosmetic physics shares static shapes without changing gameplay state',async()=>{
  const world=await new GameWorld().start({populate:false,navigation:false});
  simulations.push(world);
  const sim=await setup();
  const corpse=dead();
  const actor=world.spawnActor('living',{},[corpse.x+.2,corpse.y,corpse.z]);
  const entity=world.actors.get(actor.id);
  const body=world.ecd.getComponent(entity,RigidBody);
  const transform=world.ecd.getComponent(entity,Transform64);
  body.linearVelocity.set([1,2,3]);
  const before={snapshot:world.snapshot(),count:world.ecd.entityCount,body:structuredClone(body),transform:structuredClone(transform)};

  for(const Component of [Transform64,RigidBody,Collider]){
    expect(sim.world.ecd.getComponent(sim.world.terrainEntity,Component)).not.toBe(world.ecd.getComponent(world.terrainEntity,Component));
  }
  expect(sim.world.ecd.getComponent(sim.world.terrainEntity,Collider).shape).toBe(world.ecd.getComponent(world.terrainEntity,Collider).shape);

  sim.spawn(corpse);
  const start=structuredClone(sim.snapshot()[0]);
  for(let i=0;i<60;i++)sim.update(DT,[actor,corpse]);
  expect(sim.snapshot()[0].joints).not.toEqual(start.joints);
  expect(sim.proxies.has(actor.id)).toBe(true);
  expect(world.snapshot()).toEqual(before.snapshot);
  expect(world.ecd.entityCount).toBe(before.count);
  expect(world.ecd.getComponent(entity,RigidBody)).toBe(body);
  expect(world.ecd.getComponent(entity,Transform64)).toBe(transform);
  expect(structuredClone(body)).toEqual(before.body);
  expect(structuredClone(transform)).toEqual(before.transform);
});

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
  const sim=await setup({maxActive:1}),baseline=sim.world.ecd.entityCount;sim.spawn(dead('first'));
  const record=[...sim.records.values()][0],weaponBody=record.weaponBody;sim.update(.1,[]);
  const weapon=structuredClone(sim.snapshot()[0].weaponPose);sim.spawn(dead('second'));
  expect(sim.records.size).toBe(2);expect([...sim.records.values()].filter(r=>r.active)).toHaveLength(1);
  const first=sim.snapshot().find(r=>r.actorId==='first');expect(first.joints.length).toBeGreaterThan(10);
  expect(first.weaponPose).toEqual(weapon);expect(record.weaponBody).toBeNull();expect(sim.world.ecd.getComponent(weaponBody.id,Transform64)).not.toBe(weaponBody.t);
  for(const record of sim.records.values())record.age=CORPSE_LIFETIME-.01;
  sim.update(.02,[]);expect(sim.records.size).toBe(0);expect(sim.world.ecd.entityCount).toBe(baseline);
  sim.update(.02,[dead('first')]);expect(sim.records.size).toBe(0);
});

const drops=[['sword',false],['spear',false],['bow',false],['staff',false],['spear',true]].flatMap(([weapon,boss])=>[false,true].map(grounded=>({weapon,boss,grounded,bossMove:''})));
drops.push({weapon:'spear',boss:true,grounded:true,bossMove:'bell'});
test.each(drops)('$weapon drops independently of the skeleton (boss: $boss, grounded: $grounded, move: $bossMove)',async({weapon,boss,grounded,bossMove})=>{
  const sim=await setup(),a=Object.assign(dead(),{weapon,boss,grounded,bossMove,y:heightAt(160,120)+(grounded?(boss?1.2675:.845):4),yaw:.7,attackKind:bossMove?'ritual':weapon,attackAge:bossMove?.15:grounded?-1:.3,deathVelocity:grounded?[0,0,0]:[2,.5,0]});
  sim.spawn(a);const start=structuredClone(sim.snapshot()[0]),held=weaponPose(a),record=[...sim.records.values()][0],body=record.weaponBody;
  for(let i=0;i<3;i++)expect(start.weaponPose.position[i]).toBeCloseTo(held.origin[i]);
  for(let i=0;i<4;i++)expect(start.weaponPose.rotation[i]).toBeCloseTo(held.rotation[i]);
  expect(Array.from(body.b.linearVelocity)).toEqual(a.deathVelocity);
  for(const id of record.constraints){const joint=sim.world.ecd.getComponent(id,Joint);expect([joint.entityA,joint.entityB]).not.toContain(body.id);}
  for(let i=0;i<300;i++)sim.update(1/60,[]);
  const dropped=structuredClone(sim.snapshot()[0].weaponPose);
  expect(dropped.position.every(Number.isFinite)).toBe(true);expect(dropped.rotation.every(Number.isFinite)).toBe(true);
  expect(dropped.position[1]).toBeLessThan(start.weaponPose.position[1]-.2);
  const q=new Quaternion();q.set(...body.t.rotation);q.conjugate();
  const down=new Vector3(0,-1,0).applyQuaternion(q),lowest=new Vector3();
  sim.world.ecd.getComponent(body.id,Collider).shape.support(lowest,0,...down);lowest.applyMatrix4(body.t);
  expect(lowest.y).toBeGreaterThan(heightAt(lowest.x,lowest.z)-.1);
  // Moving the arm after the drop cannot pull the released weapon with it.
  const hand=record.bodies.get(record.data.bones.findIndex(b=>b.name==='handR'));
  sim.world.physics.setPose(hand.b,[a.x+10,a.y,a.z],[0,0,0,1]);sim.readPose(record);
  expect(sim.snapshot()[0].weaponPose).toEqual(dropped);
  sim.clear();expect(sim.world.ecd.entityExists(body.id)).toBe(false);
});

test('hounds do not spawn dropped weapons',async()=>{
  const sim=await setup();sim.spawn(Object.assign(dead(),{archetype:'hound'}));
  expect(sim.snapshot()[0].weapon).toBeNull();expect(sim.snapshot()[0].weaponPose).toBeNull();expect([...sim.records.values()][0].weaponBody).toBeNull();
});
