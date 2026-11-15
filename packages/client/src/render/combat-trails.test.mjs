import {afterAll,expect,test,vi} from 'vitest';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {FrameGraph} from '@woosh/meep-engine/src/engine/graphics/render/frame_graph/FrameGraph.js';
import {Trail3DSystem} from '@woosh/meep-engine/src/engine/graphics3/Trail3DSystem.js';
import {Trail3DFlags} from '@woosh/meep-engine/src/engine/graphics/ecs/trail3d/Trail3DFlags.js';
import {TRAIL_FLAG} from '@woosh/meep-engine/src/shade/renderer/trails/data/TRAIL_RECORD.js';
import {row_of_entity} from '@woosh/meep-engine/src/shade/renderer/scene/rows/GPUSceneRows.js';
import {SoftwareGPUDevice} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUDevice.js';
import {SoftwareGPUBuffer} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUBuffer.js';
import {SoftwareGPUTextureView} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUTextureView.js';
import {SoftwareGPUSampler} from '@woosh/meep-engine/src/shade/device/mock/SoftwareGPUSampler.js';
import {Scene} from '@woosh/meep-engine/src/shade/renderer/scene/Scene.js';
import {CombatTrails} from './combat-trails.mjs';
import {GameWorld} from '@old-circle/game/simulation/world.mjs';
import {weaponPose} from '@old-circle/game/simulation/weapon-pose.mjs';

vi.hoisted(()=>{
  vi.stubGlobal('GPUBufferUsage',{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512});
  vi.stubGlobal('GPUShaderStage',{VERTEX:1,FRAGMENT:2,COMPUTE:4});
  vi.stubGlobal('GPUTextureUsage',{COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,STORAGE_BINDING:8,RENDER_ATTACHMENT:16});
  vi.stubGlobal('GPUMapMode',{READ:1,WRITE:2});
});
afterAll(()=>vi.unstubAllGlobals());

test('native GPU trails follow the presented blade, skip warmup fade-in, fade outside damage windows, and clear across authority changes',async()=>{
  vi.stubGlobal('GPUBuffer',SoftwareGPUBuffer);
  vi.stubGlobal('GPUTextureView',SoftwareGPUTextureView);
  vi.stubGlobal('GPUSampler',SoftwareGPUSampler);
  const device=new SoftwareGPUDevice(),em=new EntityManager(),ecd=new EntityComponentDataset(),scene=new Scene();
  let graphics,context,started=false,world,extension=null,channel=null;
  try{
    const {GraphicsContext}=await import('@woosh/meep-engine/src/shade/renderer/GraphicsContext.js');
    const {GPUSceneContext}=await import('@woosh/meep-engine/src/shade/renderer/scene/GPUSceneContext.js');
    graphics=new GraphicsContext(device);context=new GPUSceneContext(graphics,scene);
    context.geometries=graphics.geometries;context.materials=graphics.materials;
    const facade={
      scene_context:s=>s===scene?context:null,
      add_extension(ext){extension=ext;},
      remove_extension(ext){if(extension===ext)extension=null;},
      add_transparency_channel(ch){channel=ch;},
      remove_transparency_channel(ch){if(channel===ch)channel=null;},
    };
    const system=new Trail3DSystem(facade,scene);em.addSystem(system);em.attachDataset(ecd);
    await new Promise((resolve,reject)=>em.startup(resolve,reject));started=true;
    expect(extension).not.toBeNull();expect(channel).not.toBeNull();
    const sceneView={scene:context};
    const recordFrame=()=>{context.build();extension.record({graph:new FrameGraph(),view:sceneView});};

    world=await new GameWorld().start({populate:false,navigation:false});
    const p=world.addPlayer('you'),trails=new CombatTrails({ecd});

    Object.assign(p,{attackAge:.1,attackId:1,attackKind:'weapon',grounded:true});
    trails.update([p],[],p,1,1/60);system.update(1/60);recordFrame();
    expect(system.runtime.count).toBe(0);
    expect(channel.avboit_is_empty(sceneView)).toBe(true);

    let initialSeed=null;
    for(let frame=0;frame<12;frame++){
      p.attackAge=.18+frame*.02;
      trails.update([p],[],p,1,1/60);system.update(1/60);
      if(frame===0)initialSeed=system.runtime.pending_seeds[0];
      recordFrame();
    }
    expect(system.runtime.count).toBe(1);
    expect(channel.avboit_is_empty(sceneView)).toBe(false);
    expect(system.runtime.pending_seeds).toHaveLength(0);
    const e=[...trails.entries.values()][0];
    expect(e.trail.warmup).toBe(false);
    expect(e.trail.color.w).toBeCloseTo(.66,5);
    expect(e.last).toEqual(weaponPose(p).end);
    expect(initialSeed?.staged.warmup).toBe(false);
    expect(initialSeed?.staged.spawning).toBe(true);
    expect(initialSeed?.node).toBe(row_of_entity(e.id));

    // A relocation > 3m triggers native clear(), queuing a GPU reseed on the next recorded frame.
    p.x+=10;
    trails.update([p],[],p,1,1/60);system.update(1/60);
    expect(e.trail.clearCount).toBe(1);
    expect(system.runtime.pending_seeds).toHaveLength(1);
    expect(system.runtime.pending_seeds[0].reseed).toBe(true);
    expect((system.runtime.table.get(system.runtime.pending_seeds[0].row).flags&TRAIL_FLAG.WARMUP)).toBe(0);
    recordFrame();
    expect(system.runtime.pending_seeds).toHaveLength(0);

    p.attackAge=.5;
    trails.update([p],[],p,1,1/60);system.update(1/60);recordFrame();
    expect(e.trail.getFlag(Trail3DFlags.Spawning)).toBe(false);
    for(let i=0;i<15;i++){trails.update([p],[],p,1,1/60);system.update(1/60);recordFrame();}
    expect(system.runtime.count).toBe(0);
    expect(channel.avboit_is_empty(sceneView)).toBe(true);

    p.attackAge=.22;trails.update([p],[],p,1,1/60);system.update(1/60);recordFrame();
    const prior=[...trails.entries.values()][0].trail;
    p.x+=150;trails.update([p],[],p,2,1/60);system.update(1/60);
    expect([...trails.entries.values()][0].trail).not.toBe(prior);
    expect(system.runtime.count).toBe(1);
    expect(system.runtime.pending_seeds[0]?.reseed).toBe(false);
    recordFrame();
    expect([...trails.entries.values()][0].last).toEqual(weaponPose(p).end);

    const shots=Array.from({length:100},(_,i)=>({id:i,weapon:'staff',position:[p.x+i*.1,p.y,p.z],age:.1}));
    trails.update([p],shots,p,2,1/60);system.update(1/60);recordFrame();
    expect(system.runtime.count).toBeLessThanOrEqual(24);
    trails.clear();system.update(0);recordFrame();
    expect(system.runtime.count).toBe(0);
    expect(channel.avboit_is_empty(sceneView)).toBe(true);
  }finally{
    await world?.stop();
    if(started)await new Promise((resolve,reject)=>em.shutdown(resolve,reject));
    context?.destroy();graphics?.destroy();device.destroy();
  }
});
