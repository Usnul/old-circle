import {snapshotter_emit} from '@woosh/meep-engine/src/engine/network/sim/Snapshotter.js';

export const INTEREST=Object.freeze({enter:96,leave:112,actors:96,projectiles:128,events:128,players:8,maximumPlayers:16});
export const PRIVATE_AI_FIELDS=['path','pathTick','patrolGoal','patrolWaitUntil','patrolDeadline','memory'];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const positionDistance=(p,a)=>Math.hypot(p[0]-a.x,p[1]-a.y,p[2]-a.z);

/** A recipient gets a bounded nearby world. Hysteresis prevents repeated arrivals
 * and removals while an actor moves along the edge of the visible region. */
export function projectWorld(snapshot,playerId,previous){
  const player=snapshot.actors.find(a=>a.id===playerId),prior=new Set(previous?.actors.map(a=>a.id)??[]);
  const projectiles=player?(snapshot.projectiles??[]).filter(p=>positionDistance(p.position,player)<=INTEREST.leave+(p.maxRadius??p.radius??0)).sort((a,b)=>positionDistance(a.position,player)-positionDistance(b.position,player)).slice(0,INTEREST.projectiles):[];
  const owners=new Set(projectiles.map(p=>p.owner));
  const actors=player?snapshot.actors.filter(a=>owners.has(a.id)||distance(a,player)<=(prior.has(a.id)?INTEREST.leave:INTEREST.enter)).sort((a,b)=>(a.id===playerId?-1:b.id===playerId?1:distance(a,player)-distance(b,player))).slice(0,INTEREST.actors).map(a=>{if(a.id===playerId)return {id:a.id,kind:a.kind};const wire={...a};for(const key of PRIVATE_AI_FIELDS)delete wire[key];return wire;}):[];
  const events=player?(snapshot.events??[]).filter(e=>e.id===playerId||e.victim===playerId||e.position&&positionDistance(e.position,player)<=INTEREST.leave).slice(-INTEREST.events):[];
  return {version:snapshot.version,contentVersion:snapshot.contentVersion,tick:snapshot.tick,time:snapshot.time,scope:'nearby',actors,projectiles,events};
}

/** NetworkSession's initial emitter ignores its action scope. Adapt that public
 * send hook while retaining Meep's snapshot format, framing and receiver. */
export function scopeInitialSnapshots(session,entitiesForPeer){
  const peer=session.peer,send=peer.send_initial_sync.bind(peer);
  peer.send_initial_sync=(recipient,token,frame)=>send(recipient,token,frame,buffer=>snapshotter_emit({
    buffer,world:session.world,slot_table:peer.slot_table,component_registry:peer.component_registry,
    entity_iter:visit=>{for(const entity of entitiesForPeer(recipient))visit(entity);},
  }));
}
