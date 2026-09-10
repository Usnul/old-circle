import { EngineHarness } from '@woosh/meep-engine/src/engine/EngineHarness.js';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import { Transform64 } from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import { t64_look_rotation } from '@woosh/meep-engine/src/engine/ecs/transform/t64_look_rotation.js';
import { t64_announce_change } from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import { Quaternion } from '@woosh/meep-engine/src/core/geom/Quaternion.js';
import { Camera } from '@woosh/meep-engine/src/engine/graphics/ecs/camera/Camera.js';
import { CameraSystem } from '@woosh/meep-engine/src/engine/graphics3/CameraSystem.js';
import { ShadedGeometry } from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import { ShadedGeometrySystem } from '@woosh/meep-engine/src/engine/graphics3/ShadedGeometrySystem.js';
import {MeshSystem} from '@woosh/meep-engine/src/engine/graphics3/MeshSystem.js';
import {AnimationSystem} from '@woosh/meep-engine/src/engine/graphics3/AnimationSystem.js';
import { GPUParticleEmitterSystem } from '@woosh/meep-engine/src/engine/graphics3/GPUParticleEmitterSystem.js';
import { LightSystem } from '@woosh/meep-engine/src/engine/graphics3/LightSystem.js';
import { Light } from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import { ParticipatingMediaSystem } from '@woosh/meep-engine/src/engine/graphics3/ParticipatingMediaSystem.js';
import { ParticipatingMedia } from '@woosh/meep-engine/src/engine/graphics3/ParticipatingMedia.js';
import { MeshletGeometry } from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometry.js';
import { MeshletGeometrySerializationAdapter } from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometrySerializationAdapter.js';
import { StandardShadeMaterial } from '@woosh/meep-engine/src/shade/renderer/material/StandardShadeMaterial.js';
import {TransparencyMode} from '@woosh/meep-engine/src/shade/renderer/material/TransparencyMode.js';
import { BinaryBuffer } from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import { ShadeTexture } from '@woosh/meep-engine/src/shade/renderer/texture/ShadeTexture.js';
import { ShadeImage } from '@woosh/meep-engine/src/shade/renderer/texture/source/ShadeImage.js';
import { ColorSpace } from '@woosh/meep-engine/src/shade/renderer/texture/ColorSpace.js';
import { WorldAudio } from './audio.mjs';
import { WorldSky } from './sky.mjs';
import { buildLayout } from '@old-circle/game/world/layout.mjs';
import { heightAt } from '@old-circle/game/world/regions.mjs';
import { effect } from './effects.mjs';
import { PresentationPoses } from './presentation-poses.mjs';
import {WorldGround} from './ground.mjs';
import {Characters} from './characters.mjs';

