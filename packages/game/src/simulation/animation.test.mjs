import {expect,test} from 'vitest';
import {Actor} from './components.mjs';
import {actorJointPoses,actorScale,animationPlan,rigs,actorSocket,createSimulationSkeleton} from './animation.mjs';
import {weaponPose} from './weapon-pose.mjs';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {t64_evaluate_world} from '@woosh/meep-engine/src/engine/ecs/transform/t64_evaluate_world.js';

test('the banner has a fixed crossbar attachment and no authored motion competing with native cloth',()=>{
  const skeleton=createSimulationSkeleton('votiveBanner'),root=skeleton.joints[1];
  expect([...skeleton.byName.keys()]).toEqual([]);
  const matrix=t64_evaluate_world(new Transform64(),skeleton.dataset,root,[]);
  for(const x of [-.72,.72]){
    const point=new Vector3(x,0,0).applyMatrix4(matrix);
    expect(point.x).toBeCloseTo(.9+x,5);expect(point.y).toBeCloseTo(3.4,5);expect(point.z).toBeCloseTo(0,5);
  }
});

function actor(){return Object.assign(new Actor(),{y:.845,grounded:true});}

test.each([-1.35,-.9,-.63,-.45,0,.225,.45,.9,1.35])('bow grip, string and drawing hand share the aimed plane at pitch %s',pitch=>{
  const a=actor();Object.assign(a,{weapon:'bow',attackKind:'weapon',attackAge:.46,intent:{pitch},yaw:.73});
  const poses=actorJointPoses(a),hand=name=>poses[rigs.pilgrim.bones.findIndex(b=>b.name===name)].position;
  const socket=actorSocket(new Transform64(),a,'weapon'),grip=weaponPose(a).origin;
  const forward=new Vector3(1,0,0).applyQuaternion({x:socket.rotation[0],y:socket.rotation[1],z:socket.rotation[2],w:socket.rotation[3]});
  const up=new Vector3(0,1,0).applyQuaternion({x:socket.rotation[0],y:socket.rotation[1],z:socket.rotation[2],w:socket.rotation[3]});
  const string=new Vector3(-.293,0,0).applyMatrix4(socket);
  expect(Math.hypot(...grip.map((v,i)=>v-hand('handR')[i]))).toBeLessThan(.06);
  expect(Math.hypot(...hand('handL').map((v,i)=>v-string[i]))).toBeLessThan(.13);
  expect(forward.y).toBeCloseTo(-Math.sin(pitch),2);
  expect(up.y).toBeCloseTo(Math.cos(pitch),2);
  const expected=[-Math.sin(a.yaw)*Math.cos(pitch),-Math.sin(pitch),-Math.cos(a.yaw)*Math.cos(pitch)];
  expect(forward.x*expected[0]+forward.y*expected[1]+forward.z*expected[2]).toBeGreaterThan(.995);
  const chest=actorSocket(new Transform64(),a,'chest'),neck=new Vector3(0,.17,0).applyMatrix4(chest);
  expect((neck.y-chest.translation[1])/.17).toBeGreaterThan(.85);
  for(const side of ['R','L']){
    const shoulder=hand('upperArm'+side),elbow=hand('forearm'+side),wrist=hand('hand'+side);
    expect(Math.hypot(...elbow.map((v,i)=>v-shoulder[i]))).toBeCloseTo(.327,2);
    expect(Math.hypot(...wrist.map((v,i)=>v-elbow[i]))).toBeCloseTo(.255,2);
  }
});
test('Blender idle cycles close and animate head and torso',()=>{
  const a=actor(),start=actorJointPoses(a);a.animationTime=1;const middle=actorJointPoses(a);a.animationTime=3.2;const end=actorJointPoses(a);
  const names=rigs.pilgrim.bones.map(b=>b.name);
  for(const name of ['head','chest']){
    const i=names.indexOf(name);
    expect(Math.hypot(...start[i].position.map((v,j)=>v-middle[i].position[j]))).toBeGreaterThan(.001);
    expect(Math.hypot(...start[i].position.map((v,j)=>v-end[i].position[j]))).toBeLessThan(.0001);
  }
});
test('CPU cloak tracks retain bind-local transforms while native cloth owns presentation motion',()=>{
  for(const [name,clip] of Object.entries(rigs.pilgrim.clips))for(const [index,bone] of rigs.pilgrim.bones.entries()){
    if(!bone.name.startsWith('cloak'))continue;
    for(const [key,width] of [['position',3],['rotation',4],['scale',3]])for(const [sample,value] of clip.tracks[index][key].entries()){
      expect(value,`${name} ${bone.name} ${key}`).toBeCloseTo(bone[key][sample%width],5);
    }
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

test.each([0,2,4.7,6.5])('sword elbows and wrists retain natural lengths, flex and continuity at %s m/s',speed=>{
  const a=actor(),yaw=.73,travelAngle=Math.PI/4-yaw;
  Object.assign(a,{yaw,vx:Math.sin(travelAngle)*speed,vz:-Math.cos(travelAngle)*speed,attackKind:'weapon'});
  const indices=Object.fromEntries(rigs.pilgrim.bones.map((bone,i)=>[bone.name,i]));
  const difference=(to,from)=>to.map((value,i)=>value-from[i]),length=values=>Math.hypot(...values);
  const dot=(first,second)=>first.reduce((sum,value,i)=>sum+value*second[i],0);
  let previous;
  // Include entry from locomotion, the complete cut and return to locomotion.
  // Actor translation stays fixed so continuity measures the articulated pose.
  for(let frame=-6;frame<=Math.ceil((rigs.pilgrim.clips.sword.duration+.05)*120);frame++){
    const time=frame/120;Object.assign(a,{attackAge:frame<0?-1:time,gaitPhase:.6+time*speed,animationTime:1+time});
    const poses=actorJointPoses(a);
    for(const side of ['L','R']){
      const shoulder=poses[indices['upperArm'+side]],elbow=poses[indices['forearm'+side]],wrist=poses[indices['hand'+side]];
      const upper=difference(elbow.position,shoulder.position),forearm=difference(wrist.position,elbow.position),label=`${side} arm at ${time.toFixed(4)} s, ${speed} m/s`;
      expect(Math.abs(length(upper)-rigs.pilgrim.bones[indices['upperArm'+side]].length),label).toBeLessThan(.004);
      expect(Math.abs(length(forearm)-rigs.pilgrim.bones[indices['forearm'+side]].length),label).toBeLessThan(.004);
      const elbowCosine=dot(upper,forearm)/length(upper)/length(forearm);
      expect(elbowCosine,label).toBeLessThan(Math.cos(8*Math.PI/180));
      expect(elbowCosine,label).toBeGreaterThan(Math.cos(150*Math.PI/180));
      const socket=actorSocket(new Transform64(),a,'hand'+side);
      const handAxis=new Vector3(0,1,0).applyMatrix4(socket).sub(new Vector3(...socket.translation)).normalize();
      expect(dot([handAxis.x,handAxis.y,handAxis.z],forearm)/length(forearm),label).toBeGreaterThan(Math.cos(70*Math.PI/180));
      if(previous)for(const name of ['forearm'+side,'hand'+side]){
        const current=poses[indices[name]],prior=previous[indices[name]];
        expect(length(difference(current.position,prior.position)),`${name} position, ${label}`).toBeLessThan(.10);
        const rotationStep=2*Math.acos(Math.min(1,Math.abs(dot(current.rotation,prior.rotation))));
        expect(rotationStep,`${name} rotation, ${label}`).toBeLessThan(15*Math.PI/180);
      }
    }
    previous=poses;
  }
});
