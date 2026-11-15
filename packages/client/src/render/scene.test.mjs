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
import {PerspectiveCamera as RenderCamera} from '@woosh/meep-engine/src/shade/renderer/camera/PerspectiveCamera.js';
import {Scene} from '@woosh/meep-engine/src/shade/renderer/scene/Scene.js';
import {MeshletGeometry} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometry.js';
import {StandardShadeMaterial} from '@woosh/meep-engine/src/shade/renderer/material/StandardShadeMaterial.js';
import {WorldView} from './scene.mjs';
import {Characters} from './characters.mjs';
import {GPUParticleEmitterSystem} from '@woosh/meep-engine/src/engine/graphics3/GPUParticleEmitterSystem.js';
import {layerEffect} from './particle-layers.mjs';
import {heightAt} from '@old-circle/game/world/regions.mjs';
import {rangedSightOrigin} from '@old-circle/game/simulation/aim.mjs';
import {WorldSky} from './sky.mjs';
import {octahedral_z_pole_uv_to_direction} from '@woosh/meep-engine/src/shade/renderer/light/environment/octahedral_z_pole_uv_to_direction.js';
import {octahedral_skirt_source_texel} from '@woosh/meep-engine/src/shade/renderer/light/environment/octahedral_skirt_source_texel.js';

// Exercise presentation and the real camera/mesh bridges without booting a browser or GPU.
vi.mock('@woosh/meep-engine/src/engine/EngineHarness.js',()=>({EngineHarness:class{}}));
vi.mock('./ground.mjs',()=>({WorldGround:class{}}));
vi.hoisted(()=>{
  vi.stubGlobal('GPUShaderStage',{VERTEX:1,FRAGMENT:2,COMPUTE:4});
  vi.stubGlobal('GPUBufferUsage',{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512});
});

afterEach(()=>vi.restoreAllMocks());
afterAll(()=>vi.unstubAllGlobals());

async function createView(){
  const em=new EntityManager(),ecd=new EntityComponentDataset(),scene=new Scene(),camera=new RenderCamera();
  // no device: the systems that place rows ask for a scene context and get none
  const graphics={isGraphicsEngine:true,camera:{camera},renderer:{},scene_context:()=>null};
  const emitterRows=new Set(),emitters=new Set(),particleContext={rows:{acquire:id=>emitterRows.add(id),release:id=>emitterRows.delete(id)}};
  const particleRenderer={add_emitter:emitter=>emitters.add(emitter),remove_emitter:emitter=>emitters.delete(emitter),registry:{context:emitter=>emitters.has(emitter)?{}:undefined}};
  const particles=new GPUParticleEmitterSystem({scene_context:()=>particleContext,renderer:{particles:()=>particleRenderer},add_extension(){},remove_extension(){}},scene,{hasLoaderForType:()=>true});
  em.addSystem(new CameraSystem(graphics));em.addSystem(new ShadedGeometrySystem(graphics,scene));em.addSystem(particles);em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));
  const view=new WorldView();view.engine={entityManager:em,graphics};view.ecd=ecd;
  view.cameraTransform=new Transform64();new Entity().add(new Camera()).add(view.cameraTransform).build(ecd);
  const transformEntity=()=>{const t=new Transform64(),id=new Entity().add(t).build(ecd);return {t,id};};
  const listener=transformEntity();view.listenerTransform=listener.t;view.listenerEntity=listener.id;
  view.sun={...transformEntity(),l:{intensity:{set(){}},color:{set(){}}}};
  view.sky={update:()=>({nightBlend:0,intensity:1,color:[1,1,1],direction:[0,-1,0]})};
  for(const name of ['streaming','ambient','banners','audio','footsteps','bossHazards','combatTrails','vfx'])view[name]={update(){}};
  view.streaming.updateView=()=>{};
  view.combatFeedback={update(){},cameraKick:()=>({pitch:0,roll:0})};view.animations={update:vi.fn()};view.particles=particles;
  view.characterRenderer={
    view,visibility:new Map(),visibleActors:Characters.prototype.visibleActors,publishAnimations:()=>view.animations.update(0),
    appearance:()=> 'player',
    create(){
      const t=new Transform64(),geometry=ShadedGeometry.from(new MeshletGeometry(),new StandardShadeMaterial()),id=new Entity().add(t).add(geometry).build(ecd);
      return {t,id,geometry,url:'player'};
    },
    update(rig,a){rig.t.setTranslation(a.x,a.y,a.z);rig.t.updateMatrix();t64_announce_change(ecd,rig.id);},
    remove(rig){ecd.removeEntity(rig.id);},
    viewAlpha(){}
  };
  return {view,em,ecd,camera,particles,emitterRows,emitters};
}

