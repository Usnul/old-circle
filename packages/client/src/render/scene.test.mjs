import {afterAll,afterEach,expect,test,vi} from 'vitest';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {Camera} from '@woosh/meep-engine/src/engine/graphics/ecs/camera/Camera.js';
import {CameraSystem} from '@woosh/meep-engine/src/engine/graphics3/CameraSystem.js';
import {ShadedGeometrySystem} from '@woosh/meep-engine/src/engine/graphics3/ShadedGeometrySystem.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {Camera as RenderCamera} from '@woosh/meep-engine/src/shade/renderer/camera/Camera.js';
import {Scene} from '@woosh/meep-engine/src/shade/renderer/scene/Scene.js';
import {MeshletGeometry} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometry.js';
import {StandardShadeMaterial} from '@woosh/meep-engine/src/shade/renderer/material/StandardShadeMaterial.js';
import {WorldView} from './scene.mjs';

// Exercise presentation and the real camera/mesh bridges without booting a browser or GPU.
vi.mock('@woosh/meep-engine/src/engine/EngineHarness.js',()=>({EngineHarness:class{}}));
vi.mock('./ground.mjs',()=>({WorldGround:class{}}));
vi.hoisted(()=>{
  vi.stubGlobal('GPUShaderStage',{VERTEX:1,FRAGMENT:2,COMPUTE:4});
  vi.stubGlobal('GPUBufferUsage',{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512});
});

afterEach(()=>vi.restoreAllMocks());
afterAll(()=>vi.unstubAllGlobals());

test.each([60,120,144])('lateral solo travel keeps the rendered camera and body together at %i Hz between engine ticks',async refresh=>{
  const clock=vi.spyOn(performance,'now').mockReturnValue(0);
  const em=new EntityManager(),ecd=new EntityComponentDataset(),scene=new Scene(),camera=new RenderCamera();
  // no device: the systems that place rows ask for a scene context and get none
  const graphics={isGraphicsEngine:true,camera:{camera},renderer:{},scene_context:()=>null};
  em.addSystem(new CameraSystem(graphics));em.addSystem(new ShadedGeometrySystem(graphics,scene));em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));
  try{
    const view=new WorldView();view.engine={entityManager:em,graphics};view.ecd=ecd;
    view.cameraTransform=new Transform64();new Entity().add(new Camera()).add(view.cameraTransform).build(ecd);
    const transformEntity=()=>{const t=new Transform64(),id=new Entity().add(t).build(ecd);return {t,id};};
    const listener=transformEntity();view.listenerTransform=listener.t;view.listenerEntity=listener.id;
    view.sun={...transformEntity(),l:{intensity:{set(){}},color:{set(){}}}};
    view.sky={update:()=>({nightBlend:0,intensity:1,color:[1,1,1],direction:[0,-1,0]})};
    for(const name of ['streaming','ambient','banners','audio','footsteps','bossHazards','combatTrails','vfx'])view[name]={update(){}};
    view.streaming.updateView=()=>{};
    view.combatFeedback={update(){},cameraKick:()=>({pitch:0,roll:0})};view.animations={update:vi.fn()};
    view.characterRenderer={
      appearance:()=> 'player',
      create(){
        const t=new Transform64(),geometry=ShadedGeometry.from(new MeshletGeometry(),new StandardShadeMaterial()),id=new Entity().add(t).add(geometry).build(ecd);
        return {t,id,geometry,url:'player'};
      },
      update(rig,a){rig.t.setTranslation(a.x,a.y,a.z);rig.t.updateMatrix();t64_announce_change(ecd,rig.id);},
      viewAlpha(){}
    };
    let actor={id:'player',x:0,y:100,z:0,yaw:0,hp:100,weapon:'sword'};
    let snapshot={actors:[actor],projectiles:[],events:[],time:12,presentationEpoch:1,presentationFrame:0};
    view.acceptSnapshot(snapshot);view.prepareToRender(snapshot,actor.id);
    let tick=0,previousX=0;const speeds=[];
    for(let frame=1;frame<=refresh*2;frame++){
      const time=frame/refresh;
      while((tick+1)/60<=time){
        tick++;actor={...actor,x:tick/60*3.5};snapshot={...snapshot,actors:[actor],presentationFrame:tick};
        clock.mockReturnValue(tick/60*1000);view.acceptSnapshot(snapshot);
      }
      // The engine ticker is independent of draws and sometimes misses several.
      if(frame%4===0)em.simulate(1/30);
      // Callback workload varies even though display timestamps remain evenly spaced.
      clock.mockReturnValue((time+[.001,.005,.002,.004][frame%4])*1000);
      view.update(snapshot,actor.id,1/refresh,time);
      const body=view.characters.get(actor.id).t;
      expect(camera.transform.translation_x).toBeCloseTo(body.translation_x,10);
      expect(camera.transform.translation_z-body.translation_z).toBeCloseTo(5.8,10);
      if(time>.3)speeds.push((body.translation_x-previousX)*refresh);
      previousX=body.translation_x;
    }
    expect(Math.min(...speeds)).toBeGreaterThan(3);
    expect(Math.max(...speeds)).toBeLessThan(4);
    expect(view.animations.update).toHaveBeenCalledWith(0);
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
});
