import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {Animation} from '@woosh/meep-engine/src/engine/ecs/animation/Animation.js';
import {AnimationClip} from '@woosh/meep-engine/src/engine/ecs/animation/AnimationClip.js';
import {SceneBundle} from '@woosh/meep-engine/src/shade/renderer/loader/SceneBundle.js';
import {SkinnedMesh} from '@woosh/meep-engine/src/shade/renderer/scene/SkinnedMesh.js';
import {Skin} from '@woosh/meep-engine/src/shade/renderer/animation/Skin.js';
import {TransparencyMode} from '@woosh/meep-engine/src/shade/renderer/material/TransparencyMode.js';
import {TransformAuthority} from '@woosh/meep-engine/src/shade/renderer/scene/TransformAuthority.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {Light} from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {m4_invert} from '@woosh/meep-engine/src/core/geom/3d/mat4/m4_invert.js';
import {m4_multiply} from '@woosh/meep-engine/src/core/geom/3d/mat4/m4_multiply.js';
import {actorRig,actorScale,actorFeet,actorSocket,createSkeleton,animationPlan,rigs} from '@old-circle/game/simulation/animation.mjs';
import {weaponPose} from '@old-circle/game/simulation/weapon-pose.mjs';
import {armorFor} from '@old-circle/game/content/equipment.mjs';
import {BOSSES} from '@old-circle/game/content/catalog.mjs';

const keeperColors={
  warden:{cloth:[.09,.12,.11],cloak:[.53,.66,.53],brass:[.34,.28,.15]},
  rootbound:{bark:[.12,.16,.10],bone:[.65,.65,.48]},
  cantor:{cloth:[.28,.045,.025],cloak:[1.2,.31,.14],brass:[.56,.23,.08]},
  mirror:{cloth:[.16,.22,.28],cloak:[.64,.89,1.2],bone:[.5,.72,.82],iron:[.47,.61,.64]},
  frostbound:{cloth:[.23,.30,.32],cloak:[1.2,1.4,1.5],bone:[.39,.65,.73]},
  'last-king':{cloth:[.08,.045,.045],cloak:[.59,.25,.25],brass:[.66,.41,.14]},
};

