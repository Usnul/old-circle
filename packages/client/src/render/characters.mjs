import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {Animation} from '@woosh/meep-engine/src/engine/ecs/animation/Animation.js';
import {AnimationClip} from '@woosh/meep-engine/src/engine/ecs/animation/AnimationClip.js';
import {SceneBundle} from '@woosh/meep-engine/src/shade/renderer/loader/SceneBundle.js';
import {SkinnedMesh} from '@woosh/meep-engine/src/shade/renderer/scene/SkinnedMesh.js';
import {Skin} from '@woosh/meep-engine/src/shade/renderer/animation/Skin.js';
import {actorRig,actorScale,actorFeet,createSkeleton,animationPlan} from '@old-circle/game/simulation/animation.mjs';
import {weaponPose} from '@old-circle/game/simulation/weapon-pose.mjs';

export class Characters {
  constructor(view){this.view=view;this.bundles=new Map();}
  bundle(url){
    if(this.bundles.has(url))return this.bundles.get(url);
    const [name,appearance]=url.split(':'),skeleton=createSkeleton(name),bundle=new SceneBundle();bundle.scenes=[skeleton.root];bundle.clips=skeleton.clips;
    const meshes=this.view.models.get(name).map(c=>{
      const mesh=new SkinnedMesh();mesh.geometry=c.geometry;mesh.material=c.material;
      if(appearance!=='player'){
        mesh.material=c.material.clone();
        if(c.material===this.view.materials.cloth)mesh.material.diffuse_color.set(...(appearance==='mage'?[.12,.17,.23]:appearance==='archer'?[.22,.20,.13]:[.20,.12,.08]));
        if(appearance==='sentinel'&&c.material===this.view.materials.iron)mesh.material.diffuse_color.set(.38,.30,.17);
      }
      mesh.parent=skeleton.root;skeleton.root.children.push(mesh);return mesh;
    });
    bundle.skins=[Skin.from({name,joints:skeleton.joints,inverse_bind_matrices:Float32Array.from(skeleton.data.bones.flatMap(b=>b.inverseBind)),meshes})];
    skeleton.root.updateMatrices();this.bundles.set(url,bundle);return bundle;
  }
  create(a){
    const mesh=new SGMesh();mesh.url=actorRig(a)+':'+(a.kind==='player'?'player':a.archetype);
    const t=new Transform64(),animation=new Animation(),id=new Entity().add(t).add(mesh).add(animation).build(this.view.ecd);
    return {id,t,animation,clips:new Map(),weapon:a.archetype==='hound'?null:this.view.model(a.weapon),weaponName:a.weapon};
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
    if(rig.weaponName!==a.weapon&&rig.weapon){view.remove(rig.weapon);rig.weapon=view.model(a.weapon);rig.weaponName=a.weapon;}
    if(rig.weapon){
      const pose=weaponPose(a);for(const {id,t} of rig.weapon){t.setTranslation(...pose.origin);t.setScale(scale,scale,scale);t.setRotation(...pose.rotation);t.updateMatrix();t64_announce_change(view.ecd,id);}
    }
  }
  remove(rig){this.view.ecd.removeEntity(rig.id);if(rig.weapon)this.view.remove(rig.weapon);if(rig.telegraph)this.view.remove(rig.telegraph);}
}
