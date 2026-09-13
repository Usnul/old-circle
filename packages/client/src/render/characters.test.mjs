import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {expect,test,vi} from 'vitest';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_evaluate_world} from '@woosh/meep-engine/src/engine/ecs/transform/t64_evaluate_world.js';
import {MeshSystem} from '@woosh/meep-engine/src/engine/graphics3/MeshSystem.js';
import {ShadedGeometrySystem} from '@woosh/meep-engine/src/engine/graphics3/ShadedGeometrySystem.js';
import {AnimationSystem} from '@woosh/meep-engine/src/engine/graphics3/AnimationSystem.js';
import {Animation} from '@woosh/meep-engine/src/engine/ecs/animation/Animation.js';
import {Cloth} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/Cloth.js';
import {ClothRig} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothRig.js';
import {ClothColliderSystem} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothColliderSystem.js';
import {TransformAttachmentSystem} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachmentSystem.js';
import {WorldCloth} from './cloth.mjs';
import {clothWorker,stepWorker} from './worker-test-helpers.mjs';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {SoftwareGPUDevice} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUDevice.js';
import {SoftwareGPUBuffer} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUBuffer.js';
import {SoftwareGPUTextureView} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUTextureView.js';
import {SoftwareGPUSampler} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUSampler.js';
import {ShadeGPUCommandContext} from '@woosh/meep-engine/src/shade/device/ShadeGPUCommandContext.js';
import {Scene} from '@woosh/meep-engine/src/shade/renderer/scene/Scene.js';
import {GPUStateAuthority} from '@woosh/meep-engine/src/engine/ecs/gpu/GPUStateAuthority.js';
import {GPUStateAuthorityFlags} from '@woosh/meep-engine/src/engine/ecs/gpu/GPUStateAuthorityFlags.js';
import {MeshletGeometry} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometry.js';
import {MeshletGeometrySerializationAdapter} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometrySerializationAdapter.js';
import {StandardShadeMaterial} from '@woosh/meep-engine/src/shade/renderer/material/StandardShadeMaterial.js';
import {Light} from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {actorJointPoses,createSimulationSkeleton,rigs} from '@old-circle/game/simulation/animation.mjs';
import {Characters} from './characters.mjs';
import {BOSSES} from '@old-circle/game/content/catalog.mjs';
import {ARMOR} from '@old-circle/game/content/equipment.mjs';

