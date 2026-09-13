import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {t64_evaluate_world} from '@woosh/meep-engine/src/engine/ecs/transform/t64_evaluate_world.js';
import {TransformAttachment} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachment.js';
import {TransformAttachmentSystem} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachmentSystem.js';
import {TRANSFORM_ATTACHMENT_EVENT_CHANGE} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TRANSFORM_ATTACHMENT_EVENT_CHANGE.js';
import {prefab_compile} from '@woosh/meep-engine/src/engine/graphics3/prefab/prefab_compile.js';
import {prefab_instantiate} from '@woosh/meep-engine/src/engine/graphics3/prefab/prefab_instantiate.js';
import {AnimationSystem} from '@woosh/meep-engine/src/engine/graphics3/AnimationSystem.js';
import {Skin} from '@woosh/meep-engine/src/shade/renderer/animation/Skin.js';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {MeshletGeometry} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometry.js';
import {MeshletGeometrySerializationAdapter} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometrySerializationAdapter.js';
import {meshlet_get_attribute_offset} from '@woosh/meep-engine/src/shade/renderer/geometry/meshlet/meshlet_get_attribute_offset.js';
import {meshlet_data_index_section_size} from '@woosh/meep-engine/src/shade/renderer/geometry/meshlet/meshlet_data_index_section_size.js';
import {MESHLET_ATTRIBUTE_COMPRESSION_FLAGS} from '@woosh/meep-engine/src/shade/renderer/geometry/meshlet/encoding/MESHLET_ATTRIBUTE_COMPRESSION_FLAGS.js';
import {v3_quaternion_apply_inverse} from '@woosh/meep-engine/src/core/geom/vec3/v3_quaternion_apply_inverse.js';
import {Cloth} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/Cloth.js';
import {ClothColliderSystem} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothColliderSystem.js';
import {ClothCollider} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothCollider.js';
import {ClothRig} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothRig.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {CapsuleShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/CapsuleShape3D.js';
import {cloth_collider_signed_distance,cloth_collider_pose_at} from '@woosh/meep-engine/src/engine/physics/cloth/collider/cloth_collider_sdf.js';
import {CCR_STRIDE,CCR_TX,CCR_TY,CCR_TZ,CCR_PREV_TX,CCR_PREV_TY,CCR_PREV_TZ} from '@woosh/meep-engine/src/engine/physics/cloth/collider/ClothColliderRecord.js';
import {createSkeleton,rigs} from '@old-circle/game/simulation/animation.mjs';
import {WorldCloth,clothComponents,unkeyCloth} from './cloth.mjs';
import {clothWorker,stepWorker} from './worker-test-helpers.mjs';

async function garment(name,run,{scale=1,yaw=0}={}){
  const em=new EntityManager(),ecd=new EntityComponentDataset(),attachments=new TransformAttachmentSystem();
  let worker;
  const wind=[0,0,0],system=new WorldCloth({sample:out=>{out.set(wind);return out;},varies:()=>false},{worker_factory:()=>worker=clothWorker()}),models=new Map();
  system.models={instance_of:id=>models.get(id)??null};
  // Exercise the native pose evaluator with authored, retargeted playbacks;
  // GPU publication itself is covered by characters.test.mjs.
  const playbacks=[],animations=new AnimationSystem({},{});
  animations.write_pose_playbacks=target=>{target.push(...playbacks);return playbacks.length>0;};
  em.addSystem(animations);em.addSystem(attachments);em.addSystem(new ClothColliderSystem());em.addSystem(system);em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));
  try{
    const skeleton=createSkeleton(name);unkeyCloth(skeleton);
    skeleton.bundle.skins=[Skin.from({name,joints:skeleton.joints,inverse_bind_matrices:Float32Array.from(skeleton.data.bones.flatMap(b=>b.inverseBind)),meshes:[]})];
    const t=new Transform64();t.setScale(scale,scale,scale);t.setRotation(0,Math.sin(yaw/2),0,Math.cos(yaw/2));t.updateMatrix();
    const prefab=prefab_compile(skeleton.bundle),id=new Entity().add(t).build(ecd),model=prefab_instantiate(prefab,ecd,id);models.set(id,model);
    const components=clothComponents(name);for(const component of components)ecd.addComponentToEntity(id,component);
    const joints=Object.fromEntries(skeleton.data.bones.map((b,i)=>[b.name,model.skins[0].joints[i]]));
    const step=(count=1)=>{for(let i=0;i<count;i++){stepWorker(system);attachments.update(1/60);}};
    const pose=name=>t64_evaluate_world(new Transform64(),ecd,joints[name],playbacks);
    const play=(name,time)=>{const clip=model.clips.find(c=>c.name===name);expect(clip,name).toBeDefined();playbacks.splice(0,playbacks.length,{clip,time,weight:1});};
    // The seed is registered on the first tick and solved after its acknowledgement.
    step(2);expect(system.instances[0].seeded).toBe(true);expect(system.instances[0].refused).toBe(false);
    expect(system.instances[0].state.isSharedMemory()).toBe(true);
    await run({ecd,system,id,t,wind,joints,step,pose,play,prefab,models,worker,cloth:components.find(c=>c instanceof Cloth)});
  }finally{
    await new Promise((resolve,reject)=>em.shutdown(resolve,reject));
    expect(worker.terminated).toBe(true);expect(system.bodies.size).toBe(0);
  }
}

