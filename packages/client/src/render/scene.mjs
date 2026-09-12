import { EngineHarness } from '@woosh/meep-engine/src/engine/EngineHarness.js';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import { Transform64 } from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {TransformAttachmentSystem} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachmentSystem.js';
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
import {VolumetricsParticleSpec} from '@woosh/meep-engine/src/shade/renderer/volumetrics/ParticipatingMediaVolume.js';
import {MIE_PARTICLES_STANDARD_PRECOMPUTED} from '@woosh/meep-engine/src/core/math/physics/mie/MIE_PARTICLES_STANDARD_PRECOMPUTED.js';
import { StandardShadeMaterial } from '@woosh/meep-engine/src/shade/renderer/material/StandardShadeMaterial.js';
import {TransparencyMode} from '@woosh/meep-engine/src/shade/renderer/material/TransparencyMode.js';
import { ShadeTexture } from '@woosh/meep-engine/src/shade/renderer/texture/ShadeTexture.js';
import { ShadeImage } from '@woosh/meep-engine/src/shade/renderer/texture/source/ShadeImage.js';
import { ColorSpace } from '@woosh/meep-engine/src/shade/renderer/texture/ColorSpace.js';
import { WorldAudio } from './audio.mjs';
import { WorldSky } from './sky.mjs';
import { buildLayout } from '@old-circle/game/world/layout.mjs';
import { heightAt } from '@old-circle/game/world/regions.mjs';
import {DUNGEON_MATERIALS} from '@old-circle/game/world/dungeons.mjs';
import { effect } from './effects.mjs';
import { PresentationPoses } from './presentation-poses.mjs';
import {WorldGround} from './ground.mjs';
import {Characters} from './characters.mjs';
import {WorldWind} from './wind.mjs';
import {WorldCloth} from './cloth.mjs';
import {WorldAmbient} from './ambient.mjs';
import {WorldBanners} from './banners.mjs';
import {WorldFootsteps} from './footsteps.mjs';
import {BossHazards,isBossHazard} from './boss-hazards.mjs';
import {DecalSystem} from '@woosh/meep-engine/src/engine/graphics3/DecalSystem.js';
import SoundListenerSystem from '@woosh/meep-engine/src/engine/sound/ecs/SoundListenerSystem.js';
import SoundListener from '@woosh/meep-engine/src/engine/sound/ecs/SoundListener.js';
import {ModelStore} from './model-store.mjs';
import {WorldStream} from './world-stream.mjs';
import {loadScenery,attachScenery} from './scenery-data.mjs';
import {GeometryCache} from './geometry-cache.mjs';
import {Trail3DSystem} from '@woosh/meep-engine/src/engine/graphics3/Trail3DSystem.js';
import {CombatTrails} from './combat-trails.mjs';
import {CombatFeedback} from './combat-feedback.mjs';
import {rangedSightOrigin} from '@old-circle/game/simulation/aim.mjs';

