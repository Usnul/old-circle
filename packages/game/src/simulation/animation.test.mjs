import {expect,test} from 'vitest';
import {Actor} from './components.mjs';
import {actorJointPoses,actorScale,animationPlan,rigs,actorSocket,createSkeleton} from './animation.mjs';
import {weaponPose} from './weapon-pose.mjs';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {pose_evaluate_world} from '@woosh/meep-engine/src/shade/renderer/animation/pose/pose_evaluate_world.js';

test('Blender banner loops pin the top edge while the hem billows',()=>{
  const skeleton=createSkeleton('votiveBanner'),root=skeleton.joints[1],hem=skeleton.joints.at(-1);
  const point=(joint,name,time,offset)=>new Vector3(...offset).applyMatrix4(pose_evaluate_world(new Transform64(),joint,[{clip:skeleton.byName.get(name),time,weight:1}]));
  for(const name of ['calm','breeze','reverse']){
    const start=point(hem,name,0,[0,.5,0]),end=point(hem,name,3.6,[0,.5,0]);expect(start.distanceTo(end)).toBeLessThan(.0001);
    for(const time of [0,.9,1.8,2.7,3.6])for(const x of [-.72,.72])expect(point(root,name,time,[x,0,0]).distanceTo(point(root,'calm',0,[x,0,0]))).toBeLessThan(.0001);
  }
  expect(point(hem,'breeze',0,[0,.5,0]).distanceTo(point(hem,'breeze',1.2,[0,.5,0]))).toBeGreaterThan(.2);
});

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

test.each([
  {stance:'idle',speed:0,stride:1.12,crouch:false},
  {stance:'walk',speed:2,stride:1.12,crouch:false},
  {stance:'run',speed:6.5,stride:1.84,crouch:false},
  {stance:'crouch',speed:0,stride:1.12,crouch:true},
  {stance:'crouch walk',speed:1.3,stride:1.12,crouch:true},
])('the sword stays in an upright, ground-clearing carry throughout $stance',({stance,speed,stride,crouch})=>{
  const a=actor();Object.assign(a,{weapon:'sword',crouch,y:crouch?.495:.845,yaw:.73});
  for(let sector=0;sector<8;sector++)for(let frame=0;frame<=32;frame++){
    const phase=frame/32,angle=sector*Math.PI/4-a.yaw;
    Object.assign(a,{vx:Math.sin(angle)*speed,vz:-Math.cos(angle)*speed,gaitPhase:phase*stride,animationTime:phase*3.2});
    const socket=actorSocket(new Transform64(),a,'weapon'),pose=weaponPose(a);
    // The model origin is .25 m along the hand socket. Its pommel extends
    // .49 m behind that origin, including the rounded end of the pommel.
    const pommel=new Vector3(0,.25-.49,0).applyMatrix4(socket),label=`${stance}, heading ${sector}, phase ${phase}`;
    expect(pose.end[1]-socket.translation[1],label).toBeGreaterThan(.12);
    expect(pose.end[1],label).toBeGreaterThan(.10);
    expect(pommel.y,label).toBeGreaterThan(.10);
  }
});

function namedHumanPose(a){
  return Object.fromEntries(actorJointPoses(a).map((pose,i)=>[rigs.pilgrim.bones[i].name,pose.position]));
}
const excursion=values=>Math.max(...values)-Math.min(...values);
const average=values=>values.reduce((sum,value)=>sum+value,0)/values.length;

test('walking bends the spine and running adds forward weight with visible pelvis and head bob',()=>{
  const gaits=[];
  for(const [speed,stride] of [[2,1.12],[6.5,1.84]]){
    const a=actor();a.vz=-speed;
    const poses=[],bends=[],leans=[];
    for(let frame=0;frame<32;frame++){
      a.gaitPhase=frame/32*stride;const pose=namedHumanPose(a);poses.push(pose);
      const axis=name=>{
        const socket=actorSocket(new Transform64(),a,name);
        return new Vector3(0,1,0).applyMatrix4(socket).sub(new Vector3(...socket.translation)).normalize();
      };
      bends.push(Math.acos(Math.max(-1,Math.min(1,axis('hips').dot(axis('chest'))))));
      leans.push(Math.atan2(pose.hips[2]-pose.head[2],pose.head[1]-pose.hips[1]));
    }
    expect(average(bends),`spine bend at ${speed} m/s`).toBeGreaterThan(.035);
    for(const joint of ['hips','head'])expect(excursion(poses.map(pose=>pose[joint][1])),`${joint} bob at ${speed} m/s`).toBeGreaterThan(.025);
    gaits.push({lean:average(leans),bob:excursion(poses.map(pose=>pose.hips[1]))});
  }
  expect(gaits[0].lean).toBeGreaterThan(.025);
  expect(gaits[1].lean).toBeGreaterThan(gaits[0].lean+.05);
  expect(gaits[1].bob).toBeGreaterThan(gaits[0].bob+.015);
});

test('a sword cut winds the torso back, transfers weight into a step and recovers its carry',()=>{
  const a=actor();a.attackKind='weapon';
  const carry=namedHumanPose(a),carryBlade=weaponPose(a),duration=rigs.pilgrim.clips.sword.duration;
  const shoulderYaw=pose=>Math.atan2(pose.upperArmR[2]-pose.upperArmL[2],pose.upperArmL[0]-pose.upperArmR[0]);
  const yawFromCarry=pose=>Math.atan2(Math.sin(shoulderYaw(pose)-shoulderYaw(carry)),Math.cos(shoulderYaw(pose)-shoulderYaw(carry)));
  const samples=[];
  for(let frame=0;frame<=48;frame++){
    a.attackAge=frame/48*duration;samples.push({time:a.attackAge,pose:namedHumanPose(a)});
  }
  const anticipation=samples.filter(sample=>sample.time>0&&sample.time<.18);
  const followThrough=samples.filter(sample=>sample.time>=.26&&sample.time<=.50);
  const wound=anticipation.reduce((best,sample)=>Math.abs(yawFromCarry(sample.pose))>Math.abs(yawFromCarry(best.pose))?sample:best);
  const windingYaw=yawFromCarry(wound.pose);
  expect(Math.abs(windingYaw)).toBeGreaterThan(.12);
  expect(Math.max(...followThrough.map(sample=>-Math.sign(windingYaw)*yawFromCarry(sample.pose)))).toBeGreaterThan(.12);
  expect(Math.max(...anticipation.map(({pose})=>Math.hypot(...pose.handR.map((v,i)=>v-carry.handR[i]))))).toBeGreaterThan(.12);
  expect(Math.max(...samples.map(({pose})=>Math.hypot(pose.hips[0]-carry.hips[0],pose.hips[2]-carry.hips[2])))).toBeGreaterThan(.05);
  expect(Math.max(...samples.flatMap(({pose})=>['footL','footR'].map(name=>carry[name][2]-pose[name][2])))).toBeGreaterThan(.08);
  a.attackAge=duration-.015;const recovered=namedHumanPose(a),recoveredBlade=weaponPose(a);
  for(const name of ['hips','head','handR','footL','footR'])expect(Math.hypot(...recovered[name].map((v,i)=>v-carry[name][i])),`${name} recovery`).toBeLessThan(.06);
  expect(Math.hypot(...recoveredBlade.end.map((v,i)=>v-carryBlade.end[i]))).toBeLessThan(.12);
});
