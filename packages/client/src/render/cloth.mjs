import {Cloth} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/Cloth.js';
import {ClothRig} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothRig.js';
import {ClothSystem} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothSystem.js';
import {CLOTH_COTTON,CLOTH_SILK} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/cloth_dynamics_library.js';
import {cloth_proxy_from_joints} from '@woosh/meep-engine/src/engine/physics/cloth/build/cloth_proxy_from_joints.js';
import {prefab_compile} from '@woosh/meep-engine/src/engine/graphics3/prefab/prefab_compile.js';
import {Skin} from '@woosh/meep-engine/src/shade/renderer/animation/Skin.js';
import {v3_quaternion_apply_inverse} from '@woosh/meep-engine/src/core/geom/vec3/v3_quaternion_apply_inverse.js';
import {createSkeleton} from '@old-circle/game/simulation/animation.mjs';

const proxies=new Map();
const clothJoint=name=>/^(cloak|cloth)\d+$/.test(name);

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
  return [ClothRig.from(proxies.get(name)),Cloth.from(name==='votiveBanner'?CLOTH_SILK:CLOTH_COTTON)];
}

/** Meep 3.24 supplies the solver and joint write-back, but not fluid coupling.
 * Feed world wind into its particle velocities in the previous anchor frame;
 * the native step then carries that frame forward and handles all constraints. */
export class WorldCloth extends ClothSystem {
  constructor(wind){super();this.wind=wind;this.velocity=new Float64Array(3);}
  fixedUpdate(dt){
    if(!Number.isFinite(dt)||dt<=0)return;
    for(const instance of this.instances){
      if(!instance.seeded||instance.refused||!instance.anchor_valid)continue;
      const {state,anchor_translation,anchor_rotation,cloth}=instance;
      this.wind.sample(this.velocity,...anchor_translation);
      v3_quaternion_apply_inverse(this.velocity,0,...this.velocity,...anchor_rotation);
      const drag=1-Math.exp(-cloth.dynamics.drag*dt);
      if(Math.hypot(...this.velocity)>1e-5)this.wake(instance.entity);
      for(let p=0;p<state.particle_count;p++){
        if(state.mass_inverse[p]===0)continue;
        for(let axis=0;axis<3;axis++)state.velocity[p*3+axis]+=(this.velocity[axis]-state.velocity[p*3+axis])*drag;
      }
    }
    super.fixedUpdate(dt);
  }
}
