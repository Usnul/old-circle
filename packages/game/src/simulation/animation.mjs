import {SceneNode} from '@woosh/meep-engine/src/shade/renderer/loader/SceneNode.js';
import {ShadeAnimationClip} from '@woosh/meep-engine/src/shade/renderer/animation/ShadeAnimationClip.js';
import {ShadeAnimationChannel} from '@woosh/meep-engine/src/shade/renderer/animation/ShadeAnimationChannel.js';
import {Node3DProperty} from '@woosh/meep-engine/src/shade/renderer/object_property/Node3DProperty.js';
import {AnimationCurve} from '@woosh/meep-engine/src/engine/animation/curve/AnimationCurve.js';
import {curve_from_track_data_linear} from '@woosh/meep-engine/src/engine/animation/clip/curve_from_track_data_linear.js';
import {animation_curve_optimize} from '@woosh/meep-engine/src/engine/animation/curve/animation_curve_optimize.js';
import {t64_evaluate_world} from '@woosh/meep-engine/src/engine/ecs/transform/t64_evaluate_world.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {SceneBundle} from '@woosh/meep-engine/src/shade/renderer/loader/SceneBundle.js';
import {prefab_compile} from '@woosh/meep-engine/src/engine/graphics3/prefab/prefab_compile.js';
import {prefab_instantiate} from '@woosh/meep-engine/src/engine/graphics3/prefab/prefab_instantiate.js';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';
import {clamp01} from '@woosh/meep-engine/src/core/math/clamp01.js';
import {smoothStep} from '@woosh/meep-engine/src/core/math/smoothStep.js';
import {euclidean_modulo} from '@woosh/meep-engine/src/core/math/euclidean_modulo.js';
import rigs from '../content/rigs.json' with {type:'json'};
import {BOSS_MOVES} from '../content/boss-moves.mjs';
import {meleeClip} from '../content/melee-attacks.mjs';

export {rigs};
export const actorRig=a=>a.archetype==='hound'?'briarHound':'pilgrim';
export const actorScale=a=>a.boss?1.85:1;
export const actorFeet=a=>[a.x,a.y-(a.boss?1.2675:a.crouch?.495:.845),a.z];

/** Meep skeletons and curves compiled from Blender bind poses and Actions — the loader's shape: a scene bundle of records, joints addressed by index. */
export function createSkeleton(name){
  const data=rigs[name],bundle=new SceneBundle(),root=bundle.add_node(SceneNode.from({name}));
  // parents before children, whatever order the export listed the bones in
  const joints=new Array(data.bones.length).fill(-1);let pending=data.bones.map((_b,i)=>i);
  while(pending.length>0){
    const next=[];
    for(const i of pending){const b=data.bones[i];if(b.parent>=0&&joints[b.parent]===-1){next.push(i);continue;}joints[i]=bundle.add_node(SceneNode.from({name:b.name,parent:b.parent<0?root:joints[b.parent],translation:b.position,rotation:b.rotation,scale:b.scale}));}
    if(next.length===pending.length)throw new Error(`rig ${name}: bones form a cycle`);
    pending=next;
  }
  const clips=Object.entries(data.clips).map(([name,source])=>{
    const channels=[];
    for(let i=0;i<joints.length;i++)for(const [key,property,count] of [['position',Node3DProperty.Translation,3],['rotation',Node3DProperty.Rotation,4],['scale',Node3DProperty.Scale,3]]){
      const curves={};for(let axis=0;axis<count;axis++){
        const curve=new AnimationCurve();curve_from_track_data_linear(curve,source.tracks[i][key],source.times,count,axis);
        animation_curve_optimize(curve,.00002);curves['xyzw'[axis]]=curve;
      }
      channels.push(ShadeAnimationChannel.from({target:joints[i],property,curves}));
    }
    return ShadeAnimationClip.from({name,channels});
  });
    bundle.clips=clips;
  return {bundle,root,joints,clips,data,byName:new Map(clips.map(c=>[c.name,c]))};
}