function bounded(instance){
  expect([...instance.state.position,...instance.state.velocity].every(Number.isFinite)).toBe(true);
  for(let p=0;p<instance.state.particle_count;p++)expect(Math.hypot(...instance.state.position.subarray(p*3,p*3+3))).toBeLessThan(5);
}
const translation=pose=>Array.from(pose.translation);
const distance=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]));
const transformPoint=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];

async function capeVertices(){
  const root=new URL('../../public/assets/geometry/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  const chunk=manifest.models.pilgrim.find(c=>c.material==='cloak'),bytes=await readFile(new URL(chunk.file,root));
  const buffer=new BinaryBuffer();buffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const geometry=new MeshletGeometry();new MeshletGeometrySerializationAdapter().deserialize(buffer,geometry);
  const meshlets=geometry.meshlets,data=new DataView(meshlets.data_buffer),vertices=new Map();
  for(let meshlet=0;meshlet<meshlets.count;meshlet++){
    const h=meshlets.read_header(meshlet),base=h.address*4+meshlet_data_index_section_size(h.primitive_count)*4;
    const attribute=(name,vertex,stride)=>base+meshlet_get_attribute_offset(name,h.flags,h.vertex_count)*4+((h.flags&MESHLET_ATTRIBUTE_COMPRESSION_FLAGS[name])?0:vertex*stride);
    for(let vertex=0;vertex<h.vertex_count;vertex++){
      const p=attribute('position',vertex,12),j=attribute('joints',vertex,8),w=attribute('weights',vertex,4);
      const position=[0,1,2].map(axis=>data.getFloat32(p+axis*4,true)),influences=[];
      for(let slot=0;slot<4;slot++){
        const weight=data.getUint8(w+slot)/255;if(!weight)continue;
        const bone=data.getUint16(j+slot*2,true);
        influences.push({bone,weight,local:transformPoint(rigs.pilgrim.bones[bone].inverseBind,position)});
      }
      vertices.set(JSON.stringify([position,influences]),{position,influences});
    }
  }
  return [...vertices.values()];
}

function skinVertex(vertex,matrices){
  const result=[0,0,0];
  for(const {bone,weight,local} of vertex.influences){const p=transformPoint(matrices[bone],local);for(let axis=0;axis<3;axis++)result[axis]+=p[axis]*weight;}
  return result;
}

test.each([1,1.85])('drawn cape clears moving thighs, stays attached and settles after walking, running and turning at scale %s',async scale=>{
  const vertices=await capeVertices(),legVertices=vertices.filter(v=>v.position[1]<1.24),topEdge=vertices.filter(v=>v.position[1]>1.42),hem=vertices.filter(v=>v.position[1]<.45);
  expect(legVertices.length).toBeGreaterThan(100);expect(topEdge.length).toBeGreaterThanOrEqual(25);
  const anchorIndex=rigs.pilgrim.bones.findIndex(b=>b.name==='cloak1');
  for(const vertex of topEdge)expect(vertex.influences.every(influence=>influence.bone===anchorIndex)).toBe(true);
  await garment('pilgrim',({ecd,system,id,t,step,pose,play})=>{
    const bodies=system.bodies.get(id),legs=bodies.parts.filter(part=>/^thigh/.test(rigs.pilgrim.bones[part.bone].name)).map(part=>({
      part,shape:CapsuleShape3D.from(.12*scale,rigs.pilgrim.bones[part.bone].length*scale),
    }));
    expect(legs).toHaveLength(2);
    let x=0,z=0,nearest=Infinity,worst,excursion=0,settledSpeed=0,settledDrift=0;
    const previousHem=new Map(),settledHem=new Map();
    const local=new Float64Array(3);
    for(let frame=0;frame<330;frame++){
      const running=frame>=60&&frame<180,speed=(frame<60?1.8:running?4.8:0)*scale,yaw=Math.max(0,Math.min(1,(frame-100)/60))*Math.PI/3;
      const clip=running?'sword_run':frame<60?'sword_walk':'sword_idle';
      play(clip,frame>=180?0:(frame/60)%rigs.pilgrim.clips[clip].duration);
      x-=Math.sin(yaw)*speed/60;z-=Math.cos(yaw)*speed/60;
      const facing=yaw+Math.PI;
      t.setTranslation(x,0,z);t.setRotation(0,Math.sin(facing/2),0,Math.cos(facing/2));t.updateMatrix();t64_announce_change(ecd,id);step();
      const matrices=rigs.pilgrim.bones.map(b=>pose(b.name));
      for(const vertex of topEdge){
        const expected=transformPoint(matrices[anchorIndex],transformPoint(rigs.pilgrim.bones[anchorIndex].inverseBind,vertex.position));
        expect(distance(skinVertex(vertex,matrices),expected)).toBeLessThan(.00001*scale);
      }
      const anchor=matrices[anchorIndex];
      for(const vertex of hem){
        const p=skinVertex(vertex,matrices),rest=transformPoint(rigs.pilgrim.bones[anchorIndex].inverseBind,vertex.position).map(v=>v*scale);
        v3_quaternion_apply_inverse(local,0,p[0]-anchor.translation[0],p[1]-anchor.translation[1],p[2]-anchor.translation[2],...anchor.rotation);
        excursion=Math.max(excursion,distance(local,rest));
        const previous=previousHem.get(vertex);
        if(frame>=300&&previous)settledSpeed=Math.max(settledSpeed,distance(local,previous)*60);
        if(frame===300)settledHem.set(vertex,Array.from(local));
        if(frame>300)settledDrift=Math.max(settledDrift,distance(local,settledHem.get(vertex)));
        previousHem.set(vertex,Array.from(local));
      }
      for(const vertex of legVertices){
        const p=skinVertex(vertex,matrices);
        for(const {part,shape} of legs){
          const center=part.t.translation,q=part.t.rotation;
          v3_quaternion_apply_inverse(local,0,p[0]-center[0],p[1]-center[1],p[2]-center[2],...q);
          const d=shape.signed_distance_at_point(local);
          if(d<nearest){nearest=d;worst={frame,bone:rigs.pilgrim.bones[part.bone].name,bind:vertex.position};}
        }
      }
    }
    expect(nearest,JSON.stringify(worst)).toBeGreaterThan(-.008*scale);
    expect(excursion,'hem displacement in the shoulder frame').toBeLessThan(.35*scale);
    expect(settledDrift,`hem drift after two seconds without motion or wind; speed=${settledSpeed}`).toBeLessThan(.03*scale);
    expect(settledSpeed,`hem speed after two seconds without motion or wind; drift=${settledDrift}`).toBeLessThan(.15*scale);
  },{scale,yaw:Math.PI});
});

test.each([0,.7,Math.PI/2])('native banner cloth pins its full top edge and reverses its hem with world wind at yaw %s',async yaw=>{
  await garment('votiveBanner',({system,wind,step,pose})=>{
    const top=Array.from(pose('cloth0')),start=translation(pose('cloth4'));
    wind[2]=8;step(240);const forward=translation(pose('cloth4'));
    expect(Array.from(pose('cloth0'))).toEqual(top);expect(distance(start,forward)).toBeGreaterThan(.005);bounded(system.instances[0]);
    wind[2]=-8;step(480);const reverse=translation(pose('cloth4'));
    expect(Array.from(pose('cloth0'))).toEqual(top);expect(forward[2]).toBeGreaterThan(reverse[2]+.01);bounded(system.instances[0]);
  },{yaw});
});

test.each([1,1.85])('native cloak stays on its animated shoulder at scale %s',async scale=>{
  await garment('pilgrim',({ecd,system,id,t,wind,joints,step,pose})=>{
    const shoulder=ecd.getComponent(joints.chest,TransformAttachment),top=ecd.getComponent(joints.cloak1,TransformAttachment),bindTop=Array.from(top.transform);
    wind[0]=4;
    for(let i=0;i<180;i++){
      t.setTranslation(i*.012,0,0);t.updateMatrix();t64_announce_change(ecd,id);
      shoulder.transform.setRotation(0,0,Math.sin(Math.sin(i*.025)*.12),Math.cos(Math.sin(i*.025)*.12));shoulder.transform.updateMatrix();ecd.sendEvent(joints.chest,TRANSFORM_ATTACHMENT_EVENT_CHANGE);
      step();
      expect(Array.from(top.transform)).toEqual(bindTop);
      expect(distance(translation(pose('cloak1')),Array.from(system.instances[0].anchor_translation))).toBeLessThan(.00001);
      expect(distance(translation(pose('cloak1')),translation(pose('cloak3')))).toBeLessThan(scale*1.2);
      bounded(system.instances[0]);
    }
  },{scale,yaw:.7});
});

test('teleport and pooled removal/re-add reset native cloth without carrying stale momentum',async()=>{
  await garment('votiveBanner',({ecd,system,id,t,wind,step,pose,cloth})=>{
    wind[0]=8;step(180);const previous=system.instances[0];
    t.setTranslation(400,12,-300);t.updateMatrix();t64_announce_change(ecd,id);step();
    expect(previous.teleport_count).toBe(1);bounded(previous);
    expect(Array.from(previous.state.velocity).every(value=>value===0)).toBe(true);
    expect(distance(translation(pose('cloth0')),Array.from(previous.anchor_translation))).toBeLessThan(.00001);
    ecd.removeComponentFromEntity(id,Cloth);expect(system.instances).toHaveLength(0);
    t.setTranslation(-200,0,40);t.updateMatrix();t64_announce_change(ecd,id);step(30);
    wind.fill(0);ecd.addComponentToEntity(id,cloth);step(2);const restored=system.instances[0];
    expect(restored).not.toBe(previous);expect(restored.seeded).toBe(true);expect(restored.teleport_count).toBe(0);bounded(restored);
    expect(distance(translation(pose('cloth0')),Array.from(restored.anchor_translation))).toBeLessThan(.00001);
    const fresh=Array.from(restored.state.position);step(180);bounded(restored);
    expect(distance(fresh,Array.from(restored.state.position))).toBeLessThan(.1);
  });
});

test('cape cloth resolves five strips from shoulder to hem instead of bending as one central ribbon',async()=>{
  await garment('pilgrim',({system,wind,step,pose})=>{
    const instance=system.instances[0],{proxy}=clothComponents('pilgrim')[0];
    expect(instance.state.particle_count).toBe(41);
    expect(Array.from(proxy.joint_parent).filter(parent=>parent===-1)).toHaveLength(5);
    const top=Array.from(pose('cloak1'));
    const left=translation(pose('cloak37')),right=translation(pose('cloak41'));
    expect(right[0]-left[0]).toBeGreaterThan(.5);
    wind[0]=6;step(180);
    expect(Array.from(pose('cloak1'))).toEqual(top);
    expect(distance(left,translation(pose('cloak37')))).toBeGreaterThan(.01);
    expect(distance(right,translation(pose('cloak41')))).toBeGreaterThan(.01);
    bounded(instance);
  });
});

test('worker cloth advances the full actor and banner budget beyond the engine default of 32',async()=>{
  await garment('votiveBanner',({ecd,system,wind,step,prefab,models})=>{
    for(let i=1;i<104;i++){
      const t=new Transform64();t.setTranslation(i*4,0,0);t.updateMatrix();
      const id=new Entity().add(t).build(ecd);models.set(id,prefab_instantiate(prefab,ecd,id));
      for(const component of clothComponents('votiveBanner'))ecd.addComponentToEntity(id,component);
    }
    step(2);expect(system.instances).toHaveLength(104);
    const positions=system.instances.map(instance=>Array.from(instance.state.position));
    wind[0]=8;step(60);
    for(const [i,instance] of system.instances.entries()){
      expect(instance.state.isSharedMemory()).toBe(true);bounded(instance);
      expect(distance(positions[i],Array.from(instance.state.position)),`garment ${i} did not advance`).toBeGreaterThan(.001);
    }
  });
});

test('pooling a garment during an outstanding solve cannot write the retired pose into its replacement',async()=>{
  await garment('votiveBanner',({ecd,system,id,wind,step,pose,worker,cloth})=>{
    wind[0]=8;
    const previous=system.instanceOf(id),before=Array.from(pose('cloth4'));
    system.entityManager.fixedStepTick++;system.fixedUpdate(1/60);
    expect(system.is_step_in_flight).toBe(true);
    ecd.removeComponentFromEntity(id,Cloth);ecd.addComponentToEntity(id,cloth);
    const replacement=system.instanceOf(id);expect(replacement).not.toBe(previous);
    worker.host.runPendingStep();system.fixedUpdate(0);
    expect(Array.from(pose('cloth4'))).toEqual(before);
    step(2);expect(replacement.seeded).toBe(true);expect(replacement.state).not.toBe(previous.state);bounded(replacement);
  });
});

test('client clip filtering gives native cloth exclusive joint ownership and keeps body channels',()=>{
  for(const name of ['pilgrim','votiveBanner','briarHound']){
    const skeleton=createSkeleton(name),clothTargets=new Set(skeleton.data.bones.flatMap((bone,index)=>/^(cloak|cloth)\d+$/.test(bone.name)?[skeleton.joints[index]]:[]));
    const retained=skeleton.bundle.clips.map(clip=>clip.channels.filter(channel=>!clothTargets.has(channel.target)));
    unkeyCloth(skeleton);
    expect(skeleton.bundle.clips.map(clip=>clip.channels)).toEqual(retained);
    for(const clip of skeleton.bundle.clips)expect(clip.channels.every(channel=>!clothTargets.has(channel.target))).toBe(true);
    if(name==='pilgrim')expect(skeleton.bundle.clips.every(clip=>clip.channels.length>0)).toBe(true);
  }
});

test.each([1,1.85])('body capsules prevent cloak penetration under headwind at scale %s',async scale=>{
  const run=async enabled=>{
    let nearest=Infinity,worst;
    await garment('pilgrim',({ecd,system,wind,step,cloth})=>{
      const bodies=system.bodies.values().next().value;
      expect(bodies.parts).toHaveLength(16);
      for(const part of bodies.parts){
        const marker=ecd.getComponent(part.id,ClothCollider),shape=ecd.getComponent(part.id,Collider).shape;
        expect(marker.inflation).toBeCloseTo(.035*scale);
        expect(shape.radius).toBeGreaterThanOrEqual(rigs.pilgrim.bones[part.bone].radius*scale);
      }
      const {state}=system.instances[0],table=state.collider_table.slice(),count=state.collider_count;
      expect(count).toBeGreaterThan(0);cloth_collider_pose_at(table,count,1);
      if(!enabled)cloth.mask=0;
      wind[2]=12;
      const gradient=new Float64Array(3);
      for(let frame=0;frame<360;frame++){
        step();bounded(system.instances[0]);
        for(let c=0;c<count;c++)for(let p=0;p<state.particle_count;p++){
          if(state.mass_inverse[p]===0)continue;
          const d=cloth_collider_signed_distance(gradient,0,table,c,...state.position.subarray(p*3,p*3+3));
          if(d<nearest){nearest=d;worst={frame,particle:p,collider:c,position:Array.from(state.position.subarray(p*3,p*3+3))};}
        }
      }
    },{scale});
    return {nearest,worst};
  };
  const protectedDistance=await run(true),unprotectedDistance=await run(false);
  expect(protectedDistance.nearest,JSON.stringify(protectedDistance.worst)).toBeGreaterThan(-.005*scale);
  expect(unprotectedDistance.nearest).toBeLessThan(protectedDistance.nearest-.005*scale);
});

test('body colliders resize, teleport without sweeping, and are removed on pooling',async()=>{
  await garment('pilgrim',({ecd,system,id,t,step,cloth})=>{
    const first=system.bodies.get(id),radius=ecd.getComponent(first.parts[0].id,Collider).shape.radius;
    t.setScale(1.85,1.85,1.85);t.updateMatrix();t64_announce_change(ecd,id);step();
    const larger=system.bodies.get(id);
    expect(larger).not.toBe(first);expect(ecd.getComponent(larger.parts[0].id,Collider).shape.radius).toBeCloseTo(radius*1.85);
    t.setTranslation(300,0,-200);t.updateMatrix();t64_announce_change(ecd,id);step();
    expect(system.bodies.get(id)).not.toBe(larger);
    const index=system.world.colliders.index;
    // The entire collider index is this character; no previous pose spans the teleport.
    for(let handle=0;handle<index.count;handle++){
      if(!index.isLive(handle))continue;
      const o=handle*CCR_STRIDE;
      for(const [current,previous] of [[CCR_TX,CCR_PREV_TX],[CCR_TY,CCR_PREV_TY],[CCR_TZ,CCR_PREV_TZ]])expect(index.table[o+current]).toBe(index.table[o+previous]);
    }
    ecd.removeComponentFromEntity(id,Cloth);expect(system.bodies.size).toBe(0);
    expect(index.query([],-Infinity,-Infinity,-Infinity,Infinity,Infinity,Infinity,1,0xFFFFFFFF)).toBe(0);
    ecd.addComponentToEntity(id,cloth);step();expect(system.bodies.get(id).parts).toHaveLength(16);
    const rig=ecd.getComponent(id,ClothRig);
    ecd.removeComponentFromEntity(id,ClothRig);step();expect(system.bodies.size).toBe(0);
    ecd.addComponentToEntity(id,rig);step();expect(system.bodies.get(id).parts).toHaveLength(16);
    ecd.removeEntity(id);expect(system.bodies.size).toBe(0);expect(index.query([],-Infinity,-Infinity,-Infinity,Infinity,Infinity,Infinity,1,0xFFFFFFFF)).toBe(0);
  });
});