test('the compiled catalogue retains every playable and keeper skin after a world rebake',async()=>{
  const root=new URL('../../public/assets/geometry/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  const names=['pilgrim','briarHound','votiveBanner',...Object.values(ARMOR).filter(a=>a.appearance!=='pilgrim').map(a=>'armor_'+a.appearance),...Object.keys(BOSSES).map(id=>'boss_'+id)];
  for(const name of names){
    const chunks=manifest.models[name];expect(chunks,`Missing character skin: ${name}`).toBeDefined();expect(chunks.length).toBeGreaterThan(0);
    for(const chunk of chunks)expect((await readFile(new URL(chunk.file,root))).byteLength).toBe(chunk.bytes);
  }
});
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {SHADED_GEOMETRY_EVENT_CHANGE} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/SHADED_GEOMETRY_EVENT_CHANGE.js';
import {TransparencyMode} from '@woosh/meep-engine/src/shade/renderer/material/TransparencyMode.js';

async function withNativeCharacters(run){
  // WebGPU's browser constants, with Meep's software device executing buffer operations in Node.
  vi.stubGlobal('GPUBufferUsage',{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512});
  vi.stubGlobal('GPUShaderStage',{VERTEX:1,FRAGMENT:2,COMPUTE:4});
  vi.stubGlobal('GPUTextureUsage',{COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,STORAGE_BINDING:8,RENDER_ATTACHMENT:16});
  vi.stubGlobal('GPUMapMode',{READ:1,WRITE:2});
  vi.stubGlobal('GPUBuffer',SoftwareGPUBuffer);
  vi.stubGlobal('GPUTextureView',SoftwareGPUTextureView);
  vi.stubGlobal('GPUSampler',SoftwareGPUSampler);
  const device=new SoftwareGPUDevice();
  const em=new EntityManager(),ecd=new EntityComponentDataset(),scene=new Scene();
  let graphics,context,started=false;
  try{
    const {GraphicsContext}=await import('@woosh/meep-engine/src/shade/renderer/GraphicsContext.js');
    const {GPUSceneContext}=await import('@woosh/meep-engine/src/shade/renderer/scene/GPUSceneContext.js');
    graphics=new GraphicsContext(device);context=new GPUSceneContext(graphics,scene);
    context.geometries=graphics.geometries;context.materials=graphics.materials;
    const facade={set_scene:()=>{},scene_context:()=>context};
    const view={ecd,models:new Map(),materials:{},model:()=>{
      const id=ecd.createEntity(),t=new Transform64();ecd.addComponentToEntity(id,t);return [{id,t}];
    },light:(position,color,intensity,type,shadow,distance,radius)=>{
      const t=new Transform64(),l=new Light(),id=ecd.createEntity();
      ecd.addComponentToEntity(id,t);ecd.addComponentToEntity(id,l);
      t.setTranslation(...position);l.intensity.set(intensity);l.distance.set(distance);l.radius.set(radius);l.color.set(...color);l.type.set(type);l.castShadow.set(shadow);
      return {id,t,l};
    },remove:parts=>{for(const {id} of parts)ecd.removeEntity(id);}};
    const characters=new Characters(view);
    view.meshSystem=new MeshSystem(facade,scene,async url=>characters.bundle(url));
    view.animations=new AnimationSystem(facade,view.meshSystem);
    // a model's primitives are entities, and the system that owns primitives is what puts them in the scene
    em.addSystem(view.meshSystem);em.addSystem(new ShadedGeometrySystem(facade,scene));em.addSystem(view.animations);
    em.addSystem(new TransformAttachmentSystem());em.addSystem(new ClothColliderSystem());view.cloth=new WorldCloth({sample:out=>{out.fill(0);return out;},varies:()=>false},{worker_factory:clothWorker});em.addSystem(view.cloth);em.attachDataset(ecd);
    ecd.registerComponentType(Light);
    await new Promise((resolve,reject)=>em.startup(resolve,reject));started=true;
    for(const [name,file] of [['pilgrim','pilgrim-0.meep'],['briarHound','briarHound-0.meep']]){
      const bytes=await readFile(new URL(`../../public/assets/geometry/${file}`,import.meta.url));
      const buffer=new BinaryBuffer();buffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      const geometry=new MeshletGeometry();new MeshletGeometrySerializationAdapter().deserialize(buffer,geometry);
      view.models.set(name,[{geometry,material:new StandardShadeMaterial()}]);
      graphics.geometries.add(geometry);
    }
    const flush=()=>{
      em.simulate(0);context.build();
      const cmd=ShadeGPUCommandContext.create(graphics,'character lifecycle regression');
      context.animation_manager.update(cmd);cmd.finish();
    };
    await run({characters,view,scene,graphics,context,flush});
  }finally{
    if(started)await new Promise((resolve,reject)=>em.shutdown(resolve,reject));
    context?.destroy();graphics?.destroy();device.destroy();vi.unstubAllGlobals();
  }
}

test('presentation updates publish manual animation and gait samples without an engine tick',async()=>{
  await withNativeCharacters(async({characters,view,context})=>{
    const actor={kind:'enemy',archetype:'hollow',weapon:'sword',x:0,y:1,z:0,yaw:0,vx:0,vy:0,vz:-.3,grounded:true,animationTime:0,gaitPhase:0};
    const rig=characters.create(actor);
    await setImmediate();
    characters.update(rig,actor);view.animations.update(0);
    const publishTime=vi.spyOn(context.animation_manager,'set_time');
    try{
      for(const [animationTime,gaitPhase] of [[.4,.14],[.8,.28],[1.2,.42]]){
        Object.assign(actor,{animationTime,gaitPhase});
        publishTime.mockClear();
        characters.update(rig,actor);
        view.animations.update(0);
        const poses=[];
        expect(view.animations.write_pose_playbacks(poses,rig.id)).toBe(true);
        expect(poses.map(p=>p.clip.name)).toEqual(['sword_idle','sword_walk']);
        const expectedTimes=[animationTime/3.2*rigs.pilgrim.clips.sword_idle.duration,gaitPhase/1.12*rigs.pilgrim.clips.sword_walk.duration];
        expect(publishTime).toHaveBeenCalledTimes(2);
        for(let i=0;i<poses.length;i++){
          expect(poses[i].time).toBeCloseTo(expectedTimes[i]);
          expect(poses[i].weight).toBeCloseTo(.5);
          expect(publishTime.mock.calls[i][1]).toBeCloseTo(expectedTimes[i]);
        }
      }
    }finally{publishTime.mockRestore();}
  });
});

test.each([1,1.85])('cloth body capsules follow GPU clip poses and release on death at scale %s',async scale=>{
  await withNativeCharacters(async({characters,view})=>{
    const actor={kind:'enemy',archetype:'hollow',weapon:'sword',x:3,y:1,z:2,yaw:.7,vx:0,vy:0,vz:-3,grounded:true,animationTime:.8,gaitPhase:.28};
    const rig=characters.create(actor);await setImmediate();
    characters.update(rig,actor);rig.t.setScale(scale,scale,scale);rig.t.updateMatrix();view.animations.update(0);
    stepWorker(view.cloth);
    const bodies=view.cloth.bodies.get(rig.id),playbacks=[];view.animations.write_pose_playbacks(playbacks,rig.id);
    expect(bodies.parts).toHaveLength(16);
    let differsFromRest=false;
    for(const part of bodies.parts){
      const joint=bodies.skin.joints[part.bone],half=rigs.pilgrim.bones[part.bone].length/2;
      const pose=t64_evaluate_world(new Transform64(),view.ecd,joint,playbacks),rest=t64_evaluate_world(new Transform64(),view.ecd,joint,[]);
      const center=m=>[m[12]+m[4]*half,m[13]+m[5]*half,m[14]+m[6]*half];
      for(let axis=0;axis<3;axis++)expect(part.t.translation[axis]).toBeCloseTo(center(pose)[axis],6);
      differsFromRest||=Math.hypot(...center(pose).map((v,i)=>v-center(rest)[i]))>.05;
    }
    expect(differsFromRest).toBe(true);
    characters.corpse(rig,{name:'pilgrim',scale,age:0,joints:actorJointPoses(actor)});
    expect(view.cloth.bodies.size).toBe(0);
    for(const part of bodies.parts)expect(view.ecd.entityExists(part.id)).toBe(false);
  });
});

test.each(['pool','teardown'])('character %s reuses skin allocations and resets death presentation',async mode=>{
  await withNativeCharacters(async({characters,view,scene,graphics,context,flush})=>{
    const {ecd}=view,baseBytes=graphics.geometries.meshlets.gpu_memory_usage_occupied;
    const actors=[{kind:'enemy',archetype:'hollow',weapon:'sword'},{kind:'enemy',archetype:'hound',weapon:'sword'}].map(a=>({...a,x:0,y:1,z:0,yaw:0,vx:0,vy:0,vz:0,grounded:true}));
    let peakVertices,peakBlasBytes,pooledEntityCount;
    for(let cycle=0;cycle<8;cycle++){
      const instances=actors.map(a=>characters.create(a));
      await setImmediate();flush();
      for(let i=0;i<instances.length;i++){
        const rig=instances[i],instance=view.meshSystem.instance_of(rig.id),skin=instance.skins[0];
        expect(ecd.getComponent(skin.meshes[0],ShadedGeometry).material.diffuse_color.a).toBe(1);
        characters.update(rig,actors[i]);
      }
      flush();
      // New clip bindings must leave cloth offsets CPU-owned on every reuse.
      for(const rig of instances){
        const bones=rigs[rig.url.split(':')[0]].bones;
        for(const [i,joint] of view.meshSystem.instance_of(rig.id).skins[0].joints.entries()){
          const owned=ecd.getComponent(joint,GPUStateAuthority).flags&GPUStateAuthorityFlags.TransformAttachment;
          expect(Boolean(owned),bones[i].name).toBe(!bones[i].name.startsWith('cloak'));
        }
      }
      peakBlasBytes??=graphics.geometries.blas.buffer_data.size;
      // MEEP-012: keep the game pool until BLAS node ranges are reclaimed too.
      if(mode==='pool')expect(graphics.geometries.blas.buffer_data.size).toBe(peakBlasBytes);
      expect(context.animation_manager.skin_matrix_count).toBe(rigs.pilgrim.bones.length+rigs.briarHound.bones.length);
      peakVertices??=context.skinning.prev_position_vertex_count;
      expect(peakVertices).toBeGreaterThan(0);
      expect(context.skinning.prev_position_vertex_count).toBe(peakVertices);
      expect(graphics.geometries.meshlets.gpu_memory_usage_occupied).toBe(baseBytes*2);
      const rig=instances[0];
      // Fade the skin alone: weapon entities need no geometry for the pose/cleanup checks.
      const weapon=rig.weapon;rig.weapon=null;
      const deadMesh=view.meshSystem.instance_of(rig.id).skins[0].meshes[0],materialOf=()=>ecd.getComponent(deadMesh,ShadedGeometry).material,opaqueMaterial=materialOf();
      characters.viewAlpha(rig,.25);
      rig.weapon=weapon;
      for(const age of [0,41,44,45]){
        const weaponPose={position:[3+age/10,.15,2],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2]};
        characters.corpse(rig,{name:'pilgrim',scale:1,age,joints:actorJointPoses(actors[0]),weapon:'sword',weaponPose});
        expect(view.cloth.instanceOf(rig.id)).toBeUndefined();
        for(const {t} of weapon){expect(Array.from(t.translation)).toEqual(weaponPose.position);expect(Array.from(t.rotation)).toEqual(weaponPose.rotation);}
        expect(materialOf()).toBe(opaqueMaterial);
        expect(materialOf().transparency_mode).toBe(TransparencyMode.Opaque);
        expect(materialOf().diffuse_color.a).toBe(1);
      }
      if(mode==='pool'){
        rig.telegraph=view.model();rig.lantern={parts:view.model(),chain:{dispose(){}},light:{id:ecd.createEntity()}};
      }
      for(const rig of instances){
        if(mode==='pool')characters.remove(rig);
        else{view.remove(rig.weapon??[]);ecd.removeEntity(rig.id);}
      }
      flush();
      expect(view.cloth.instances).toHaveLength(0);
      // pooled: the rigs and the models they keep offstage — entities now — and no more of them each cycle; torn down: nothing
      if(mode==='pool'){pooledEntityCount??=ecd.entityCount;expect(pooledEntityCount).toBeGreaterThan(instances.length);expect(ecd.entityCount).toBe(pooledEntityCount);}
      else expect(ecd.entityCount).toBe(0);
      for(const rig of instances){
        if(mode==='teardown')expect(view.meshSystem.instance_of(rig.id)).toBeNull();
        expect(view.animations.playbacks_of(rig.id)).toHaveLength(0);
      }
      expect(graphics.geometries.meshlets.gpu_memory_usage_occupied).toBe(baseBytes*(mode==='pool'?2:1));
    }
    if(mode==='teardown'){
      const pending=characters.create(actors[0]);view.remove(pending.weapon);ecd.removeEntity(pending.id);
      await setImmediate();flush();
      expect(ecd.entityCount).toBe(0);
      expect(graphics.geometries.meshlets.gpu_memory_usage_occupied).toBe(baseBytes);
    }
  });
});

