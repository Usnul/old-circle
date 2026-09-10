import {WEAPONS} from '../content/catalog.mjs';

/** Blade coordinates match the Blender pivots. Rendering and damage share this
 * pose; lengths are metres along the asset's local +Y axis. */
export function weaponPose(actor,age=actor.attackAge){
  const weapon=WEAPONS[actor.weapon],scale=actor.boss?1.85:1;
  const active=weapon.active??[0,.5],progress=Math.max(0,Math.min(1,(age-active[0])/(active[1]-active[0])));
  const yaw=actor.yaw+(actor.weapon==='spear'||actor.archetype==='hound'?0:(progress-.5)*2.6);
  const direction=[-Math.sin(yaw),0,-Math.cos(yaw)],grip=actor.weapon==='spear'?1.15:.75;
  const origin=[actor.x+direction[0]*grip*scale,actor.y+.15,actor.z+direction[2]*grip*scale];
  const start=actor.weapon==='spear'?1.15:0,end=actor.weapon==='spear'?1.55:1.13;
  const point=d=>origin.map((v,i)=>v+direction[i]*d*scale);
  if(actor.archetype==='hound')return {origin,yaw,scale,start:[actor.x+direction[0]*.55,actor.y,actor.z+direction[2]*.55],end:[actor.x+direction[0]*1.05,actor.y,actor.z+direction[2]*1.05]};
  return {origin,yaw,scale,start:point(start),end:point(end)};
}