const directions=['','_forward_right','_right','_back_right','_back','_back_left','_left','_forward_left'];
/** Identical clip times and weights drive GPU skinning and CPU damage sockets. */
export function animationPlan(a){
  const hound=a.archetype==='hound',data=rigs[actorRig(a)],clock=a.animationTime??0,gait=a.gaitPhase??0,speed=Math.hypot(a.vx,a.vz);
  const prefix=hound?'':a.weapon+'_',move=smoothStep(0,1,speed/.6),run=smoothStep(0,1,(speed-(hound?1.8:3.5))/(hound?1.7:2.4)),plan=[];
  const add=(name,weight,time)=>{if(weight>0&&data.clips[name])plan.push({name,weight,time:clamp(time,0,data.clips[name].duration)});};
  const loop=(name,weight,phase)=>add(name,weight,(phase%1)*data.clips[name].duration);
  const travel=(kind,weight,stride)=>{
    stride*=actorScale(a);
    if(hound){loop(kind,weight,gait/stride);return;}
    const forward=-Math.sin(a.yaw)*a.vx-Math.cos(a.yaw)*a.vz,right=Math.cos(a.yaw)*a.vx-Math.sin(a.yaw)*a.vz;
    const sector=euclidean_modulo(Math.atan2(right,forward)/(Math.PI/4),8),first=Math.floor(sector),blend=sector-first;
    loop(prefix+kind+directions[first],weight*(1-blend),gait/stride);
    loop(prefix+kind+directions[(first+1)%8],weight*blend,gait/stride);
  };
  let action=null,actionTime=0,actionWeight=0;
  if(a.mantle){action=a.mantle.phase==='hang'?'hang':'mantle';actionTime=a.mantle.phase==='hang'?clock%1.6:a.mantle.t;actionWeight=1;}
  else if(a.boss&&BOSS_MOVES[a.bossMove]?.clip&&a.attackKind==='ritual'&&(a.windup>0||a.attackAge>=0)){
    const move=BOSS_MOVES[a.bossMove];action=move.clip;actionTime=move.windup+(a.windup>0?-a.windup:a.attackAge);
    actionWeight=smoothStep(0,1,actionTime/.12)*(1-smoothStep(0,1,(actionTime-move.windup-move.recovery+.15)/.15));
  }
  else if(a.attackAge>=0){
    action=a.attackKind==='nova'?'nova':meleeClip(a);actionTime=a.attackAge;
    const length=data.clips[action]?.duration??.7,blendIn=!hound&&(a.weapon==='sword'||a.weapon==='spear')?.12:.09;
    // Settle the running arms into the windup before the active blade window.
    actionWeight=smoothStep(0,1,actionTime/blendIn)*(1-smoothStep(0,1,(actionTime-length+.12)/.12));
  }
  else if(a.windup>0&&a.attackKind==='nova'){action='nova';actionTime=Math.min(.5,1-a.windup);actionWeight=.85;}
  else if(a.hurtTime>0){action='hurt';actionTime=.3-a.hurtTime;actionWeight=.8;}
  else if(!a.grounded){
    // Phase follows physical ascent/descent, with a short takeoff blend. The
    // apex no longer swaps between two unrelated held poses.
    action='jump';actionTime=.08+clamp01((6.4-a.vy)/12.8)*.48;actionWeight=.85*smoothStep(0,1,(a.airTime??.1)/.08);
  }
  else if(!hound&&!a.crouch&&a.landingAge>=0){action='land';actionTime=a.landingAge;actionWeight=(a.landingStrength??1)*(1-smoothStep(0,1,(actionTime-.17)/.05));}
  const base=1-actionWeight;
  if(!hound&&a.crouch){loop(prefix+'crouch',base*(1-move),clock/3.2);travel('crouch_walk',base*move,1.12);}
  else{loop(prefix+'idle',base*(1-move),clock/(hound?3.4:3.2));travel('walk',base*move*(1-run),hound?1.04:1.12);travel('run',base*move*run,hound?1.36:1.84);}
  if(action==='bow'){
    // Small authored elevation intervals keep hands, bow and torso together
    // in both native animation playback and simulation socket evaluation.
    const pitch=clamp(a.intent?.pitch??0,-1.35,1.35),step=.45,lo=Math.floor(pitch/step),blend=pitch/step-lo;
    const name=index=>index===0?'bow':`bow_aim_${Number((index*step).toFixed(2))}`;
    add(name(lo),actionWeight*(1-blend),actionTime);add(name(lo+1),actionWeight*blend,actionTime);
  }else if(action)add(action,actionWeight,actionTime);
  if(!plan.length)loop(prefix+'idle',1,clock/3.2);
  const total=plan.reduce((n,p)=>n+p.weight,0);for(const p of plan)p.weight/=total;
  return plan;
}

/**
 * The same rig as the engine holds a spawned one: entities in a dataset of their own, each joint an
 * offset from its parent, the clips retargeted onto them. Sockets and joint poses are evaluated
 * exactly from the clips over that chain, which is the same arithmetic the GPU runs for the drawn
 * character — so the CPU's damage sockets and the picture agree.
 */
export function createSimulationSkeleton(name){
    const skeleton=createSkeleton(name);
  const prefab=prefab_compile(skeleton.bundle),dataset=new EntityComponentDataset();dataset.registerManyComponentTypes([Transform64]);
  const root=dataset.createEntity(),placement=new Transform64();placement.updateMatrix();dataset.addComponentToEntity(root,placement);
  const instance=prefab_instantiate(prefab,dataset,root),joints=skeleton.data.bones.map(b=>instance.entity_of(b.name)),clips=instance.clips;
  return {dataset,root,placement,instance,joints,clips,data:skeleton.data,byName:new Map(clips.map(c=>[c.name,c]))};
}

const templates=new Map();
export function skeletonFor(a){const name=actorRig(a);if(!templates.has(name))templates.set(name,createSimulationSkeleton(name));return templates.get(name);}
export function actorPlaybacks(a,skeleton=skeletonFor(a)){return animationPlan(a).map(p=>({clip:skeleton.byName.get(p.name),time:p.time,weight:p.weight}));}
export function placeSkeleton(a,skeleton){const scale=actorScale(a),yaw=a.yaw+Math.PI,t=skeleton.placement;t.setTranslation(...actorFeet(a));t.setScale(scale,scale,scale);t.setRotation(0,Math.sin(yaw/2),0,Math.cos(yaw/2));t.updateMatrix();}
export function actorSocket(result,a,name){
  const skeleton=skeletonFor(a);placeSkeleton(a,skeleton);
  return t64_evaluate_world(result,skeleton.dataset,skeleton.instance.entity_of(name),actorPlaybacks(a,skeleton));
}
export function actorJointPoses(a){
  const skeleton=skeletonFor(a);placeSkeleton(a,skeleton);const playbacks=actorPlaybacks(a,skeleton);
  return skeleton.joints.map(j=>{const t=t64_evaluate_world(new Transform64(),skeleton.dataset,j,playbacks);return {position:Array.from(t.translation),rotation:Array.from(t.rotation)};});
}