const PALETTE={stone:[.36,.37,.30],stoneLight:[.52,.50,.39],stoneDark:[.20,.24,.22],grass:[.22,.31,.12],grassLight:[.39,.43,.19],bark:[.14,.12,.085],leaf:[.10,.21,.12],leafLight:[.20,.29,.13],brass:[.48,.31,.12],iron:[.20,.23,.24],cloth:[.065,.095,.10],leather:[.12,.07,.035],ember:[1,.37,.06],magic:[.20,.57,.76],bone:[.63,.60,.48],sand:[.48,.32,.19],snow:[.61,.70,.73],ice:[.34,.52,.59],skin:[.34,.22,.15],lining:[.018,.022,.02]};
const quat=new Quaternion();
export class WorldView {
  constructor(){this.models=new Map();this.characters=new Map();this.corpses=new Map();this.missiles=new Map();this.transients=[];this.yaw=0;this.pitch=0;this.distance=5.8;this.elapsed=0;this.cameraPosition=null;this.fps=60;this.poses=new PresentationPoses();}
  acceptSnapshot(snapshot){this.poses.accept(snapshot,performance.now()/1000);}
  prepareToRender(snapshot,playerId){
    this.update(snapshot,playerId,0);
  }
  async start(progress=()=>{},position=[0,heightAt(0,23)+1,23]){
    progress('Loading game…',.1);
    this.characterRenderer=new Characters(this);
    this.engine=await EngineHarness.bootstrap({configuration:(config,engine)=>{
      engine.renderingEnabled=false;
      config.addSystem(new TransformAttachmentSystem());
      this.scene=EngineHarness.shadeScene(engine);
      config.addSystem(new ShadedGeometrySystem(engine.graphics,this.scene));
      this.meshSystem=new MeshSystem(engine.graphics,this.scene,async url=>this.characterRenderer.bundle(url));config.addSystem(this.meshSystem);
      this.animations=new AnimationSystem(engine.graphics,this.meshSystem);config.addSystem(this.animations);
      config.addSystem(new CameraSystem(engine.graphics));config.addSystem(new LightSystem(engine.graphics,this.scene));
      this.particles=new GPUParticleEmitterSystem(engine.graphics,this.scene,engine.assetManager);config.addSystem(this.particles);
      config.addSystem(new ParticipatingMediaSystem(engine.graphics,this.scene));
      config.addSystem(new DecalSystem(engine.graphics,engine.assetManager));
      this.trailSystem=new Trail3DSystem(engine.graphics);config.addSystem(this.trailSystem);
      config.addSystem(new SoundListenerSystem(engine.sound.context));
      this.wind=new WorldWind();config.addSystem(this.wind);
      this.cloth=new WorldCloth(this.wind);config.addSystem(this.cloth);
    }});
    this.ecd=this.engine.entityManager.dataset;
    this.wind.attach(this.ecd);this.wind.follow(0,heightAt(0,23)+1,23);
    this.engine.viewStack.el.classList.add('meep-world');
    const renderer=this.engine.graphics.renderer;
    if(!renderer)throw new Error('Meep could not initialize WebGPU on this browser.');
    renderer.feature_particles_enabled=true;renderer.feature_bloom_enabled=true;renderer.feature_ssao_enabled=true;renderer.feature_taa_enabled=true;renderer.feature_shadows_enabled=true;
    renderer.feature_automatic_exposure_enabled=true;renderer.exposure_compensation=0;
    // Bound presentation resolution; asset inference never shares the GPU with this view.
    renderer.pixel_ratio=Math.min(devicePixelRatio,1.4);
    const camera=new Camera();camera.fov.set(57);camera.clip_near=.12;camera.clip_far=1100;
    this.cameraTransform=new Transform64();this.cameraEntity=new Entity().add(camera).add(this.cameraTransform).build(this.ecd);
    this.listenerTransform=new Transform64();this.listenerEntity=new Entity().add(new SoundListener()).add(this.listenerTransform).build(this.ecd);
    this.materials={};for(const [key,color] of Object.entries({...PALETTE,...Object.fromEntries(Object.entries(DUNGEON_MATERIALS).map(([name,spec])=>[name,spec.color]))})){
      const m=new StandardShadeMaterial();m.diffuse_color.set(...color);m.roughness_factor=key==='iron'?.43:key==='brass'?.38:.92;m.metallic_factor=key==='iron'?.7:key==='brass'?.78:0;
      if(key==='ember')m.emissive_factor.set(4,1,.08);if(key==='magic')m.emissive_factor.set(.02,.17,.25);
      this.materials[key]=m;
    }
    for(const [name,color] of Object.entries({grass:[.16,.24,.075],grassLight:[.30,.34,.12],grassDark:[.075,.13,.055],grassDry:[.24,.22,.105],fernLeaf:[.12,.20,.085]})){
      this.materials[name]??=new StandardShadeMaterial();this.materials[name].diffuse_color.set(...color);this.materials[name].roughness_factor=.92;
    }
    this.materials.path=new StandardShadeMaterial();this.materials.path.diffuse_color.set(.28,.29,.23);
    this.materials.glassLeaf=new StandardShadeMaterial();this.materials.glassLeaf.diffuse_color.set(.12,.23,.27);
    this.materials.landscape=new StandardShadeMaterial();this.materials.landscape.roughness_factor=1;
    this.materials.cloak=new StandardShadeMaterial();
    this.materials.limestone=new StandardShadeMaterial();
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
    for(const name of ['iron','brass','leather','cloth','cloak','limestone',...Object.keys(DUNGEON_MATERIALS)]){
      const material=this.materials[name];material.roughness_factor=1;material.metallic_factor=name==='iron'||name==='brass'?1:0;
      for(const [suffix,channel] of [['','albedo'],['-normal','normal'],['-orm','orm']]){
        const texture=(DUNGEON_MATERIALS[name]?.texture??name)+suffix;
        if(!textures[texture]){
          const response=await fetch(`/assets/textures/${texture}.png`);if(!response.ok)throw new Error(`Missing material ${texture}`);
          const image=ShadeImage.fromImageBitmap(await createImageBitmap(await response.blob()));image.color_space=suffix?ColorSpace.None:ColorSpace.SRGB;
          textures[texture]=ShadeTexture.from(image);
        }
        material[`texture_${channel}`]=textures[texture];
      }
    }
    const manifest=await fetch('/assets/geometry/manifest.json').then(r=>r.json());
    const gpuGeometry=renderer.scenes.obtain(this.scene).geometries;
    this.gpuGeometry=gpuGeometry;
    this.geometryCache=new GeometryCache(manifest);
    this.modelStore=new ModelStore({manifest,materials:this.materials,models:this.models,read:file=>this.geometryCache.read(file),residentCache:true,dispose:geometry=>gpuGeometry.remove(geometry)});
    const core=Object.keys(manifest.models).filter(name=>name==='pilgrim'||name==='briarHound'||name==='votiveBanner'||name.startsWith('armor_')||name.startsWith('boss_'));
    core.push('sword','spear','bow','staff','arrow','spell','pilgrimLantern','dangerRing','frostRing','reliquary','reliquarySpent');
    await Promise.all(core.map(name=>this.modelStore.load(name,{pin:true})));
    const layout=buildLayout(),scenery=await loadScenery(manifest);this.streaming=new WorldStream(this,layout,this.modelStore,scenery);
    await this.streaming.start(position,p=>progress('Loading nearby terrain…',.15+p*.5));
    await this.geometryCache.warm(p=>progress('Loading world assets…',.65+p*.18));
    this.banners=new WorldBanners(this,layout.banners);
    this.ground=new WorldGround();await this.ground.start(this.engine.graphics,this.streaming.groundEntities);
    this.audio=new WorldAudio(this.engine,layout);await this.audio.start();
    this.footsteps=new WorldFootsteps(this);
    this.bossHazards=new BossHazards(this);
    this.combatTrails=new CombatTrails(this);
    this.combatFeedback=new CombatFeedback(this,document.querySelector('#damage-feedback'));
    this.sun=this.light([30,70,20],[1,.95,.83],2.8,Light.Type.DIRECTION,true);
    t64_look_rotation(this.sun.t,-.6,-.7,-.45,0,1,0);this.sun.t.updateMatrix();t64_announce_change(this.ecd,this.sun.id);
    this.ambient=new WorldAmbient(this);
    // Atmospheric perspective reaches over the backdrop summits as well as
    // the road; a shallow box left distant peaks as crisp as the foreground.
    const fog=new ParticipatingMedia();fog.particle_spec=VolumetricsParticleSpec.fromMeep(MIE_PARTICLES_STANDARD_PRECOMPUTED.CONTINENTAL_HAZE_SMALL);fog.target_extinction=.00035;fog.fade_distance=45;
    const ft=new Transform64();ft.setTranslation(0,110,-150);ft.setScale(1100,400,1150);ft.updateMatrix();new Entity().add(fog).add(ft).build(this.ecd);
    for(const [x,z,w,d,strength] of [[-85,-55,65,90,.012],[35,-185,38,70,.014],[-112,-210,90,80,.009],[95,-248,85,80,.004],[0,-78,42,22,.009]]){
      const low=new ParticipatingMedia();low.target_extinction=strength;low.fade_distance=7;
      const lt=new Transform64();lt.setTranslation(x,heightAt(x,z)+2,z);lt.setScale(w,9,d);lt.updateMatrix();new Entity().add(low).add(lt).build(this.ecd);
    }
    progress('Loading sky…',.96);await this.sky.prepare();
    progress('Ready',1);return this;
  }
  model(name,position=[0,0,0],scale=[1,1,1],yaw=0,material=null,up=null){
    const chunks=this.models.get(name);if(!chunks)throw new Error(`Unknown Blender asset: ${name}`);
    const rotation=up?quat._lookRotation(Math.sin(yaw),-(up[0]*Math.sin(yaw)+up[2]*Math.cos(yaw))/up[1],Math.cos(yaw),...up):[0,Math.sin(yaw/2),0,Math.cos(yaw/2)];
    const result=[];for(const c of chunks){const t=new Transform64();t.setTranslation(...position);t.setScale(...scale);t.setRotation(...rotation);t.updateMatrix();const id=new Entity().add(t).add(ShadedGeometry.from(c.geometry,material??c.material)).build(this.ecd);result.push({id,t});}return result;
  }
  sceneryModel(name,transform){
    const chunks=this.models.get(name);if(!chunks)throw new Error(`Unknown Blender asset: ${name}`);
    return attachScenery(this.ecd,chunks,transform);
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
  update(snapshot,playerId,dt,renderTime=performance.now()/1000){
    if(!snapshot)return;this.elapsed+=dt;this.fps+=((1/Math.max(.001,dt))-this.fps)*.025;
    const present=new Set(),presented=[];
    for(const state of snapshot.actors){
      const a=this.poses.sample(state,renderTime);
      presented.push(a);
      if(a.hp<=0){continue;}present.add(a.id);
      let rig=this.characters.get(a.id);
      if(rig&&rig.url!==this.characterRenderer.appearance(a)){this.characterRenderer.remove(rig);rig=null;}
      if(!rig){rig=this.characterRenderer.create(a);this.characters.set(a.id,rig);}
      if(a.windup>0&&a.attackKind==='nova'){
        rig.telegraph??=this.model('dangerRing');this.pose(rig.telegraph,[a.x,heightAt(a.x,a.z)+.13,a.z],8);
      }else if(rig.telegraph){this.remove(rig.telegraph);delete rig.telegraph;}
      this.characterRenderer.update(rig,a);
      if(a.id!==playerId&&rig.viewFaded)this.characterRenderer.viewAlpha(rig,1);
    }
    const dead=new Set();
    for(const state of snapshot.ragdolls??[]){
      dead.add(state.key);let rig=this.corpses.get(state.key);
      if(!rig){
        rig=!present.has(state.actorId)&&this.characters.get(state.actorId);if(rig)this.characters.delete(state.actorId);
        else rig=this.characterRenderer.create({archetype:state.name==='briarHound'?'hound':state.appearance,kind:state.appearance==='player'?'player':'enemy',weapon:state.weapon??'sword',inventory:{armor:state.armor}});
        this.corpses.set(state.key,rig);
      }
      this.characterRenderer.corpse(rig,this.poses.corpse(state,renderTime));
    }
    for(const [key,rig] of this.corpses)if(!dead.has(key)){this.characterRenderer.remove(rig);this.corpses.delete(key);}
    for(const [id,rig] of this.characters)if(!present.has(id)){this.characterRenderer.remove(rig);this.characters.delete(id);}
    const liveProjectiles=new Set();for(const p of snapshot.projectiles){if(isBossHazard(p))continue;const key=p.key??p.id;liveProjectiles.add(key);let m=this.missiles.get(key);if(!m){m=this.model(p.weapon==='bow'?'arrow':'spell',[0,0,0],[1,1,1],0,p.effect==='cinder'?this.materials.ember:null);this.missiles.set(key,m);}const v=p.velocity;this.pose(m,p.position,p.effect==='cinder'?1.7:1,Math.atan2(-v[0],-v[2]),-Math.PI/2+Math.atan2(v[1],Math.hypot(v[0],v[2])));}
    for(const [id,m] of this.missiles)if(!liveProjectiles.has(id)){this.remove(m);this.missiles.delete(id);}
    if(snapshot!==this.lastEventSnapshot){for(const ev of snapshot.events){if(ev.type==='nova'){const emitter=this.emitter(ev.effect,ev.position,0,1.4);this.particles.burst(emitter.id,280);this.blastBoundary(ev);}if(ev.type==='hit'){const emitter=this.emitter('embers',ev.position,0,2);this.particles.burst(emitter.id,24);}}this.lastEventSnapshot=snapshot;}
    for(let i=this.transients.length-1;i>=0;i--){const e=this.transients[i];e.age+=dt;if(e.material)e.material.diffuse_color.setA(Math.sin(Math.PI*Math.min(1,e.age/e.life)));if(e.age>e.life){if(e.parts)this.remove(e.parts);else this.ecd.removeEntity(e.id);this.transients.splice(i,1);}}
    this.combatFeedback.update(snapshot,presented,playerId,dt);
    const player=presented.find(a=>a.id===playerId);if(player){
      this.streaming.update(player,dt);
      const pitch=this.pitch,dist=this.distance,target=['bow','staff'].includes(player.weapon)?rangedSightOrigin(player,this.yaw):[player.x,player.y+.7,player.z];
      const wanted=[target[0]+Math.sin(this.yaw)*Math.cos(pitch)*dist,target[1]+Math.sin(pitch)*dist+.7,target[2]+Math.cos(this.yaw)*Math.cos(pitch)*dist];
      wanted[1]=Math.max(wanted[1],heightAt(wanted[0],wanted[2])+.6);
      this.wantedCamera=[...wanted];this.cameraTarget=target;
      const d=wanted.map((v,i)=>v-target[i]),length=Math.hypot(...d),allowed=Math.min(length,this.cameraLimit??length);
      this.cameraDistance??=allowed;this.cameraDistance=allowed<this.cameraDistance?allowed:this.cameraDistance+(allowed-this.cameraDistance)*(1-Math.exp(-dt*12));
      this.cameraPosition=target.map((v,i)=>v+d[i]*this.cameraDistance/length);
      const playerRig=this.characters.get(playerId);if(playerRig)this.characterRenderer.viewAlpha(playerRig,(this.cameraDistance-1)/1.2);
      this.aimPitch=Math.atan2(this.cameraPosition[1]-target[1],Math.hypot(this.cameraPosition[0]-target[0],this.cameraPosition[2]-target[2]));
      const kick=this.combatFeedback.cameraKick(),look=target.map((v,i)=>v-this.cameraPosition[i]);look[1]+=Math.hypot(...look)*kick.pitch;
      this.cameraTransform.setTranslation(...this.cameraPosition);t64_look_rotation(this.cameraTransform,...look,Math.cos(this.yaw)*Math.sin(kick.roll),Math.cos(kick.roll),-Math.sin(this.yaw)*Math.sin(kick.roll));this.cameraTransform.updateMatrix();
      this.listenerTransform.setTranslation(player.x,player.y+.65,player.z);t64_look_rotation(this.listenerTransform,-Math.sin(this.yaw),0,-Math.cos(this.yaw),0,1,0);this.listenerTransform.updateMatrix();t64_announce_change(this.ecd,this.listenerEntity);
      this.ambient.update(player,snapshot.time,dt);
      this.banners.update(dt,player);
    }
    const sky=this.sky.update(this.scene,snapshot.time);
    // Auto exposure otherwise lifts the moonlit landscape back to daylight.
    // Ease the bias away under roofs so sheltered stairs and doors stay legible.
    const exposure=-1.35*sky.nightBlend*(1-.85*(this.shelter??0));
    this.exposureBias??=exposure;
    this.exposureBias+=(exposure-this.exposureBias)*(1-Math.exp(-dt*2));
    this.engine.graphics.renderer.exposure_compensation=this.exposureBias;
    this.sun.l.intensity.set(sky.intensity);this.sun.l.color.set(...sky.color);
    t64_look_rotation(this.sun.t,...sky.direction.map(v=>-v),0,1,0);this.sun.t.updateMatrix();t64_announce_change(this.ecd,this.sun.id);
    this.audio.update(snapshot,player,dt);
    this.footsteps.update(presented,playerId,this.poses.epoch,renderTime,dt);
    this.bossHazards.update(snapshot.projectiles,player,this.poses.epoch,dt);
    this.combatTrails.update(presented,snapshot.projectiles,player,this.poses.epoch,dt);
    // Mesh transforms publish immediately; these bridges otherwise wait for the
    // independent engine ticker. Publish the matching camera and skeletal poses
    // before drawing, without advancing animation clocks a second time.
    this.animations.update(0);
    this.engine.entityManager.getSystem(CameraSystem).update(0);
  }
}