test('newly received corpses place dropped weapons before the skin loads and never follow the hand',()=>{
  // the joints physics writes are entities, so the corpse's skeleton and the view share a dataset
  const skeleton=createSimulationSkeleton('pilgrim'),ecd=skeleton.dataset;ecd.registerManyComponentTypes([SGMesh,Animation,Cloth,ClothRig]);let ready=false;
  const view={ecd,meshSystem:{instance_of:()=>ready?{skins:[{joints:skeleton.joints}]}:null},model:()=>{
    const t=new Transform64(),id=new Entity().add(t).build(ecd);return [{id,t}];
  },remove:parts=>{for(const {id} of parts)ecd.removeEntity(id);}};
  const characters=new Characters(view);
  const actor={kind:'enemy',archetype:'hollow',weapon:'sword',x:0,y:1,z:0,yaw:0,vx:0,vy:0,vz:0,grounded:true};
  const rig=characters.create(actor),[{id:weaponId,t}]=rig.weapon;
  const state={name:'pilgrim',scale:1.85,age:0,joints:actorJointPoses(actor),weapon:'sword',weaponPose:{position:[7,.2,4],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]}};
  characters.corpse(rig,state);expect(Array.from(t.translation)).toEqual(state.weaponPose.position);expect(Array.from(t.scale)).toEqual([1.85,1.85,1.85]);
  ready=true;characters.corpse(rig,state);
  for(const joint of state.joints)joint.position[0]+=10;
  characters.corpse(rig,state);expect(Array.from(t.translation)).toEqual(state.weaponPose.position);expect(Array.from(t.rotation)).toEqual(state.weaponPose.rotation);
  characters.remove(rig);expect(ecd.entityExists(weaponId)).toBe(false);
});