export class Characters {
  constructor(view){this.view=view;this.bundles=new Map();this.pool=new Map();}
  appearance(a){return actorRig(a)+':'+(a.kind==='player'?'player':a.archetype)+':'+(a.kind==='player'?armorFor(a).appearance:BOSSES[a.archetype]?'boss_'+a.archetype:a.archetype==='mage'?'keeper':a.archetype==='archer'?'wayfarer':a.archetype==='sentinel'?'sentinel':'pilgrim');}
  bundle(url){
    if(this.bundles.has(url))return this.bundles.get(url);
    const [name,appearance,outfit='pilgrim']=url.split(':'),skeleton=createSkeleton(name),bundle=new SceneBundle();bundle.scenes=[skeleton.root];bundle.clips=skeleton.clips;
    const model=outfit.startsWith('boss_')?outfit:name==='pilgrim'&&outfit!=='pilgrim'?'armor_'+outfit:name;
    const meshes=this.view.models.get(model).map(c=>{
      const mesh=new SkinnedMesh();mesh.geometry=c.geometry;mesh.material=c.material;
      if(appearance!=='player'){
        mesh.material=c.material.clone();
        if(c.material===this.view.materials.cloth)mesh.material.diffuse_color.set(...(appearance==='mage'?[.12,.17,.23]:appearance==='archer'?[.22,.20,.13]:[.20,.12,.08]));
        if(c.material===this.view.materials.cloak)mesh.material.diffuse_color.set(...(appearance==='mage'?[.7,.9,1.3]:appearance==='archer'?[1.1,.97,.72]:[1.2,.75,.52]));
        if(appearance==='sentinel'&&c.material===this.view.materials.iron)mesh.material.diffuse_color.set(.38,.30,.17);
      }
      if(outfit.startsWith('boss_')){
        for(const [material,color] of Object.entries(keeperColors[appearance]))if(c.material===this.view.materials[material])mesh.material.diffuse_color.set(...color);
        if(appearance==='frostbound'&&c.material===this.view.materials.ember){mesh.material.diffuse_color.set(.2,.6,.8);mesh.material.emissive_factor.set(.08,.5,.8);}
      }else if(outfit!=='pilgrim'&&name==='pilgrim'){
        mesh.material=mesh.material.clone();
        const colors={wayfarer:{cloth:[.12,.17,.09],cloak:[.48,.64,.37]},keeper:{cloth:[.24,.27,.24],cloak:[1.05,1.16,1.10]},sentinel:{cloth:[.12,.08,.055],cloak:[.66,.37,.23]},winter:{cloth:[.32,.35,.34],cloak:[1.3,1.4,1.4]}}[outfit];
        if(c.material===this.view.materials.cloth)mesh.material.diffuse_color.set(...colors.cloth);
        if(c.material===this.view.materials.cloak)mesh.material.diffuse_color.set(...colors.cloak);
      }
      mesh.parent=skeleton.root;skeleton.root.children.push(mesh);return mesh;
    });
    bundle.skins=[Skin.from({name,joints:skeleton.joints,inverse_bind_matrices:Float32Array.from(skeleton.data.bones.flatMap(b=>b.inverseBind)),meshes})];
    skeleton.root.updateMatrices();this.bundles.set(url,bundle);return bundle;
  }
  create(a){
    const url=this.appearance(a),available=this.pool.get(url),rig=available?.pop();
    if(rig){
      rig.dead=false;rig.deathMaterials=null;rig.clips.clear();
      const instance=this.view.meshSystem.instance_of(rig.id);
      const source=this.bundle(url);
      for(let s=0;s<(instance?.skins.length??0);s++)for(let i=0;i<instance.skins[s].joints.length;i++){
        const joint=instance.skins[s].joints[i];joint.transform_authority=TransformAuthority.GPU;joint.transform_local.copy(source.skins[s].joints[i].transform_local);
      }
      for(const {mesh,material} of rig.baseMaterials??[]){mesh.material=material;mesh.updateMatrices();}
      rig.animation=new Animation();this.view.ecd.addComponentToEntity(rig.id,rig.animation);
      rig.weapon=a.archetype==='hound'?null:this.view.model(a.weapon);rig.weaponName=a.weapon;return rig;
    }
    const mesh=new SGMesh();mesh.url=url;
    const t=new Transform64(),animation=new Animation(),id=new Entity().add(t).add(mesh).add(animation).build(this.view.ecd);
    return {id,t,url,animation,clips:new Map(),weapon:a.archetype==='hound'?null:this.view.model(a.weapon),weaponName:a.weapon};
  }
  update(rig,a){
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
    if(a.kind==='player'){
      rig.lantern??={parts:view.model('pilgrimLantern'),light:view.light([a.x,a.y,a.z],[1,.62,.30],2.4,Light.Type.POINT,false,7),socket:new Transform64(),position:new Vector3()};
      actorSocket(rig.lantern.socket,a,'hips');this.lanternPose(rig,rig.lantern.socket,1);
    }
  }
  viewAlpha(rig,alpha){
    if(rig.dead)return;
    alpha=Math.max(0,Math.min(1,alpha));
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
      view.meshSystem.traverse_meshes(rig.id,mesh=>remember(mesh.material,material=>{mesh.material=material;mesh.updateMatrices();}));
      for(const {id} of [...rig.weapon??[],...rig.lantern?.parts??[]]){
        const geometry=view.ecd.getComponent(id,ShadedGeometry);
        remember(geometry.material,material=>{
          view.ecd.removeComponentFromEntity(id,ShadedGeometry);
          view.ecd.addComponentToEntity(id,material===geometry.material?geometry:ShadedGeometry.from(geometry.geometry,material));
        });
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
  lanternPose(rig,socket,alpha){
    const {view}=this,{parts,light,position}=rig.lantern;
    position.set(-.32,.10,-.08).applyMatrix4(socket);
    for(const {id,t} of parts){t.copy(socket);t.setTranslation(...position);t.updateMatrix();t64_announce_change(view.ecd,id);}
    // The light originates at the ember, below the attachment hook.
    position.set(-.32,-.12,-.08).applyMatrix4(socket);
    light.t.setTranslation(...position);light.t.updateMatrix();t64_announce_change(view.ecd,light.id);light.l.intensity.set(2.4*alpha);
  }
  corpse(rig,state){
    const {view}=this;
    if(!rig.dead){
      this.clearViewAlpha(rig);
      view.ecd.removeComponentFromEntity(rig.id,Animation);rig.dead=true;rig.t.makeIdentity();t64_announce_change(view.ecd,rig.id);
      if(rig.telegraph){view.remove(rig.telegraph);delete rig.telegraph;}
      rig.worldPoses=state.joints.map(()=>new Transform64());rig.inverse=new Float64Array(16);rig.matrix=new Float64Array(16);
    }
    const instance=view.meshSystem.instance_of(rig.id);if(!instance)return;
    const skin=instance.skins[0],bones=rigs[state.name].bones;
    if(!rig.deathMaterials){
      // Scene-bundle clips declare GPU ownership even before playback starts.
      // Unregistering Animation stops the clips; physics must claim the joints.
      for(const joint of skin.joints)joint.transform_authority=TransformAuthority.CPU;
      rig.baseMaterials??=[];rig.deathMaterials=[];view.meshSystem.traverse_meshes(rig.id,mesh=>{
        if(!rig.baseMaterials.some(entry=>entry.mesh===mesh))rig.baseMaterials.push({mesh,material:mesh.material});
        mesh.material=mesh.material.clone();mesh.material.transparency_mode=TransparencyMode.Transparent;rig.deathMaterials.push(mesh.material);mesh.updateMatrices();
      });
      for(const part of rig.weapon??[]){
        const geometry=view.ecd.getComponent(part.id,ShadedGeometry),material=geometry.material.clone();
        material.transparency_mode=TransparencyMode.Transparent;
        view.ecd.removeComponentFromEntity(part.id,ShadedGeometry);view.ecd.addComponentToEntity(part.id,ShadedGeometry.from(geometry.geometry,material));rig.deathMaterials.push(material);
      }
      for(const part of rig.lantern?.parts??[]){
        const geometry=view.ecd.getComponent(part.id,ShadedGeometry),material=geometry.material.clone();material.transparency_mode=TransparencyMode.Transparent;
        view.ecd.removeComponentFromEntity(part.id,ShadedGeometry);view.ecd.addComponentToEntity(part.id,ShadedGeometry.from(geometry.geometry,material));rig.deathMaterials.push(material);
      }
    }
    for(let i=0;i<state.joints.length;i++){
      const pose=state.joints[i],world=rig.worldPoses[i];world.setTranslation(...pose.position);world.setRotation(...pose.rotation);world.setScale(state.scale,state.scale,state.scale);world.updateMatrix();
      if(bones[i].parent<0)skin.joints[i].transform_local.copy(world);
      else{m4_invert(rig.inverse,rig.worldPoses[bones[i].parent]);m4_multiply(rig.matrix,rig.inverse,world);skin.joints[i].transform_local.fromMatrix(rig.matrix);}
    }
    // Parent-first hierarchy refresh sends CPU ragdoll joints to Meep skinning.
    for(let i=0;i<bones.length;i++)if(bones[i].parent<0)skin.joints[i].updateMatrices();
    const alpha=Math.max(0,Math.min(1,(45-state.age)/4));for(const material of rig.deathMaterials)material.diffuse_color.setA(alpha);
    if(rig.lantern)this.lanternPose(rig,rig.worldPoses[bones.findIndex(b=>b.name==='hips')],alpha);
    if(rig.weapon){
      const pose=rig.worldPoses[bones.findIndex(b=>b.name==='weapon')],grip=state.weapon==='sword'?.25:0;
      for(const {id,t} of rig.weapon){t.copy(pose);t.setTranslation(pose[12]+pose[4]*grip,pose[13]+pose[5]*grip,pose[14]+pose[6]*grip);t.updateMatrix();t64_announce_change(view.ecd,id);}
    }
  }
  remove(rig){
    this.clearViewAlpha(rig);
    const {view}=this;if(view.ecd.getComponent(rig.id,Animation))view.ecd.removeComponentFromEntity(rig.id,Animation);
    if(rig.weapon)view.remove(rig.weapon);if(rig.telegraph)view.remove(rig.telegraph);rig.weapon=null;delete rig.telegraph;
    if(rig.lantern){view.remove(rig.lantern.parts);view.ecd.removeEntity(rig.lantern.light.id);delete rig.lantern;}
    // Meep 3.20 retains a skin's matrix range after unregistration (MEEP-005).
    // Retain the registered instance offstage and reuse it on the next spawn.
    rig.t.makeIdentity();rig.t.setTranslation(0,-10000,0);rig.t.updateMatrix();t64_announce_change(view.ecd,rig.id);
    let available=this.pool.get(rig.url);if(!available){available=[];this.pool.set(rig.url,available);}available.push(rig);
  }
}
