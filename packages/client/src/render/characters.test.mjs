import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';
import {expect,test,vi} from 'vitest';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {MeshSystem} from '@woosh/meep-engine/src/engine/graphics3/MeshSystem.js';
import {AnimationSystem} from '@woosh/meep-engine/src/engine/graphics3/AnimationSystem.js';
import {SoftwareGPUDevice} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUDevice.js';
import {SoftwareGPUBuffer} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUBuffer.js';
import {SoftwareGPUTextureView} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUTextureView.js';
import {SoftwareGPUSampler} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUSampler.js';
import {ShadeGPUCommandContext} from '@woosh/meep-engine/src/shade/device/ShadeGPUCommandContext.js';
import {Scene} from '@woosh/meep-engine/src/shade/renderer/scene/Scene.js';
import {TransformAuthority} from '@woosh/meep-engine/src/shade/renderer/scene/TransformAuthority.js';
import {MeshletGeometry} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometry.js';
import {MeshletGeometrySerializationAdapter} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometrySerializationAdapter.js';
import {StandardShadeMaterial} from '@woosh/meep-engine/src/shade/renderer/material/StandardShadeMaterial.js';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {actorJointPoses,rigs} from '@old-circle/game/simulation/animation.mjs';
import {Characters} from './characters.mjs';
import {BOSSES} from '@old-circle/game/content/catalog.mjs';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {TransparencyMode} from '@woosh/meep-engine/src/shade/renderer/material/TransparencyMode.js';