test('unadorned banner URLs and every keeper skin resolve to the correct shared rig, including newly received corpses',()=>{
  const requested=[],renderer=new Characters({models:{get(name){requested.push(name);return [];}},materials:{}});
  const banner=renderer.bundle('votiveBanner');expect(banner.skins[0].joints.length).toBe(rigs.votiveBanner.bones.length);expect(requested.at(-1)).toBe('votiveBanner');
  for(const archetype of Object.keys(BOSSES)){
    const corpse={kind:'enemy',archetype,weapon:'spear'},live={...corpse,boss:true};
    expect(renderer.appearance(corpse)).toBe(renderer.appearance(live));
    const bundle=renderer.bundle(renderer.appearance(live));expect(requested.at(-1)).toBe('boss_'+archetype);expect(bundle.skins[0].joints.length).toBe(rigs.pilgrim.bones.length);
  }
});

test('wall contact fades only the local skin and equipment, reuses materials and restores them before reuse',()=>{
  const ecd=new EntityComponentDataset();ecd.setComponentTypeMap([ShadedGeometry]);
  const shared=new StandardShadeMaterial(),other={material:shared};
  // the skin's primitive is an entity of the model's, like the weapon and the lantern are their own
  const body=new Entity().add(ShadedGeometry.from({},shared)).build(ecd),weapon=new Entity().add(ShadedGeometry.from({},shared)).build(ecd),lantern=new Entity().add(ShadedGeometry.from({},shared)).build(ecd);
  const materialOf=id=>ecd.getComponent(id,ShadedGeometry).material;
  // the fade is written on the components themselves and announced; nothing is replaced
  const components=[body,weapon,lantern].map(id=>ecd.getComponent(id,ShadedGeometry)),announced=[];
  for(const id of [body,weapon,lantern])ecd.addEntityEventListener(id,SHADED_GEOMETRY_EVENT_CHANGE,()=>announced.push(id));
  let ready=false;
  const renderer=new Characters({ecd,meshSystem:{instance_of:()=>ready?{}:null,mesh_entities_of:()=>[body]}});
  const rig={id:0,weapon:[{id:weapon}],lantern:{parts:[{id:lantern}]}};
  renderer.viewAlpha(rig,0);expect(rig.viewMaterials).toBeUndefined();ready=true;
  renderer.viewAlpha(rig,.25);
  const faded=materialOf(body),fadedWeapon=materialOf(weapon);
  for(const material of [faded,fadedWeapon,materialOf(lantern)]){
    expect(material).not.toBe(shared);expect(material.transparency_mode).toBe(TransparencyMode.Transparent);expect(material.diffuse_color.a).toBe(.25);
  }
  expect(announced).toEqual([body,weapon,lantern]);
  expect(other.material.diffuse_color.a).toBe(1);expect(shared.transparency_mode).toBe(TransparencyMode.Opaque);
  renderer.viewAlpha(rig,0);expect(materialOf(body)).toBe(faded);expect(faded.diffuse_color.a).toBe(0);expect(materialOf(weapon)).toBe(fadedWeapon);
  renderer.viewAlpha(rig,1);for(const id of [body,weapon,lantern])expect(materialOf(id)).toBe(shared);
  expect([body,weapon,lantern].map(id=>ecd.getComponent(id,ShadedGeometry))).toEqual(components);
  renderer.viewAlpha(rig,.5);expect(materialOf(body)).toBe(faded);
  renderer.clearViewAlpha(rig);expect(materialOf(body)).toBe(shared);expect(rig.viewMaterials).toBeNull();expect(materialOf(weapon)).toBe(shared);
  rig.dead=true;renderer.viewAlpha(rig,0);expect(materialOf(body)).toBe(shared);
});

