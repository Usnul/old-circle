import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {actorSocket,actorScale} from './animation.mjs';

const transform=new Transform64();
/** Native Meep query of the Blender weapon socket. No GPU readback. */
export function weaponPose(actor,age=actor.attackAge){
  const a=age===actor.attackAge?actor:{...actor,attackAge:age};
  actorSocket(transform,a,actor.archetype==='hound'?'jaw':'weapon');
  const point=y=>Array.from(new Vector3(0,y,0).applyMatrix4(transform));
  const grip=actor.weapon==='sword'?.25:0,scale=actorScale(actor);
  const origin=point(grip),start=point(actor.archetype==='hound'?0:grip+(actor.weapon==='spear'?1.15:0));
  const end=point(actor.archetype==='hound'?.26:grip+(actor.weapon==='spear'?1.55:1.13));
  const d=end.map((v,i)=>v-start[i]);
  return {origin,start,end,rotation:Array.from(transform.rotation),yaw:Math.atan2(-d[0],-d[2]),scale};
}
