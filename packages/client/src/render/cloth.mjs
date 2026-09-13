import {Cloth} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/Cloth.js';
import {ClothRig} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothRig.js';
import {WorkerClothSystem} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/WorkerClothSystem.js';
import {makeClothWorker} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/makeClothWorker.js';
import {ClothCollider} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothCollider.js';
import {ClothDynamicsFlags} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothDynamicsFlags.js';
import {AbstractClothWind} from '@woosh/meep-engine/src/engine/physics/cloth/wind/AbstractClothWind.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {CapsuleShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/CapsuleShape3D.js';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {T64WorldCache} from '@woosh/meep-engine/src/engine/ecs/transform/T64WorldCache.js';
import {collect_entity_playbacks} from '@woosh/meep-engine/src/engine/graphics3/pose/collect_entity_playbacks.js';
import {CLOTH_COTTON,CLOTH_SILK} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/cloth_dynamics_library.js';
import {cloth_proxy_from_joints} from '@woosh/meep-engine/src/engine/physics/cloth/build/cloth_proxy_from_joints.js';
import {prefab_compile} from '@woosh/meep-engine/src/engine/graphics3/prefab/prefab_compile.js';
import {Skin} from '@woosh/meep-engine/src/shade/renderer/animation/Skin.js';
import {createSkeleton,rigs} from '@old-circle/game/simulation/animation.mjs';

const proxies=new Map();
const clothJoint=name=>/^(cloak|cloth)\d+$/.test(name);
// Damage capsules follow the anatomy, while cloth must clear the coat, armour
// and shoulder pads as well. Add a small contact margin for the skinned surface
// between solver particles, not just for the particles themselves.
const clothedRadius={hips:.20,spine:.19,chest:.20,head:.17,upperArmL:.12,upperArmR:.12,forearmL:.095,forearmR:.095,thighL:.145,thighR:.145,calfL:.10,calfR:.10};
const bodyBones=rigs.pilgrim.bones.flatMap((bone,index)=>bone.radius>0?[{...bone,radius:clothedRadius[bone.name]??bone.radius,index}]:[]);
const capeDynamics=CLOTH_COTTON.clone();
// A travelling coat should hold a fold and settle after a stride. Inertia is
// the fraction of anchor motion felt by the cloth, not particle mass; drag is
// air coupling. Cotton's full inertia/high drag made these short strips whip.
capeDynamics.stretch=.96;capeDynamics.bend=.62;capeDynamics.slack=.12;capeDynamics.damping=.5;
capeDynamics.inertia=.25;capeDynamics.drag=.055;
capeDynamics.flags|=ClothDynamicsFlags.StrainLimit;
// Short links need finer collision sweeps during a gust or a fast body turn.
capeDynamics.substeps=4;
Object.freeze(capeDynamics);

/** Cloth owns these offsets; even constant clip channels would reclaim them
 * when a new locomotion/action clip binds. The top joint stays in its bind pose. */
export function unkeyCloth(skeleton){
  const targets=new Set(skeleton.data.bones.flatMap((b,i)=>clothJoint(b.name)?[skeleton.joints[i]]:[]));
  for(const clip of skeleton.bundle.clips)clip.channels=clip.channels.filter(channel=>!targets.has(channel.target));
}

export function clothComponents(name){
  if(name!=='pilgrim'&&name!=='votiveBanner')return [];
  if(!proxies.has(name)){
    const skeleton=createSkeleton(name);unkeyCloth(skeleton);
    skeleton.bundle.skins=[Skin.from({name,joints:skeleton.joints,inverse_bind_matrices:Float32Array.from(skeleton.data.bones.flatMap(b=>b.inverseBind)),meshes:[]})];
    const prefab=prefab_compile(skeleton.bundle);
    // Keep the weighted top joint fixed to the shoulder/crossbar, so its top
    // edge cannot rotate away from the attachment as the lower joints move.
    const names=skeleton.data.bones.map(b=>b.name).filter(n=>clothJoint(n)&&n!=='cloak1'&&n!=='cloth0');
    const {proxy,error}=cloth_proxy_from_joints(prefab,prefab.skins[0],names,{name});
    if(!proxy)throw new Error(error);
    proxies.set(name,proxy);
  }
  return [ClothRig.from(proxies.get(name)),Cloth.from(name==='votiveBanner'?CLOTH_SILK:capeDynamics)];
}

