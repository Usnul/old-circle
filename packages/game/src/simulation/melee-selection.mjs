import {MELEE_ATTACKS} from '../content/melee-attacks.mjs';
import {WEAPONS,canDamage} from '../content/catalog.mjs';
import {actorFeet,actorScale} from './animation.mjs';
import {weaponPose} from './weapon-pose.mjs';

const trajectories=new Map();
/** Eight conservative swept boxes, in a unit actor's facing coordinates.
 * Deriving them from the clips keeps selection aligned with authored changes;
 * actual damage still uses the finer native blade sweeps at each physics tick.
 */
export function attackTrajectory(weapon,clip,crouch=false){
  const key=`${weapon}:${clip}:${crouch}`;
  if(trajectories.has(key))return trajectories.get(key);
  const actor={weapon,attackVariant:clip,attackKind:'weapon',archetype:'hollow',x:0,y:crouch?.495:.845,z:0,yaw:0,vx:0,vz:0,grounded:true,crouch};
  const [start,end]=WEAPONS[weapon].active,boxes=[];
  let previous=weaponPose(actor,start);
  for(let i=1;i<=8;i++){
    const time=start+(end-start)*i/8,current=weaponPose(actor,time),points=[previous.start,previous.end,current.start,current.end];
    boxes.push({time,min:[0,1,2].map(axis=>Math.min(...points.map(p=>p[axis]))-.11),max:[0,1,2].map(axis=>Math.max(...points.map(p=>p[axis]))+.11),segments:[[previous.start,previous.end],[current.start,current.end]]});
    previous=current;
  }
  trajectories.set(key,boxes);return boxes;
}

export function selectMeleeAttack(actor,targets,visible=()=>true){
  const variants=MELEE_ATTACKS[actor.weapon];
  if(!variants||actor.archetype==='hound')return actor.weapon;
  // Melee uses the centred camera; only ranged weapons use a shoulder offset.
  const scale=actorScale(actor),feet=actorFeet(actor),c=Math.cos(actor.yaw),s=Math.sin(actor.yaw),eye=[actor.x,actor.y+.7,actor.z];
  const pitch=actor.intent?.pitch??0,aim=[-s*Math.cos(pitch),-Math.sin(pitch),-c*Math.cos(pitch)];
  const rotation=actor.attackId%variants.length;
  const ordered=variants.slice(rotation).concat(variants.slice(0,rotation));
  let chosen=null,best=-Infinity;
  for(const target of targets){
    if(!canDamage(actor,target))continue;
    const targetScale=actorScale(target),base=actorFeet(target),hound=target.archetype==='hound';
    // Aim for visible flesh/armour, including the low body of the hound.
    const center=[target.x,base[1]+(hound?.65:target.crouch?.6:1.05)*targetScale,target.z];
    const dx=center[0]-feet[0],dz=center[2]-feet[2],forward=-s*dx-c*dz,distance=Math.hypot(dx,dz);
    if(forward<.05||distance>WEAPONS[actor.weapon].reach*scale+.5)continue;
    const local=[(c*dx-s*dz)/scale,(center[1]-feet[1])/scale,(s*dx+c*dz)/scale];
    const radius=(hound?.30:.36)*targetScale/scale;
    const gaps=new Map();
    const valid=ordered.filter(clip=>attackTrajectory(actor.weapon,clip,!!actor.crouch).some(box=>{
      const gap=local.map((v,i)=>Math.max(box.min[i]-v,0,v-box.max[i]));
      return Math.hypot(...gap)<radius;
    }));
    // Refine conservative boxes against their blade segments. A diagonal box
    // alone can include empty space above a dog's back or beside a spear tip.
    for(const clip of valid)gaps.set(clip,Math.min(...attackTrajectory(actor.weapon,clip,!!actor.crouch).flatMap(box=>box.segments.map(([from,to])=>{
      const d=to.map((v,i)=>v-from[i]),length2=d.reduce((sum,v)=>sum+v*v,0);
      const t=Math.max(0,Math.min(1,local.reduce((sum,v,i)=>sum+(v-from[i])*d[i],0)/Math.max(.000001,length2)));
      return Math.hypot(...local.map((v,i)=>v-from[i]-d[i]*t));
    }))));
    const reachable=valid.filter(clip=>gaps.get(clip)<radius+.11);
    if(!reachable.length||!visible(target,center))continue;
    const ray=center.map((v,i)=>v-eye[i]),length=Math.hypot(...ray);
    const alignment=ray.reduce((sum,v,i)=>sum+v*aim[i],0)/Math.max(.001,length);
    // Camera intent dominates; distance breaks ties between similar bearings.
    const score=alignment*4+forward/Math.max(.001,distance)-distance*.12;
    if(score<=best)continue;
    best=score;
    // Prefer a path through the body centre; rotate similarly useful attacks
    // without allowing variety to select a high swing over a nearby dog.
    let quality=Infinity;
    for(const clip of reachable){
      const gap=gaps.get(clip);
      if(gap<quality-.08){quality=gap;chosen=clip;}
    }
  }
  return chosen??ordered.find(clip=>clip!==actor.attackVariant)??ordered[0];
}
