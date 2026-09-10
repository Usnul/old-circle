import {Node3D} from '@woosh/meep-engine/src/shade/renderer/scene/Node3D.js';
import {ShadeAnimationClip} from '@woosh/meep-engine/src/shade/renderer/animation/ShadeAnimationClip.js';
import {ShadeAnimationChannel} from '@woosh/meep-engine/src/shade/renderer/animation/ShadeAnimationChannel.js';
import {Node3DProperty} from '@woosh/meep-engine/src/shade/renderer/object_property/Node3DProperty.js';
import {AnimationCurve} from '@woosh/meep-engine/src/engine/animation/curve/AnimationCurve.js';
import {curve_from_track_data_linear} from '@woosh/meep-engine/src/engine/animation/clip/curve_from_track_data_linear.js';
import {animation_curve_optimize} from '@woosh/meep-engine/src/engine/animation/curve/animation_curve_optimize.js';
import {pose_evaluate_world} from '@woosh/meep-engine/src/shade/renderer/animation/pose/pose_evaluate_world.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import rigs from '../content/rigs.json' with {type:'json'};

export {rigs};
export const actorRig=a=>a.archetype==='hound'?'briarHound':'pilgrim';
export const actorScale=a=>a.boss?1.85:1;
export const actorFeet=a=>[a.x,a.y-(a.boss?1.2675:a.crouch?.495:.845),a.z];
const attach=(parent,child)=>{child.parent=parent;parent.children.push(child);};

/** Meep skeletons and curves compiled from Blender bind poses and Actions. */
export function createSkeleton(name){
  const data=rigs[name],root=new Node3D();root.name=name;
  const joints=data.bones.map(b=>{const n=new Node3D();n.name=b.name;n.transform_local.setTranslation(...b.position);n.transform_local.setRotation(...b.rotation);n.transform_local.setScale(...b.scale);return n;});
  for(let i=0;i<joints.length;i++)attach(data.bones[i].parent<0?root:joints[data.bones[i].parent],joints[i]);
  root.updateMatrices();
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
  return {root,joints,clips,data,byName:new Map(clips.map(c=>[c.name,c]))};
}

const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
const directions=['','_forward_right','_right','_back_right','_back','_back_left','_left','_forward_left'];
/** Identical clip times and weights drive GPU skinning and CPU damage sockets. */
export function animationPlan(a){
  const hound=a.archetype==='hound',data=rigs[actorRig(a)],clock=a.animationTime??0,gait=a.gaitPhase??0,speed=Math.hypot(a.vx,a.vz);
  const prefix=hound?'':a.weapon+'_',move=smooth(speed/.6),run=smooth((speed-3.5)/2.4),plan=[];
  const add=(name,weight,time)=>{if(weight>0&&data.clips[name])plan.push({name,weight,time:Math.max(0,Math.min(data.clips[name].duration,time))});};
  const loop=(name,weight,phase)=>add(name,weight,(phase%1)*data.clips[name].duration);
  const travel=(kind,weight,stride)=>{
    stride*=actorScale(a);
    if(hound){loop(kind,weight,gait/stride);return;}
    const forward=-Math.sin(a.yaw)*a.vx-Math.cos(a.yaw)*a.vz,right=Math.cos(a.yaw)*a.vx-Math.sin(a.yaw)*a.vz;
    const sector=((Math.atan2(right,forward)/(Math.PI/4))%8+8)%8,first=Math.floor(sector),blend=sector-first;
    loop(prefix+kind+directions[first],weight*(1-blend),gait/stride);
    loop(prefix+kind+directions[(first+1)%8],weight*blend,gait/stride);
  };
  let action=null,actionTime=0,actionWeight=0;
  if(a.mantle){action=a.mantle.phase==='hang'?'hang':'mantle';actionTime=a.mantle.phase==='hang'?clock%1.6:a.mantle.t;actionWeight=1;}
  else if(a.attackAge>=0){action=a.attackKind==='nova'?'nova':a.weapon;actionTime=a.attackAge;const length=data.clips[action]?.duration??.7;actionWeight=smooth(actionTime/.09)*(1-smooth((actionTime-length+.12)/.12));}
  else if(a.windup>0&&a.attackKind==='nova'){action='nova';actionTime=Math.min(.5,1-a.windup);actionWeight=.85;}
  else if(a.hurtTime>0){action='hurt';actionTime=.3-a.hurtTime;actionWeight=.8;}
  else if(!a.grounded){action='jump';actionTime=a.vy>0?.15:.46;actionWeight=.85;}
  const base=1-actionWeight;
  if(!hound&&a.crouch){loop(prefix+'crouch',base*(1-move),clock/3.2);travel('crouch_walk',base*move,1.12);}
  else{loop(prefix+'idle',base*(1-move),clock/(hound?3.4:3.2));travel('walk',base*move*(1-run),1.12);travel('run',base*move*run,1.84);}
  if(action)add(action,actionWeight,actionTime);
  if(!plan.length)loop(prefix+'idle',1,clock/3.2);
  const total=plan.reduce((n,p)=>n+p.weight,0);for(const p of plan)p.weight/=total;
  return plan;
}

const templates=new Map();
export function skeletonFor(a){const name=actorRig(a);if(!templates.has(name))templates.set(name,createSkeleton(name));return templates.get(name);}
export function actorPlaybacks(a,skeleton=skeletonFor(a)){return animationPlan(a).map(p=>({clip:skeleton.byName.get(p.name),time:p.time,weight:p.weight}));}
export function placeSkeleton(a,skeleton){const scale=actorScale(a),yaw=a.yaw+Math.PI;skeleton.root.transform_local.setTranslation(...actorFeet(a));skeleton.root.transform_local.setScale(scale,scale,scale);skeleton.root.transform_local.setRotation(0,Math.sin(yaw/2),0,Math.cos(yaw/2));}
export function actorSocket(result,a,name){
  const skeleton=skeletonFor(a);placeSkeleton(a,skeleton);
  return pose_evaluate_world(result,skeleton.joints.find(n=>n.name===name),actorPlaybacks(a,skeleton));
}
export function actorJointPoses(a){
  const skeleton=skeletonFor(a);placeSkeleton(a,skeleton);const playbacks=actorPlaybacks(a,skeleton);
  return skeleton.joints.map(j=>{const t=pose_evaluate_world(new Transform64(),j,playbacks);return {position:Array.from(t.translation),rotation:Array.from(t.rotation)};});
}
