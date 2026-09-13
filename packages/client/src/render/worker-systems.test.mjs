import {expect,test,vi} from 'vitest';
import {Worker} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {TransformAttachmentSystem} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachmentSystem.js';
import {prefab_compile} from '@woosh/meep-engine/src/engine/graphics3/prefab/prefab_compile.js';
import {prefab_instantiate} from '@woosh/meep-engine/src/engine/graphics3/prefab/prefab_instantiate.js';
import {Skin} from '@woosh/meep-engine/src/shade/renderer/animation/Skin.js';
import {createSkeleton} from '@old-circle/game/simulation/animation.mjs';
import {WorldCloth,clothComponents,unkeyCloth} from './cloth.mjs';
import {WorldWind} from './wind.mjs';

test('the default cloth and fluid factories boot real workers, solve together, and terminate',async()=>{
  const workers=[],errors=[];
  // Supply browser transport globals; load the unmodified engine entry points.
  vi.stubGlobal('Worker',class {
    constructor(entry,options){
      expect(options.type).toBe('module');this.entry=entry;this.terminated=false;
      const source=`
        import {parentPort} from 'node:worker_threads';
        globalThis.postMessage=data=>parentPort.postMessage(data);
        parentPort.on('message',data=>globalThis.onmessage({data}));
        await import(${JSON.stringify(entry.href)});
      `;
      this.worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)));
      this.worker.on('message',data=>{if(data.type==='error')errors.push(data);this.onmessage?.({data});});
      this.worker.on('error',error=>{errors.push(error);this.onerror?.(error);});workers.push(this);
    }
    postMessage(data){this.worker.postMessage(data);}
    terminate(){this.terminated=true;this.stopped=this.worker.terminate();}
  });
  const em=new EntityManager(),ecd=new EntityComponentDataset(),wind=new WorldWind(),cloth=new WorldCloth(wind);
  em.addSystem(new TransformAttachmentSystem());em.addSystem(wind);em.addSystem(cloth);em.attachDataset(ecd);
  let started=false;
  try{
    await new Promise((resolve,reject)=>em.startup(resolve,reject));started=true;
    wind.attach(ecd);wind.follow(0,10,23);
    const skeleton=createSkeleton('votiveBanner');unkeyCloth(skeleton);
    skeleton.bundle.skins=[Skin.from({name:'votiveBanner',joints:skeleton.joints,inverse_bind_matrices:Float32Array.from(skeleton.data.bones.flatMap(b=>b.inverseBind)),meshes:[]})];
    const t=new Transform64();t.setTranslation(0,10,23);t.updateMatrix();
    const id=new Entity().add(t).build(ecd),model=prefab_instantiate(prefab_compile(skeleton.bundle),ecd,id);
    cloth.models={instance_of:entity=>entity===id?model:null};
    for(const component of clothComponents('votiveBanner'))ecd.addComponentToEntity(id,component);
    const deadline=performance.now()+5000;
    while((wind.last_joined_tick<12||cloth.last_joined_tick<12)&&performance.now()<deadline){
      em.simulate(1/60);await delay(2);
    }
    expect(workers.map(w=>w.entry.pathname.split('/').at(-1)).sort()).toEqual(['cloth.worker.js','fluid.worker.js']);
    expect(wind.last_joined_tick).toBeGreaterThanOrEqual(12);expect(cloth.last_joined_tick).toBeGreaterThanOrEqual(12);
    expect(wind.fluid.field.isSharedMemory()).toBe(true);expect(cloth.instanceOf(id).state.isSharedMemory()).toBe(true);
    expect(wind.sample([0,0,0],0,14,23).every(Number.isFinite)).toBe(true);expect(errors).toEqual([]);
  }finally{
    if(started)await new Promise((resolve,reject)=>em.shutdown(resolve,reject));
    const terminated=workers.every(w=>w.terminated);
    for(const worker of workers)if(!worker.terminated)worker.terminate();
    await Promise.all(workers.map(w=>w.stopped));vi.unstubAllGlobals();
    if(started)expect(terminated).toBe(true);
  }
  expect(wind.is_worker_alive).toBe(false);expect(cloth.is_worker_alive).toBe(false);expect(errors).toEqual([]);
});