test.each(['pool','teardown'])('character %s reuses skin allocations and resets death presentation',async mode=>{
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
    },remove:parts=>{for(const {id} of parts)ecd.removeEntity(id);}};
    const characters=new Characters(view);
    view.meshSystem=new MeshSystem(facade,scene,async url=>characters.bundle(url));
    view.animations=new AnimationSystem(facade,view.meshSystem);
    em.addSystem(view.meshSystem);em.addSystem(view.animations);em.attachDataset(ecd);
    await new Promise((resolve,reject)=>em.startup(resolve,reject));started=true;
    for(const [name,file] of [['pilgrim','pilgrim-0.meep'],['briarHound','briarHound-0.meep']]){
      const bytes=await readFile(new URL(`../../public/assets/geometry/${file}`,import.meta.url));
      const buffer=new BinaryBuffer();buffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      const geometry=new MeshletGeometry();new MeshletGeometrySerializationAdapter().deserialize(buffer,geometry);
      view.models.set(name,[{geometry,material:new StandardShadeMaterial()}]);
      graphics.geometries.add(geometry);
    }
    const baseBytes=graphics.geometries.meshlets.gpu_memory_usage_occupied;
    const flush=()=>{
      em.simulate(0);context.build();
      const cmd=ShadeGPUCommandContext.create(graphics,'character lifecycle regression');
      context.animation_manager.update(cmd);cmd.finish();
    };
    const actors=[{kind:'enemy',archetype:'hollow',weapon:'sword'},{kind:'enemy',archetype:'hound',weapon:'sword'}].map(a=>({...a,x:0,y:1,z:0,yaw:0,vx:0,vy:0,vz:0,grounded:true}));
    let peakVertices,peakBlasBytes,sceneNodeCount;
    for(let cycle=0;cycle<8;cycle++){
      const instances=actors.map(a=>characters.create(a));
      await setImmediate();flush();
      for(let i=0;i<instances.length;i++){
        const rig=instances[i],instance=view.meshSystem.instance_of(rig.id),skin=instance.skins[0];
        expect(skin.joints.every(joint=>joint.transform_authority===TransformAuthority.GPU)).toBe(true);
        expect(skin.meshes[0].material.diffuse_color.a).toBe(1);
        characters.update(rig,actors[i]);
      }
      flush();
      sceneNodeCount??=scene.instances.nodes.length;
      peakBlasBytes??=graphics.geometries.blas.buffer_data.size;
      // MEEP-012: keep the game pool until BLAS node ranges are reclaimed too.
      if(mode==='pool')expect(graphics.geometries.blas.buffer_data.size).toBe(peakBlasBytes);
      expect(context.animation_manager.skin_matrix_count).toBe(rigs.pilgrim.bones.length+rigs.briarHound.bones.length);
      peakVertices??=context.skinning.prev_position_vertex_count;
      expect(peakVertices).toBeGreaterThan(0);
      expect(context.skinning.prev_position_vertex_count).toBe(peakVertices);
      expect(graphics.geometries.meshlets.gpu_memory_usage_occupied).toBe(baseBytes*2);
      const rig=instances[0];
      // No weapon geometry is needed here; separate entities exercise attachment cleanup.
      const weapon=rig.weapon;rig.weapon=null;
      characters.corpse(rig,{name:'pilgrim',scale:1,age:44,joints:actorJointPoses(actors[0])});
      rig.weapon=weapon;
      if(mode==='pool'){
        rig.telegraph=view.model();rig.lantern={parts:view.model(),light:{id:ecd.createEntity()}};
      }
      const deadMesh=view.meshSystem.instance_of(rig.id).skins[0].meshes[0];
      expect(deadMesh.material.diffuse_color.a).toBeCloseTo(.25);
      for(const rig of instances){
        if(mode==='pool')characters.remove(rig);
        else{view.remove(rig.weapon??[]);ecd.removeEntity(rig.id);}
      }
      flush();
      expect(ecd.entityCount).toBe(mode==='pool'?instances.length:0);
      for(const rig of instances){
        if(mode==='teardown')expect(view.meshSystem.instance_of(rig.id)).toBeNull();
        expect(view.animations.playbacks_of(rig.id)).toHaveLength(0);
      }
      expect(scene.instances.nodes).toHaveLength(mode==='pool'?sceneNodeCount:0);
      expect(graphics.geometries.meshlets.gpu_memory_usage_occupied).toBe(baseBytes*(mode==='pool'?2:1));
    }
    if(mode==='teardown'){
      const pending=characters.create(actors[0]);view.remove(pending.weapon);ecd.removeEntity(pending.id);
      await setImmediate();flush();
      expect(ecd.entityCount).toBe(0);expect(scene.instances.nodes).toHaveLength(0);
      expect(graphics.geometries.meshlets.gpu_memory_usage_occupied).toBe(baseBytes);
    }
  }finally{
    if(started)await new Promise((resolve,reject)=>em.shutdown(resolve,reject));
    context?.destroy();graphics?.destroy();device.destroy();vi.unstubAllGlobals();
  }
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
  const shared=new StandardShadeMaterial(),other={material:shared},body={material:shared,updateMatrices(){}};
  const weapon=new Entity().add(ShadedGeometry.from({},shared)).build(ecd),lantern=new Entity().add(ShadedGeometry.from({},shared)).build(ecd);
  const originalWeapon=ecd.getComponent(weapon,ShadedGeometry),originalLantern=ecd.getComponent(lantern,ShadedGeometry);
  let ready=false;
  const renderer=new Characters({ecd,meshSystem:{instance_of:()=>ready?{}:null,traverse_meshes:(id,visit)=>visit(body)}});
  const rig={id:0,weapon:[{id:weapon}],lantern:{parts:[{id:lantern}]}};
  renderer.viewAlpha(rig,0);expect(rig.viewMaterials).toBeUndefined();ready=true;
  renderer.viewAlpha(rig,.25);
  const faded=body.material,fadedWeapon=ecd.getComponent(weapon,ShadedGeometry);
  for(const material of [faded,fadedWeapon.material,ecd.getComponent(lantern,ShadedGeometry).material]){
    expect(material).not.toBe(shared);expect(material.transparency_mode).toBe(TransparencyMode.Transparent);expect(material.diffuse_color.a).toBe(.25);
  }
  expect(other.material.diffuse_color.a).toBe(1);expect(shared.transparency_mode).toBe(TransparencyMode.Opaque);
  renderer.viewAlpha(rig,0);expect(body.material).toBe(faded);expect(faded.diffuse_color.a).toBe(0);expect(ecd.getComponent(weapon,ShadedGeometry)).toBe(fadedWeapon);
  renderer.viewAlpha(rig,1);expect(body.material).toBe(shared);expect(ecd.getComponent(weapon,ShadedGeometry)).toBe(originalWeapon);expect(ecd.getComponent(lantern,ShadedGeometry)).toBe(originalLantern);
  renderer.viewAlpha(rig,.5);expect(body.material).toBe(faded);
  renderer.clearViewAlpha(rig);expect(body.material).toBe(shared);expect(rig.viewMaterials).toBeNull();expect(ecd.getComponent(weapon,ShadedGeometry)).toBe(originalWeapon);
  rig.dead=true;renderer.viewAlpha(rig,0);expect(body.material).toBe(shared);
});
