import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {Animation} from '@woosh/meep-engine/src/engine/ecs/animation/Animation.js';
import {AnimationClip} from '@woosh/meep-engine/src/engine/ecs/animation/AnimationClip.js';
import {SceneNode} from '@woosh/meep-engine/src/shade/renderer/loader/SceneNode.js';
import {Skin} from '@woosh/meep-engine/src/shade/renderer/animation/Skin.js';
import {TransparencyMode} from '@woosh/meep-engine/src/shade/renderer/material/TransparencyMode.js';
import {TransformAttachment} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachment.js';
import {TRANSFORM_ATTACHMENT_EVENT_CHANGE} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TRANSFORM_ATTACHMENT_EVENT_CHANGE.js';
import {GPUStateAuthorityFlags} from '@woosh/meep-engine/src/engine/ecs/gpu/GPUStateAuthorityFlags.js';
import {gpu_authority_revoke} from '@woosh/meep-engine/src/engine/ecs/gpu/gpu_authority_revoke.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {shaded_geometry_announce_change} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/shaded_geometry_announce_change.js';
import {Light} from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import {m4_invert} from '@woosh/meep-engine/src/core/geom/3d/mat4/m4_invert.js';
import {m4_multiply} from '@woosh/meep-engine/src/core/geom/3d/mat4/m4_multiply.js';
import {actorRig,actorScale,actorFeet,actorSocket,createSkeleton,animationPlan,rigs} from '@old-circle/game/simulation/animation.mjs';
import {weaponPose} from '@old-circle/game/simulation/weapon-pose.mjs';
import {armorFor} from '@old-circle/game/content/equipment.mjs';
import {BOSSES} from '@old-circle/game/content/catalog.mjs';
import {Cloth} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/Cloth.js';
import {ClothCollider} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothCollider.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {clothComponents,unkeyCloth} from './cloth.mjs';
import {LanternChain,lanternBodyBones,LANTERN_SCALE} from './lantern-chain.mjs';
import {updateWeaponLight,removeWeaponLight} from './weapon-lights.mjs';
import {actorScreenSphere,sphereScreenArea,ScreenCullState,CHARACTER_CULL} from './screen-culling.mjs';

import {clamp01} from '@woosh/meep-engine/src/core/math/clamp01.js';

const keeperColors={
  warden:{cloth:[.09,.12,.11],cloak:[.53,.66,.53],brass:[.34,.28,.15]},
  rootbound:{bark:[.12,.16,.10],bone:[.65,.65,.48]},
  cantor:{cloth:[.28,.045,.025],cloak:[1.2,.31,.14],brass:[.56,.23,.08]},
  mirror:{cloth:[.16,.22,.28],cloak:[.64,.89,1.2],bone:[.5,.72,.82],iron:[.47,.61,.64]},
  frostbound:{cloth:[.23,.30,.32],cloak:[1.2,1.4,1.5],bone:[.39,.65,.73]},
  'last-king':{cloth:[.08,.045,.045],cloak:[.59,.25,.25],brass:[.66,.41,.14]},
};

