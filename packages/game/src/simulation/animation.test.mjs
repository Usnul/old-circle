import {expect,test} from 'vitest';
import {Actor} from './components.mjs';
import {actorJointPoses,actorScale,animationPlan,rigs,actorSocket} from './animation.mjs';
import {weaponPose} from './weapon-pose.mjs';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';

function actor(){return Object.assign(new Actor(),{y:.845,grounded:true});}
test('Blender idle cycles close and animate head, torso and cloth',()=>{
  const a=actor(),start=actorJointPoses(a);a.animationTime=1;const middle=actorJointPoses(a);a.animationTime=3.2;const end=actorJointPoses(a);
  const names=rigs.pilgrim.bones.map(b=>b.name);
  for(const name of ['head','chest','cloak3']){
    const i=names.indexOf(name);
    expect(Math.hypot(...start[i].position.map((v,j)=>v-middle[i].position[j]))).toBeGreaterThan(.001);
    expect(Math.hypot(...start[i].position.map((v,j)=>v-end[i].position[j]))).toBeLessThan(.0001);
  }
});
test('a walking support foot stays planted while the body advances',()=>{
  const a=actor();a.vz=-2;const index=rigs.pilgrim.bones.findIndex(b=>b.name==='footL');
  a.gaitPhase=.112;a.z=-.112;const start=actorJointPoses(a)[index].position;
  a.gaitPhase=.448;a.z=-.448;const end=actorJointPoses(a)[index].position;
  expect(Math.abs(start[2]-end[2])).toBeLessThan(.004);
  expect(Math.abs(start[1]-end[1])).toBeLessThan(.004);
});
test('Blender directional gaits plant the support foot while facing independently of travel',()=>{
  const index=rigs.pilgrim.bones.findIndex(b=>b.name==='footL');
  for(const stance of ['standing','crouched','boss'])for(const yaw of [0,.73])for(let sector=0;sector<8;sector++){
    const a=actor(),angle=sector*Math.PI/4,dx=Math.sin(angle-yaw),dz=-Math.cos(angle-yaw);
    Object.assign(a,{yaw,crouch:stance==='crouched',boss:stance==='boss',vx:dx*2,vz:dz*2});const scale=actorScale(a);
    a.gaitPhase=.112*scale;a.x=dx*a.gaitPhase;a.z=dz*a.gaitPhase;const start=actorJointPoses(a)[index].position;
    a.gaitPhase=.448*scale;a.x=dx*a.gaitPhase;a.z=dz*a.gaitPhase;const end=actorJointPoses(a)[index].position;
    expect(Math.hypot(...end.map((v,i)=>v-start[i]))).toBeLessThan(.012*scale);
  }
});
test('hound walk and run plant each diagonal pair throughout its support phase',()=>{
  for(const [speed,stride] of [[1.1,1.04],[4.1,1.36]])for(const name of ['lowerFL','lowerBR','lowerFR','lowerBL']){
    const a=actor();a.archetype='hound';a.vz=-speed;
    const bone=rigs.briarHound.bones.find(b=>b.name===name),shift=name==='lowerFR'||name==='lowerBL'?.5:0;
    const foot=phase=>{a.gaitPhase=(phase+shift)*stride;a.z=-a.gaitPhase;return new Vector3(0,bone.length,0).applyMatrix4(actorSocket(new Transform64(),a,name));};
    const start=foot(.1),end=foot(.4);expect(start.distanceTo(end)).toBeLessThan(.006);
  }
});
test('airborne pose progresses continuously through the apex and landing keeps feet planted',()=>{
  const a=actor();Object.assign(a,{grounded:false,airTime:.6});
  const times=[5,2,.02,-.02,-2,-5].map(vy=>{a.vy=vy;return animationPlan(a).find(p=>p.name==='jump').time;});
  expect(times.every((time,i)=>i===0||time>times[i-1])).toBe(true);expect(times[3]-times[2]).toBeLessThan(.003);
  Object.assign(a,{grounded:true,landingAge:0,landingStrength:1});const foot=rigs.pilgrim.bones.findIndex(b=>b.name==='footL'),chest=rigs.pilgrim.bones.findIndex(b=>b.name==='chest');
  const start=actorJointPoses(a);a.landingAge=.075;const compressed=actorJointPoses(a);
  expect(compressed[chest].position[1]).toBeLessThan(start[chest].position[1]-.05);
  expect(Math.hypot(...compressed[foot].position.map((v,i)=>v-start[foot].position[i]))).toBeLessThan(.01);
});
test('damage endpoints are the transformed native blade at every active time',()=>{
  const a=actor();a.attackKind='weapon';a.yaw=.71;
  for(const weapon of ['sword','spear'])for(let time=.24;time<.43;time+=.03){
    a.weapon=weapon;a.attackAge=time;const socket=actorSocket(new Transform64(),a,'weapon'),pose=weaponPose(a);
    const end=new Vector3(0,weapon==='spear'?1.55:1.38,0).applyMatrix4(socket);
    expect(Math.hypot(...pose.end.map((v,i)=>v-end[i]))).toBeLessThan(1e-8);
    expect(Math.hypot(...pose.end.map((v,i)=>v-pose.start[i]))).toBeCloseTo(weapon==='spear'?.4:1.13,3);
  }
});
test('animation blends stay normalized through movement, attacks and climbing',()=>{
  const a=actor();
  for(const state of [{},{vx:3.5},{vx:6.7},{crouch:true},{attackAge:.3},{attackAge:-1,mantle:{phase:'hang',t:.2}},{mantle:{phase:'climb',t:.3}}]){
    Object.assign(a,state);const plan=animationPlan(a);
    expect(plan.reduce((n,p)=>n+p.weight,0)).toBeCloseTo(1);
    expect(plan.every(p=>Number.isFinite(p.time)&&rigs.pilgrim.clips[p.name])).toBe(true);
  }
});