const PALETTE={stone:[.36,.37,.30],stoneLight:[.52,.50,.39],stoneDark:[.20,.24,.22],grass:[.22,.31,.12],grassLight:[.39,.43,.19],bark:[.14,.12,.085],leaf:[.10,.21,.12],leafLight:[.20,.29,.13],brass:[.48,.31,.12],iron:[.20,.23,.24],cloth:[.065,.095,.10],leather:[.12,.07,.035],ember:[1,.37,.06],magic:[.20,.57,.76],bone:[.63,.60,.48],sand:[.48,.32,.19],snow:[.61,.70,.73],ice:[.34,.52,.59]};
const quat=new Quaternion();
export class WorldView {
  constructor(){this.models=new Map();this.characters=new Map();this.corpses=new Map();this.missiles=new Map();this.transients=[];this.yaw=0;this.pitch=0;this.distance=5.8;this.elapsed=0;this.cameraPosition=null;this.fps=60;this.poses=new PresentationPoses();}
  acceptSnapshot(snapshot){this.poses.accept(snapshot,performance.now()/1000);}
  async start(progress=()=>{}){
    progress('Kindling the light…',.1);
    this.characterRenderer=new Characters(this);
    this.engine=await EngineHarness.bootstrap({configuration:(config,engine)=>{
      this.scene=EngineHarness.shadeScene(engine);
      config.addSystem(new ShadedGeometrySystem(engine.graphics,this.scene));
      this.meshSystem=new MeshSystem(engine.graphics,this.scene,async url=>this.characterRenderer.bundle(url));config.addSystem(this.meshSystem);
      this.animations=new AnimationSystem(engine.graphics,this.meshSystem);config.addSystem(this.animations);
      config.addSystem(new CameraSystem(engine.graphics));config.addSystem(new LightSystem(engine.graphics,this.scene));
      this.particles=new GPUParticleEmitterSystem(engine.graphics,this.scene,engine.assetManager);config.addSystem(this.particles);
      config.addSystem(new ParticipatingMediaSystem(engine.graphics,this.scene));
    }});
    this.ecd=this.engine.entityManager.dataset;
    this.engine.viewStack.el.classList.add('meep-world');
    const renderer=this.engine.graphics.renderer;
    if(!renderer)throw new Error('Meep could not initialize WebGPU on this browser.');
    renderer.feature_particles_enabled=true;renderer.feature_bloom_enabled=true;renderer.feature_ssao_enabled=true;renderer.feature_taa_enabled=true;renderer.feature_shadows_enabled=true;
    renderer.feature_automatic_exposure_enabled=false;renderer.exposure_compensation=0;
    // Bound presentation resolution; asset inference never shares the GPU with this view.
    renderer.pixel_ratio=Math.min(devicePixelRatio,1.4);
    const camera=new Camera();camera.fov.set(57);camera.clip_near=.12;camera.clip_far=1100;
    this.cameraTransform=new Transform64();this.cameraEntity=new Entity().add(camera).add(this.cameraTransform).build(this.ecd);
    this.materials={};for(const [key,color] of Object.entries(PALETTE)){
      const m=new StandardShadeMaterial();m.diffuse_color.set(...color);m.roughness_factor=key==='iron'?.43:key==='brass'?.38:.92;m.metallic_factor=key==='iron'?.7:key==='brass'?.78:0;
      if(key==='ember')m.emissive_factor.set(4,1,.08);if(key==='magic')m.emissive_factor.set(.02,.17,.25);
      this.materials[key]=m;
    }
    this.materials.path=new StandardShadeMaterial();this.materials.path.diffuse_color.set(.28,.29,.23);
    this.materials.glassLeaf=new StandardShadeMaterial();this.materials.glassLeaf.diffuse_color.set(.12,.23,.27);
    this.materials.landscape=new StandardShadeMaterial();this.materials.landscape.roughness_factor=1;
    this.materials.cloak=new StandardShadeMaterial();
    this.sky=new WorldSky();
    const textures={};for(const name of ['stone','ground','bark','stone-normal','ground-normal','bark-normal']){
      const response=await fetch(`/assets/textures/${name}.png`),bitmap=await createImageBitmap(await response.blob());
      const image=ShadeImage.fromImageBitmap(bitmap);image.color_space=name.endsWith('-normal')?ColorSpace.None:ColorSpace.SRGB;textures[name]=ShadeTexture.from(image);
    }
    for(const name of ['stone','stoneLight','stoneDark','sand','snow','ice'])this.materials[name].texture_albedo=textures.stone;
    for(const name of ['grass','grassLight','path'])this.materials[name].texture_albedo=textures.ground;
    this.materials.bark.texture_albedo=textures.bark;
    for(const name of ['stone','stoneLight','stoneDark','sand','snow','ice'])this.materials[name].texture_normal=textures['stone-normal'];
    this.materials.landscape.texture_normal=textures['ground-normal'];this.materials.bark.texture_normal=textures['bark-normal'];
    for(const name of ['iron','brass','leather','cloth','cloak']){
      const material=this.materials[name];material.roughness_factor=1;material.metallic_factor=name==='iron'||name==='brass'?1:0;
      for(const [suffix,channel] of [['','albedo'],['-normal','normal'],['-orm','orm']]){
        const response=await fetch(`/assets/textures/${name}${suffix}.png`);if(!response.ok)throw new Error(`Missing material ${name}${suffix}`);
        const image=ShadeImage.fromImageBitmap(await createImageBitmap(await response.blob()));image.color_space=suffix?ColorSpace.None:ColorSpace.SRGB;
        material[`texture_${channel}`]=ShadeTexture.from(image);
      }
    }
    const manifest=await fetch('/assets/geometry/manifest.json').then(r=>r.json()),adapter=new MeshletGeometrySerializationAdapter();
    const entries=Object.entries(manifest.models);let complete=0;
    // Limited fetch concurrency avoids monopolizing browser networking during startup.
    for(let start=0;start<entries.length;start+=8){
      await Promise.all(entries.slice(start,start+8).map(async([name,chunks])=>{
        this.models.set(name,await Promise.all(chunks.map(async c=>{
          const response=await fetch(`/assets/geometry/${c.file}`);if(!response.ok)throw new Error(`Missing asset ${c.file}`);
          const buffer=new BinaryBuffer();buffer.fromArrayBuffer(await response.arrayBuffer());const geometry=new MeshletGeometry();adapter.deserialize(buffer,geometry);
          return {geometry,material:this.materials[c.material]};
        })));complete++;progress('Remembering the old road…',.15+complete/entries.length*.65);
      }));
    }
    const layout=buildLayout(),groundMeshes=[];for(const p of layout.props){const parts=this.model(p.model,p.position,p.scale,p.yaw);if(p.model.startsWith('terrain_'))for(const part of parts)groundMeshes.push(this.ecd.getComponent(part.id,ShadedGeometry).node);}
    this.ground=new WorldGround();await this.ground.start(this.engine.graphics,groundMeshes);
    this.audio=new WorldAudio(this.engine);await this.audio.start();
    this.sun=this.light([30,70,20],[1,.95,.83],2.8,Light.Type.DIRECTION,true);
    t64_look_rotation(this.sun.t,-.6,-.7,-.45,0,1,0);this.sun.t.updateMatrix();t64_announce_change(this.ecd,this.sun.id);
    for(let i=0;i<layout.lights.length;i++){
      const p=layout.lights[i];this.light(p,[1,.48,.13],42,Light.Type.POINT,i%5===0,8);
      this.emitter('embers',p,22);
    }
    this.motes=this.emitter('motes',[0,3,10],80);
    const fog=new ParticipatingMedia();fog.target_extinction=.0006;fog.fade_distance=30;
    const ft=new Transform64();ft.setTranslation(0,24,-120);ft.setScale(650,140,800);ft.updateMatrix();new Entity().add(fog).add(ft).build(this.ecd);
    for(const [x,z,w,d,strength] of [[-85,-55,65,90,.012],[35,-185,38,70,.014],[-112,-210,90,80,.009],[95,-248,85,80,.004],[0,-78,42,22,.009]]){
      const low=new ParticipatingMedia();low.target_extinction=strength;low.fade_distance=7;
      const lt=new Transform64();lt.setTranslation(x,heightAt(x,z)+2,z);lt.setScale(w,9,d);lt.updateMatrix();new Entity().add(low).add(lt).build(this.ecd);
    }
    progress('Remembering the daylight…',.96);await this.sky.prepare();
    progress('The circle opens.',1);return this;
  }
  model(name,position=[0,0,0],scale=[1,1,1],yaw=0,material=null){
    const chunks=this.models.get(name);if(!chunks)throw new Error(`Unknown Blender asset: ${name}`);
    const result=[];for(const c of chunks){const t=new Transform64();t.setTranslation(...position);t.setScale(...scale);t.setRotation(0,Math.sin(yaw/2),0,Math.cos(yaw/2));t.updateMatrix();const id=new Entity().add(t).add(ShadedGeometry.from(c.geometry,material??c.material)).build(this.ecd);result.push({id,t});}return result;
  }
  pose(parts,p,scale=1,yaw=0,pitch=0,roll=0){
    quat.fromEulerAnglesYXZ(pitch,yaw,roll);
    for(const {id,t} of parts){t.setTranslation(...p);t.setScale(scale,scale,scale);t.setRotation(...quat);t.updateMatrix();t64_announce_change(this.ecd,id);}
  }
  remove(parts){for(const {id} of parts)this.ecd.removeEntity(id);}
  light(p,color,intensity,type,shadow=false,distance=15){
    const l=new Light();l.type.set(type);l.color.set(...color);l.intensity.set(intensity);l.distance.set(distance);l.radius.set(.15);l.castShadow.set(shadow);l.maxShadowDistance.set(130);
    const t=new Transform64();t.setTranslation(...p);const id=new Entity().add(l).add(t).build(this.ecd);return {id,t,l};
  }
  emitter(kind,p,rate,life=0){const t=new Transform64();t.setTranslation(...p);const c=effect(kind,rate),id=new Entity().add(c).add(t).build(this.ecd);if(life)this.transients.push({id,c,life,age:0});return {id,t,c};}
  blastBoundary(ev){
    const [x,y,z]=ev.position,radius=ev.radius,material=this.materials[ev.effect==='frost'?'magic':'ember'].clone();
    material.transparency_mode=TransparencyMode.Transparent;material.diffuse_color.setA(0);
    const parts=this.model(ev.effect==='frost'?'frostRing':'dangerRing',[x,heightAt(x,z)+.12,z],[radius,radius,radius],0,material);
    this.transients.push({parts,material,life:.8,age:0});
    for(let i=0;i<16;i++){
      const angle=i/16*Math.PI*2,px=x+Math.sin(angle)*radius,pz=z+Math.cos(angle)*radius;
      const emitter=this.emitter(ev.effect,[px,Math.max(y-.7,heightAt(px,pz)+.15),pz],0,1.1);this.particles.burst(emitter.id,10);
    }
  }
  update(snapshot,playerId,dt){
    if(!snapshot)return;this.elapsed+=dt;this.fps+=((1/Math.max(.001,dt))-this.fps)*.025;
    const present=new Set();
    const renderTime=performance.now()/1000;
    for(const state of snapshot.actors){
      const a=this.poses.sample(state,renderTime);
      if(a.hp<=0){continue;}present.add(a.id);
      let rig=this.characters.get(a.id);if(!rig){rig=this.characterRenderer.create(a);this.characters.set(a.id,rig);}
      if(a.windup>0&&a.attackKind==='nova'){
        rig.telegraph??=this.model('dangerRing');this.pose(rig.telegraph,[a.x,heightAt(a.x,a.z)+.13,a.z],8);
      }else if(rig.telegraph){this.remove(rig.telegraph);delete rig.telegraph;}
      this.characterRenderer.update(rig,a);
    }
    const dead=new Set();
    for(const state of snapshot.ragdolls??[]){
      dead.add(state.key);let rig=this.corpses.get(state.key);
      if(!rig){
        rig=!present.has(state.actorId)&&this.characters.get(state.actorId);if(rig)this.characters.delete(state.actorId);
        else rig=this.characterRenderer.create({archetype:state.name==='briarHound'?'hound':state.appearance,kind:state.appearance==='player'?'player':'enemy',weapon:state.weapon??'sword'});
        this.corpses.set(state.key,rig);
      }
      this.characterRenderer.corpse(rig,this.poses.corpse(state,renderTime));
    }
    for(const [key,rig] of this.corpses)if(!dead.has(key)){this.characterRenderer.remove(rig);this.corpses.delete(key);}
    for(const [id,rig] of this.characters)if(!present.has(id)){this.characterRenderer.remove(rig);this.characters.delete(id);}
    const liveProjectiles=new Set();for(const p of snapshot.projectiles){liveProjectiles.add(p.id);let m=this.missiles.get(p.id);if(!m){m=this.model(p.weapon==='bow'?'arrow':'spell');this.missiles.set(p.id,m);}const v=p.velocity;this.pose(m,p.position,1,Math.atan2(-v[0],-v[2]),-Math.PI/2);}
    for(const [id,m] of this.missiles)if(!liveProjectiles.has(id)){this.remove(m);this.missiles.delete(id);}
    if(snapshot!==this.lastEventSnapshot){for(const ev of snapshot.events){if(ev.type==='nova'){const emitter=this.emitter(ev.effect,ev.position,0,1.4);this.particles.burst(emitter.id,280);this.blastBoundary(ev);}if(ev.type==='hit'){const emitter=this.emitter('embers',ev.position,0,2);this.particles.burst(emitter.id,24);}}this.lastEventSnapshot=snapshot;}
    for(let i=this.transients.length-1;i>=0;i--){const e=this.transients[i];e.age+=dt;if(e.material)e.material.diffuse_color.setA(Math.sin(Math.PI*Math.min(1,e.age/e.life)));if(e.age>e.life){if(e.parts)this.remove(e.parts);else this.ecd.removeEntity(e.id);this.transients.splice(i,1);}}
    const playerState=snapshot.actors.find(a=>a.id===playerId),player=playerState&&this.poses.sample(playerState,renderTime);if(player){
      const pitch=this.pitch,dist=this.distance,target=[player.x,player.y+.7,player.z];
      const wanted=[target[0]+Math.sin(this.yaw)*Math.cos(pitch)*dist,target[1]+Math.sin(pitch)*dist+.7,target[2]+Math.cos(this.yaw)*Math.cos(pitch)*dist];
      wanted[1]=Math.max(wanted[1],heightAt(wanted[0],wanted[2])+.6);
      this.wantedCamera=[...wanted];this.cameraTarget=target;
      const d=wanted.map((v,i)=>v-target[i]),length=Math.hypot(...d),allowed=Math.min(length,this.cameraLimit??length);
      this.cameraDistance??=allowed;this.cameraDistance=allowed<this.cameraDistance?allowed:this.cameraDistance+(allowed-this.cameraDistance)*(1-Math.exp(-dt*12));
      this.cameraPosition=target.map((v,i)=>v+d[i]*this.cameraDistance/length);
      this.cameraTransform.setTranslation(...this.cameraPosition);t64_look_rotation(this.cameraTransform,...target.map((v,i)=>v-this.cameraPosition[i]),0,1,0);this.cameraTransform.updateMatrix();
      this.motes.t.setTranslation(player.x,player.y+2,player.z);this.motes.t.updateMatrix();t64_announce_change(this.ecd,this.motes.id);
    }
    const sky=this.sky.update(this.scene,snapshot.time);
    this.sun.l.intensity.set(sky.intensity);this.sun.l.color.set(...sky.color);
    t64_look_rotation(this.sun.t,...sky.direction.map(v=>-v),0,1,0);this.sun.t.updateMatrix();t64_announce_change(this.ecd,this.sun.id);
    this.audio.update(snapshot,player,dt);
  }
}