/** Native fluid drag plus body capsules posed from the same playbacks as the
 * cloth anchor. GPU-animated joints' CPU Transform64 components can be stale,
 * so evaluate the pose before Meep refreshes its cloth collider index. */
export class WorldCloth extends WorkerClothSystem {
  constructor(wind,{worker_factory=makeClothWorker}={}){
    // Up to 96 visible actors plus the world's eight banners exceed the
    // engine's default 32 slots. Leave room for all of them to keep simulating.
    super({worker_factory,max_cloth_count:128});this.bodies=new Map();this.playbacks=[];this.pose=new Transform64();this.poses=new T64WorldCache();
    // Sample the published velocity snapshot, never the fluid worker's buffers.
    this.wind=new AbstractClothWind();
    this.wind.sample=(out,x,y,z)=>wind.sample(out,x,y,z);
    this.wind.varies=(...bounds)=>wind.varies(...bounds);
  }
  removeBodies(entity){
    const bodies=this.bodies.get(entity);if(!bodies)return;
    this.bodies.delete(entity);
    for(const {id} of bodies.parts)if(bodies.ecd.entityExists(id))bodies.ecd.removeEntity(id);
  }
  unlink(cloth,transform,entity){this.removeBodies(entity);super.unlink(cloth,transform,entity);}
  async shutdown(entityManager){
    await super.shutdown(entityManager);
    for(const entity of this.bodies.keys())this.removeBodies(entity);
  }
  collect(command,tick,dt){
    if(!Number.isFinite(dt)||dt<=0)return false;
    const ecd=this.entityManager.dataset;if(!ecd)return false;
    for(const instance of this.instances){
      const entity=instance.entity,rig=ecd.getComponent(entity,ClothRig);
      if(rig?.proxy?.name!=='pilgrim'){this.removeBodies(entity);continue;}
      const model=this.models?.instance_of(entity),skin=model?.skins[rig.skin];
      if(!skin){this.removeBodies(entity);continue;}
      // The collider index reads position/rotation only. Bake actor scale into
      // its immutable shapes, including the larger keeper rigs.
      const root=ecd.getComponent(entity,Transform64),scale=Math.max(...root.scale);
      let bodies=this.bodies.get(entity);
      // A teleport places colliders afresh; sweeping their old poses across
      // the map would hit unrelated garments along the journey.
      if(bodies&&(bodies.skin!==skin||bodies.scale!==scale||Math.hypot(...root.translation.map((v,i)=>v-bodies.position[i]))>2)){this.removeBodies(entity);bodies=null;}
      this.playbacks.length=0;collect_entity_playbacks(this.playbacks,this.entityManager,entity);
      this.poses.invalidate();
      if(!bodies){bodies={ecd,skin,scale,position:new Float64Array(3),parts:[]};this.bodies.set(entity,bodies);}
      bodies.position.set(root.translation);
      for(let i=0;i<bodyBones.length;i++){
        const bone=bodyBones[i];
        const pose=this.poses.evaluate(this.pose,ecd,skin.joints[bone.index],this.playbacks),half=bone.length/2;
        const part=bodies.parts[i];
        const t=part?.t??new Transform64();
        t.setTranslation(pose[12]+pose[4]*half,pose[13]+pose[5]*half,pose[14]+pose[6]*half);
        t.setRotation(...pose.rotation);t.updateMatrix();
        if(!part){
          // Cover the full trouser leg, including the hip and knee seams. A
          // capsule shortened by its two radii tapers to nothing at each joint.
          const leg=/^(thigh|calf)/.test(bone.name),length=leg?bone.length:Math.max(.02,bone.length-2*bone.radius);
          const collider=new Collider();collider.shape=CapsuleShape3D.from(bone.radius*scale,length*scale);collider.friction=.3;
          const marker=ClothCollider.from({inflation:.035*scale,friction_scale:.25});
          const id=new Entity().add(t).add(collider).add(marker).build(ecd);
          bodies.parts.push({id,t,bone:bone.index});
        }
      }
    }
    this.playbacks.length=0;
    return super.collect(command,tick,dt);
  }
}