test('newly spawned player corpses create and dispose lantern fixtures',async()=>{
  await withNativeCharacters(async({characters,view})=>{
    const actor={kind:'player',name:'pilgrim',appearance:'player',weapon:'sword',x:1,y:1,z:2,yaw:0.2,vx:0,vy:0,vz:0,grounded:true,scale:1,animationTime:0,gaitPhase:0};
    const rig=characters.create(actor);
    await setImmediate();
    expect(rig.lantern).toBeUndefined();
    const state={name:'pilgrim',appearance:'player',weapon:'sword',scale:1,age:0,joints:actorJointPoses(actor)};
    characters.corpse(rig,state);
    expect(rig.lantern).toBeDefined();
    expect(rig.lantern.parts.length).toBeGreaterThan(0);
    expect(rig.lantern.links.length).toBeGreaterThan(0);
    expect(rig.lantern.light).toBeDefined();
    const lightId=rig.lantern.light.id;
    const lanternParts=[...rig.lantern.parts],lanternLinks=rig.lantern.links.flatMap(link=>[...link]);
    expect(view.ecd.entityExists(lightId)).toBe(true);
    for(const part of lanternParts)expect(view.ecd.entityExists(part.id)).toBe(true);
    for(const part of lanternLinks)expect(view.ecd.entityExists(part.id)).toBe(true);
    const chain=rig.lantern.chain,bodies=chain.links.slice(),anchorX=chain.anchor.t.translation[0];
    actor.x+=.05;state.age=1/60;state.joints=actorJointPoses(actor);characters.corpse(rig,state);
    expect(chain.anchor.t.translation[0]-anchorX).toBeCloseTo(.05,5);
    expect(chain.links).toEqual(bodies);
    characters.remove(rig);
    expect(chain.physics.storage.size).toBe(0);
    expect(rig.lantern).toBeUndefined();
    expect(view.ecd.entityExists(lightId)).toBe(false);
    for(const part of lanternParts)expect(view.ecd.entityExists(part.id)).toBe(false);
    for(const part of lanternLinks)expect(view.ecd.entityExists(part.id)).toBe(false);
  });
});