test.each([60,120,144])('lateral solo travel keeps the rendered camera and body together at %i Hz between engine ticks',async refresh=>{
  const clock=vi.spyOn(performance,'now').mockReturnValue(0);
  const {view,em,ecd,camera,particles,emitterRows,emitters}=await createView();
  try{
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
      // A native contact emitter created between engine ticks needs its GPU row
      // before the upcoming draw builds the scene and drains its one-shot burst.
      let contact;
      view.vfx.update=()=>{
        if(frame%4!==1)return;
        const effect=layerEffect('hit-flash');effect.texture=null;
        contact=new Entity().add(new Transform64()).add(effect).build(ecd);particles.burst(contact,1);
      };
      view.update(snapshot,actor.id,1/refresh,time);
      if(contact!==undefined){expect(emitterRows.has(contact)).toBe(true);expect(emitters.has(particles.emitter_of(contact))).toBe(true);ecd.removeEntity(contact);}
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

test('tiny characters skip presentation, nearby offscreen lights remain, and camera teleports wake characters in the same frame',async()=>{
  const {view,em}=await createView();
  try{
    view.pitch=-Math.asin(.7/view.distance);
    const player={id:'player',kind:'player',x:0,y:100,z:0,yaw:0,hp:100,weapon:'sword'};
    const enemy={...player,id:'enemy',kind:'enemy',archetype:'hollow'};
    const snapshot={actors:[player,{...enemy,id:'tiny',z:-500},{...enemy,id:'side',x:100},{...enemy,id:'behind',z:30}],projectiles:[],events:[],time:12};
    const create=vi.spyOn(view.characterRenderer,'create'),update=vi.spyOn(view.characterRenderer,'update');
    view.update(snapshot,player.id,1/60,0);
    expect([...view.characters.keys()]).toEqual(['player','side','behind']);
    expect(create).toHaveBeenCalledTimes(3);expect(update).toHaveBeenCalledTimes(3);
    player.z=-480;
    view.update(snapshot,player.id,1/60,1/60);
    expect(view.characters.has('tiny')).toBe(true);expect(create).toHaveBeenCalledTimes(4);
    // Local presentation remains even if its screen sphere would be tiny.
    const distantPlayer={...player,z:-100000};
    for(let frame=0;frame<10;frame++)expect(view.characterRenderer.visibleActors([distantPlayer],player.id,1,.1)).toEqual([distantPlayer]);
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
});

test('small characters need continuous dwell before presentation is removed, then wake immediately',async()=>{
  const {view,em}=await createView();
  try{
    view.pitch=-Math.asin(.7/view.distance);
    const player={id:'player',kind:'player',x:0,y:100,z:0,yaw:0,hp:100,weapon:'sword'};
    const enemy={...player,id:'enemy',kind:'enemy',archetype:'hollow',z:-10};
    const hidden={...enemy,z:-500};
    const snapshot={actors:[player,enemy],projectiles:[],events:[],time:12};
    const remove=vi.spyOn(view.characterRenderer,'remove'),create=vi.spyOn(view.characterRenderer,'create'),update=vi.spyOn(view.characterRenderer,'update');
    let time=0;const draw=actor=>{snapshot.actors=[player,actor];view.update(snapshot,player.id,.1,time+=.1);};
    draw(enemy);const rig=view.characters.get(enemy.id);expect(rig).toBeDefined();
    for(let frame=0;frame<4;frame++)draw(hidden);
    expect(view.characters.get(enemy.id)).toBe(rig);expect(remove).not.toHaveBeenCalled();
    draw(enemy); // A visible sample resets the continuous exit timer.
    for(let frame=0;frame<4;frame++)draw(hidden);
    expect(view.characters.get(enemy.id)).toBe(rig);expect(remove).not.toHaveBeenCalled();
    draw(hidden);
    expect(view.characters.has(enemy.id)).toBe(false);expect(remove).toHaveBeenCalledExactlyOnceWith(rig);
    update.mockClear();draw(hidden);
    expect(update).toHaveBeenCalledTimes(1);expect(update.mock.calls[0][1].id).toBe(player.id);
    draw(enemy);
    expect(view.characters.has(enemy.id)).toBe(true);expect(create).toHaveBeenCalledTimes(3);
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
});

test.each(['bow','staff'])('%s retains upward sight pitch when terrain retracts the camera boom',async weapon=>{
  vi.spyOn(performance,'now').mockReturnValue(0);
  const {view,em,camera}=await createView();
  try{
    const actor={id:'player',x:0,y:heightAt(0,0)+.845,z:0,yaw:0,hp:100,weapon};
    const snapshot={actors:[actor],projectiles:[],events:[],time:12,presentationEpoch:1,presentationFrame:0};
    view.pitch=-1.1;view.cameraLimit=.6;
    view.acceptSnapshot(snapshot);view.prepareToRender(snapshot,actor.id);
    view.update(snapshot,actor.id,1/60,0);
    const target=rangedSightOrigin(actor),sight=view.cameraPosition.map((v,i)=>v-target[i]);
    const expectedPitch=Math.atan2(Math.sin(view.pitch)*view.distance+.7,Math.cos(view.pitch)*view.distance);
    expect(view.wantedCamera[1]).toBeLessThan(heightAt(view.wantedCamera[0],view.wantedCamera[2]));
    expect(Math.hypot(...sight)).toBeCloseTo(.6,10);
    expect(view.aimPitch).toBeLessThan(-1);
    expect(view.aimPitch).toBeCloseTo(expectedPitch,10);
    expect(view.aimPitch).toBeCloseTo(Math.atan2(camera.transform.translation_y-target[1],Math.hypot(camera.transform.translation_x-target[0],camera.transform.translation_z-target[2])),10);
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
});

test('sky environment maps fill the 1-texel octahedral border skirt required by GPULightCollection and calibrate day/night radiance',()=>{
  const sky=new WorldSky(),texture=sky.texture(16),data=texture.image.source.data,size=256,source=new Uint32Array(2);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    if(x>0&&x<size-1&&y>0&&y<size-1)continue;
    octahedral_skirt_source_texel(source,x,y,size);
    const target=(y*size+x)*4,from=(source[1]*size+source[0])*4;
    expect(Array.from(data.subarray(target,target+4))).toEqual(Array.from(data.subarray(from,from+4)));
  }
  const upperMean=level=>{
    const f16=sky.texture(level).image.source.data,dir=new Float32Array(3),sum=[0,0,0];let weight=0,valid=true;
    for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
      octahedral_z_pole_uv_to_direction(dir,(x-.5)/254,(y-.5)/254);
      const o=(y*size+x)*4,r=f16[o],g=f16[o+1],b=f16[o+2];
      if(!(Number.isFinite(r)&&r>0&&Number.isFinite(g)&&g>0&&Number.isFinite(b)&&b>0&&f16[o+3]===1))valid=false;
      if(dir[1]>=0){const w=dir[1]+.05;sum[0]+=r*w;sum[1]+=g*w;sum[2]+=b*w;weight+=w;}
    }
    expect(valid).toBe(true);
    return sum.map(v=>v/weight);
  };
  const midnight=upperMean(0),dawn=upperMean(16),morning=upperMean(20),noon=upperMean(32);
  const lum=([r,g,b])=>.2126*r+.7152*g+.0722*b;
  expect(lum(noon)).toBeGreaterThan(lum(morning));
  expect(lum(morning)).toBeGreaterThan(lum(dawn));
  expect(noon[2]).toBeGreaterThan(noon[1]);expect(noon[1]).toBeGreaterThan(noon[0]);
  expect(midnight[2]).toBeGreaterThan(midnight[0]);

  const scene=new Scene();scene.atmosphere.enable_by_default();expect(scene.atmosphere.enabled).toBe(true);
  const light=sky.update(scene,12);
  expect(scene.atmosphere.enabled).toBe(false);
  expect(scene.lights.environment).toBe(sky.texture(32));
  expect(light.intensity).toBeGreaterThan(3);

  const secondScene=new Scene();secondScene.atmosphere.enable_by_default();
  sky.update(secondScene,12);
  expect(secondScene.atmosphere.enabled).toBe(false);
  expect(secondScene.lights.environment).toBe(sky.texture(32));

  // Dusk (18:00, level 48) and early twilight (18:22.5, level 49) keep the western horizon brighter than the east without a 180° flip.
  const horizonSide=(level,signX)=>{
    const f16=sky.texture(level).image.source.data,dir=new Float32Array(3);let sum=0,count=0;
    for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
      octahedral_z_pole_uv_to_direction(dir,(x-.5)/254,(y-.5)/254);
      if(dir[1]>.02&&dir[1]<.25&&dir[0]*signX>.8){const o=(y*size+x)*4;sum+=lum([f16[o],f16[o+1],f16[o+2]]);count++;}
    }
    return sum/count;
  };
  expect(horizonSide(48,-1)).toBeGreaterThan(horizonSide(48,1));
  expect(horizonSide(49,-1)).toBeGreaterThan(horizonSide(49,1));
});