export class Characters {
  constructor(view){this.view=view;this.bundles=new Map();this.pool=new Map();this.visibility=new Map();}
  visibleActors(actors,playerId,epoch,dt){
    if(this.visibilityEpoch!==epoch){this.visibility.clear();this.visibilityEpoch=epoch;}
    const camera=this.view.engine?.graphics.camera.camera,live=new Set(),visible=[];
    for(const actor of actors){
      if(actor.hp<=0)continue;
      live.add(actor.id);
      let state=this.visibility.get(actor.id);
      if(!state){state=new ScreenCullState();this.visibility.set(actor.id,state);}
      // The local player also owns the camera fade and lantern. Never remove
      // that presentation when the camera is against a wall or inside its body.
      // Offscreen wearers can still light the scene. Whole-character culling
      // is size-only; cloth independently rejects the camera frustum.
      const area=actor.id===playerId?1:sphereScreenArea(actorScreenSphere(actor),camera,{frustum:false});
      if(state.update(area,dt,CHARACTER_CULL))visible.push(actor);
    }
    for(const id of this.visibility.keys())if(!live.has(id))this.visibility.delete(id);
    return visible;
  }
  publishAnimations(rigs){
    const animations=this.view.animations;
    animations.update(0);
    // New/reused skins bind during update, after the usual per-actor clock
    // write. Publish their current pose before the first draw after culling.
    let changed=false;
    for(const rig of rigs)for(const playback of animations.playbacks_of(rig.id)){
      const time=playback.clip.poseTime??0;
      if(playback.elapsed!==time||playback.finished){playback.elapsed=time;playback.finished=false;changed=true;}
    }
    if(changed)animations.update(0);
  }
  appearance(a){return actorRig(a)+':'+(a.kind==='player'?'player':a.archetype)+':'+(a.kind==='player'?armorFor(a).appearance:BOSSES[a.archetype]?'boss_'+a.archetype:a.archetype==='mage'?'keeper':a.archetype==='archer'?'wayfarer':a.archetype==='sentinel'?'sentinel':'pilgrim');}
  bundle(url){
    if(this.bundles.has(url))return this.bundles.get(url);
    const [name,appearance,outfit='pilgrim']=url.split(':'),skeleton=createSkeleton(name),bundle=skeleton.bundle;
    unkeyCloth(skeleton);
    const model=outfit.startsWith('boss_')?outfit:name==='pilgrim'&&outfit!=='pilgrim'?'armor_'+outfit:name;
        const meshes=this.view.models.get(model).map(c=>{
      let material=c.material;
      if(appearance!=='player'){
        material=c.material.clone();
        if(c.material===this.view.materials.cloth)material.diffuse_color.set(...(appearance==='mage'?[.12,.17,.23]:appearance==='archer'?[.22,.20,.13]:[.20,.12,.08]));
        if(c.material===this.view.materials.cloak)material.diffuse_color.set(...(appearance==='mage'?[.7,.9,1.3]:appearance==='archer'?[1.1,.97,.72]:[1.2,.75,.52]));
        if(appearance==='sentinel'&&c.material===this.view.materials.iron)material.diffuse_color.set(.38,.30,.17);
      }
      if(outfit.startsWith('boss_')){
        for(const [slot,color] of Object.entries(keeperColors[appearance]))if(c.material===this.view.materials[slot])material.diffuse_color.set(...color);
        if(appearance==='frostbound'&&c.material===this.view.materials.ember){material.diffuse_color.set(.2,.6,.8);material.emissive_factor.set(.08,.5,.8);}
      }else if(outfit!=='pilgrim'&&name==='pilgrim'){
        material=material.clone();
        const colors={wayfarer:{cloth:[.12,.17,.09],cloak:[.48,.64,.37]},keeper:{cloth:[.24,.27,.24],cloak:[1.05,1.16,1.10]},sentinel:{cloth:[.12,.08,.055],cloak:[.66,.37,.23]},winter:{cloth:[.32,.35,.34],cloak:[1.3,1.4,1.4]}}[outfit];
        if(c.material===this.view.materials.cloth)material.diffuse_color.set(...colors.cloth);
        if(c.material===this.view.materials.cloak)material.diffuse_color.set(...colors.cloak);
      }
      // a skinned primitive under the skeleton's root; the skin below names it
      return bundle.add_node(SceneNode.from({parent:skeleton.root,geometry:c.geometry,material}));
    });
    bundle.skins=[Skin.from({name,joints:skeleton.joints,inverse_bind_matrices:Float32Array.from(skeleton.data.bones.flatMap(b=>b.inverseBind)),meshes})];
    this.bundles.set(url,bundle);return bundle;
  }
  create(a){
    const url=this.appearance(a),available=this.pool.get(url),rig=available?.pop();
    if(rig){
      rig.dead=false;rig.corpseReady=false;rig.clips.clear();
      // The corpse left the joints' offsets where physics put them; the clips the new Animation
      // binds take the joints back for the GPU and pose them from the clips, so nothing is reset.
      rig.animation=new Animation();this.view.ecd.addComponentToEntity(rig.id,rig.animation);
      if(rig.cloth)this.view.ecd.addComponentToEntity(rig.id,rig.cloth);
      rig.weapon=a.archetype==='hound'?null:this.view.model(a.weapon);rig.weaponName=a.weapon;return rig;
    }
    const mesh=new SGMesh();mesh.url=url;
    const t=new Transform64(),animation=new Animation(),entity=new Entity().add(t).add(mesh).add(animation);
    const components=clothComponents(actorRig(a));for(const component of components)entity.add(component);
    const id=entity.build(this.view.ecd),cloth=components.find(c=>c instanceof Cloth);
    return {id,t,url,animation,cloth,clips:new Map(),weapon:a.archetype==='hound'?null:this.view.model(a.weapon),weaponName:a.weapon};
  }
  update(rig,a,dt=0){
    const {view}=this,scale=actorScale(a),yaw=a.yaw+Math.PI;
    rig.t.setTranslation(...actorFeet(a));rig.t.setScale(scale,scale,scale);rig.t.setRotation(0,Math.sin(yaw/2),0,Math.cos(yaw/2));rig.t.updateMatrix();t64_announce_change(view.ecd,rig.id);
    const plan=animationPlan(a);
    // All clips author complete TRS channels. Retaining used bindings makes
    // locomotion cross-fades independent of GPU clip registration churn.
    for(const clip of rig.clips.values())clip.weight.set(0);
    for(const p of plan){
      let clip=rig.clips.get(p.name);
      if(!clip){clip=AnimationClip.fromJSON({name:p.name,repeatCount:Infinity,timeScale:0,weight:p.weight});rig.clips.set(p.name,clip);rig.animation.clips.add(clip);}
      clip.weight.set(p.weight);clip.poseTime=p.time;
    }
    for(const playback of view.animations.playbacks_of(rig.id)){playback.elapsed=playback.clip.poseTime??0;playback.finished=false;}
    if(rig.weaponName!==a.weapon&&rig.weapon){this.clearViewAlpha(rig);view.remove(rig.weapon);rig.weapon=view.model(a.weapon);rig.weaponName=a.weapon;}
    if(rig.weapon){
      const pose=weaponPose(a);for(const {id,t} of rig.weapon){t.setTranslation(...pose.origin);t.setScale(scale,scale,scale);t.setRotation(...pose.rotation);t.updateMatrix();t64_announce_change(view.ecd,id);}
    }
    updateWeaponLight(view,rig);
    if(a.kind==='player'){
      this.createLantern(rig,[a.x,a.y,a.z]);
      rig.lantern.bodyPoses??=lanternBodyBones.map(()=>new Transform64());
      lanternBodyBones.forEach((bone,i)=>actorSocket(rig.lantern.bodyPoses[i],a,bone.name));
      actorSocket(rig.lantern.socket,a,'hips');this.lanternPose(rig,rig.lantern.socket,1,dt,rig.lantern.bodyPoses);
    }
  }
  viewAlpha(rig,alpha){
    if(rig.dead)return;
    alpha=clamp01(alpha);
    const {view}=this;
    // Each actor owns its fade materials. Keep the clones across wall contacts:
    // the shared outfit, remote pilgrims and pooled skins must stay opaque.
    if(alpha<1&&!rig.viewMaterials){
      if(!view.meshSystem.instance_of(rig.id))return;
      rig.viewMaterials=[];
      const remember=(material,apply)=>{
        const faded=material.clone();faded.transparency_mode=TransparencyMode.Transparent;
        rig.viewMaterials.push({material,faded,apply});
      };
      // The skin's primitives are entities like the weapon's: the material is written on the
      // component and announced, which rewrites the row and keeps a skinned primitive's clone.
      for(const id of [...view.meshSystem.mesh_entities_of(rig.id),...(rig.weapon??[]).map(p=>p.id),...(rig.lantern?.parts??[]).map(p=>p.id),...(rig.lantern?.links??[]).flat().map(p=>p.id)]){
        const geometry=view.ecd.getComponent(id,ShadedGeometry);
        remember(geometry.material,material=>{geometry.material=material;shaded_geometry_announce_change(view.ecd,id);});
      }
    }
    const fading=alpha<1;
    if(fading!==!!rig.viewFaded){
      for(const entry of rig.viewMaterials??[])entry.apply(fading?entry.faded:entry.material);
      rig.viewFaded=fading;
    }
    if(fading)for(const {faded,material} of rig.viewMaterials)faded.diffuse_color.setA(material.diffuse_color.a*alpha);
  }
  clearViewAlpha(rig){this.viewAlpha(rig,1);rig.viewMaterials=null;}
  createLantern(rig,position){
    const {view}=this;
    if(!rig.lantern){
      const parts=view.model('pilgrimLantern');
      for(const {id} of parts){
        const geometry=view.ecd.getComponent(id,ShadedGeometry);
        // Shade's shadow pass includes opaque/alpha-tested material buckets;
        // ShadedGeometry.CastShadow is not forwarded to that renderer. Give
        // only the luminous core a translucent volume material so it cannot
        // enclose and occlude its own light. The metal cage remains opaque.
        if(geometry&&geometry.material===view.materials.ember){
          geometry.material=geometry.material.clone();geometry.material.transparency_mode=TransparencyMode.Transparent;geometry.material.diffuse_color.setA(.85);shaded_geometry_announce_change(view.ecd,id);
        }
      }
      rig.lantern={parts,links:[view.model('lanternLink'),view.model('lanternLink')],chain:new LanternChain(view.lanternScenery),light:view.light(position,[1,.62,.30],2.4,Light.Type.POINT,false,7,.045*LANTERN_SCALE),socket:new Transform64()};
    }
  }
  lanternPose(rig,socket,alpha,dt=0,bodyPoses=[]){
    const {view}=this,{parts,links,chain,light}=rig.lantern;
    const scale=socket.scale[0]*LANTERN_SCALE,poses=chain.update(socket,dt,bodyPoses);
    const pose=(meshes,index)=>{for(const {id,t} of meshes){t.setScale(scale,scale,scale);t.setRotation(...poses[index].rotation);t.setTranslation(...poses[index].position);t.updateMatrix();t64_announce_change(view.ecd,id);}};
    links.forEach((meshes,i)=>pose(meshes,i));pose(parts,2);
    // The light originates at the ember, below the attachment hook.
    // Preserve the flame-sized emitter while fading its illumination with the wearer.
    light.t.setTranslation(...chain.ember);light.t.setRotation(...poses[2].rotation);light.t.updateMatrix();t64_announce_change(view.ecd,light.id);light.l.intensity.set(2.4*alpha);
    // The ember entity shares the cage's centre and lifetime. Mirror its shape
    // into cloth at the presented pose, including the sub-tick belt offset.
    const cage=chain.links[2].c,previous=view.ecd.getComponent(light.id,Collider);
    if(previous?.shape!==cage.shape){
      // Chain resets replace the shape on teleports, resizes and long stalls.
      // Relinking places it afresh instead of sweeping across the old pose.
      if(previous){view.ecd.removeComponentFromEntity(light.id,ClothCollider);view.ecd.removeComponentFromEntity(light.id,Collider);}
      const collider=new Collider();collider.shape=cage.shape;collider.friction=cage.friction;
      view.ecd.addComponentToEntity(light.id,collider);
      view.ecd.addComponentToEntity(light.id,ClothCollider.from({inflation:.015*scale,friction_scale:.25}));
    }
  }
  corpse(rig,state){
    const {view}=this;
    if(!rig.dead){
      this.clearViewAlpha(rig);
      if(view.ecd.getComponent(rig.id,Cloth))view.ecd.removeComponentFromEntity(rig.id,Cloth);
      view.ecd.removeComponentFromEntity(rig.id,Animation);rig.dead=true;rig.t.makeIdentity();t64_announce_change(view.ecd,rig.id);
      if(rig.telegraph){view.remove(rig.telegraph);delete rig.telegraph;}
      rig.worldPoses=state.joints.map(()=>new Transform64());rig.inverse=new Float64Array(16);rig.matrix=new Float64Array(16);
    }
    if(rig.weapon&&state.weaponPose){
      const {position,rotation}=state.weaponPose;
      for(const {id,t} of rig.weapon){t.setTranslation(...position);t.setRotation(...rotation);t.setScale(state.scale,state.scale,state.scale);t.updateMatrix();t64_announce_change(view.ecd,id);}
    }
    updateWeaponLight(view,rig,clamp01((45-state.age)/4));
    const instance=view.meshSystem.instance_of(rig.id);if(!instance)return;
    const skin=instance.skins[0],bones=rigs[state.name].bones,{ecd}=view;
    if(!rig.corpseReady){
      // The clips gave the joints to the GPU and unregistering Animation took them back; physics
      // claims them here as well, so a clip still draining cannot keep a row it no longer drives.
      for(const joint of skin.joints)gpu_authority_revoke(ecd,joint,GPUStateAuthorityFlags.TransformAttachment);
      rig.corpseReady=true;
    }
    for(let i=0;i<state.joints.length;i++){
      const pose=state.joints[i],world=rig.worldPoses[i];world.setTranslation(...pose.position);world.setRotation(...pose.rotation);world.setScale(state.scale,state.scale,state.scale);world.updateMatrix();
      const local=ecd.getComponent(skin.joints[i],TransformAttachment).transform;
      if(bones[i].parent<0)local.copy(world);
      else{m4_invert(rig.inverse,rig.worldPoses[bones[i].parent]);m4_multiply(rig.matrix,rig.inverse,world);local.fromMatrix(rig.matrix);}
    }
    // Each joint's offset is announced on the joint, parents first; the mesh system carries the
    // announcement to the joint's row, and the GPU composes the chain from the offsets.
    for(let i=0;i<bones.length;i++)ecd.sendEvent(skin.joints[i],TRANSFORM_ATTACHMENT_EVENT_CHANGE);
    if(state.appearance==='player')this.createLantern(rig,rig.worldPoses[bones.findIndex(b=>b.name==='hips')].translation);
    if(rig.lantern)this.lanternPose(rig,rig.worldPoses[bones.findIndex(b=>b.name==='hips')],clamp01((45-state.age)/4),Math.max(0,state.age-(rig.lantern.age??state.age)),lanternBodyBones.map(bone=>rig.worldPoses[bones.findIndex(b=>b.name===bone.name)]));
    if(rig.lantern)rig.lantern.age=state.age;
  }
  remove(rig){
    this.clearViewAlpha(rig);
    const {view}=this;if(view.ecd.getComponent(rig.id,Animation))view.ecd.removeComponentFromEntity(rig.id,Animation);
    if(view.ecd.getComponent(rig.id,Cloth))view.ecd.removeComponentFromEntity(rig.id,Cloth);
    removeWeaponLight(view,rig);
    if(rig.weapon)view.remove(rig.weapon);if(rig.telegraph)view.remove(rig.telegraph);rig.weapon=null;delete rig.telegraph;
    if(rig.lantern){rig.lantern.chain.dispose();view.remove(rig.lantern.parts);for(const link of rig.lantern.links??[])view.remove(link);view.ecd.removeEntity(rig.lantern.light.id);delete rig.lantern;}
    // Meep 3.22 fixes MEEP-005, but despawning still retains BLAS data (MEEP-012).
    // Retain the registered instance offstage and reuse it on the next spawn.
    rig.t.makeIdentity();rig.t.setTranslation(0,-10000,0);rig.t.updateMatrix();t64_announce_change(view.ecd,rig.id);
    let available=this.pool.get(rig.url);if(!available){available=[];this.pool.set(rig.url,available);}available.push(rig);
  }
}
