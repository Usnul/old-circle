import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_look_rotation} from '@woosh/meep-engine/src/engine/ecs/transform/t64_look_rotation.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {Decal} from '@woosh/meep-engine/src/engine/graphics/ecs/decal/v2/Decal.js';
import {FootContacts,presentedFeet} from '@old-circle/game/simulation/foot-contacts.mjs';
import {actorFeet,actorScale} from '@old-circle/game/simulation/animation.mjs';
import {sphere_project} from '@woosh/meep-engine/src/core/geom/3d/sphere/sphere_project.js';
import {effect,FOOTSTEP_EFFECTS} from './effects.mjs';
import {GameAssetType} from '@woosh/meep-engine/src/engine/asset/GameAssetType.js';
import {clamp01} from '@woosh/meep-engine/src/core/math/clamp01.js';

const surfaces={
  // Broken blades leave the terrain visible between flattened strands.
  grass:{color:[.57,.58,.28,.72],life:7,imprint:true,texture:'grass',priority:0},gravel:{color:[.20,.17,.12,.65],life:10,imprint:true,priority:1},
  sand:{color:[.36,.25,.13,.72],life:14,imprint:true,priority:2},snow:{color:[.24,.32,.37,.78],life:18,imprint:true,priority:3},
  stone:{color:[.18,.16,.12,.28],life:3,priority:4},wood:{color:[.16,.11,.06,.24],life:3,priority:5},
};
// Fraction of the viewport, independent of resolution. A normal actor reaches
// this threshold at about 28 m with the game's lens; a keeper at about 52 m.
const MIN_SCREEN_AREA=.0018;
export function footstepScreenArea(actor,camera){
  if(!camera)return 1;
  const scale=actorScale(actor),radius=(actor.archetype==='hound'?.75:.95)*scale,[x,bottom,z]=actorFeet(actor),y=bottom+radius;
  const m=camera.view_matrix,depth=-(m[2]*x+m[6]*y+m[10]*z+m[14]);
  if(depth+radius<=camera.near)return 0;
  for(let i=0;i<24;i+=4){const f=camera.frustum;if(f[i]*x+f[i+1]*y+f[i+2]*z+f[i+3]<-radius)return 0;}
  // sphere_project is singular at the eye plane. Intersecting spheres are near.
  if(depth<=radius)return 1;
  const area=sphere_project([x,y,z,radius],m,1/Math.tan(camera.fov/2))/(4*camera.aspect);
  return area>=MIN_SCREEN_AREA?area:0;
}

function contactHeading(actor,foot,normal){
  const h=foot.heading,dot=h.reduce((sum,v,i)=>sum+v*normal[i],0),tangent=h.map((v,i)=>v-dot*normal[i]);
  if(Math.hypot(...tangent)>.001)return tangent;
  // A vertical toe during a landing still needs a finite projector basis.
  const yaw=actor.yaw??0,fallback=[-Math.sin(yaw),0,-Math.cos(yaw)],d=fallback.reduce((sum,v,i)=>sum+v*normal[i],0);
  return fallback.map((v,i)=>v-d*normal[i]);
}
/** Presentation-only contacts: one outstanding worker query, at most 16 actors. */
export class WorldFootsteps {
  constructor(view){
    this.view=view;this.contacts=new FootContacts();this.pool=[];this.sequence=0;this.stampSequence=0;this.lastQuery=-1;this.current=new Map();
    // Short bursts cannot wait for their first texture fetch and decode.
    const assets=view.engine?.assetManager;
    if(assets)for(const name of ['step-dust','step-grit','step-leaf',...['boot','paw'].flatMap(shape=>['print','imprint','imprint-normal','grass','grass-normal'].map(texture=>shape+'-'+texture))])assets.promise(`/assets/vfx/${name}.png`,GameAssetType.Image).catch(error=>console.warn(`Footstep image ${name} could not be loaded`,error));
  }
  update(actors,playerId,epoch,now,dt){
    if(epoch!==this.contacts.epoch){this.contacts.reset(epoch);this.pending=null;}
    this.current=new Map(actors.map(a=>[a.id,a]));this.playerId=playerId;
    for(const mark of this.pool){if(!mark.active)continue;mark.age+=dt;const fade=clamp01((mark.life-mark.age)/2);mark.decal.color.setA(mark.alpha*fade);if(mark.age>=mark.life){mark.active=false;mark.decal.color.setA(0);this.view.ecd.removeComponentFromEntity(mark.id,Decal);}}
    // Leave spare projectors while the oldest prints fade under crowd pressure.
    for(const hound of [false,true]){
      const active=this.pool.filter(m=>m.active&&m.hound===hound).sort((a,b)=>b.age-a.age);
      const fading=new Set(active.slice(0,Math.max(0,active.length-44)).map(m=>m.stamp));
      // Both layers of a blended contact must fade together under crowd pressure.
      for(const mark of active)if(fading.has(mark.stamp))mark.life=Math.min(mark.life,mark.age+.6);
    }
    this.contacts.prune(now);
    if(this.pending&&now-this.pending.time>.15)this.pending=null;
    if(this.pending||now-this.lastQuery<1/30||!this.view.queryFootSurfaces)return;
    const player=this.current.get(playerId);if(!player)return;
    const camera=this.view.engine?.graphics.camera.camera;
    // Keep nearby offscreen contacts for positional sound. Only visible actors
    // spend particle/decal budget, and large distant actors retain their steps.
    const nearby=actors.filter(a=>a.hp>0).map(actor=>{
      const distance=Math.hypot(actor.x-player.x,actor.y-player.y,actor.z-player.z),area=footstepScreenArea(actor,camera);
      return {actor,priority:actor.id===playerId?Infinity:area+(distance<22?.001*(1-distance/22):0)};
    }).filter(a=>a.priority>0).sort((a,b)=>b.priority-a.priority).slice(0,16).map(a=>a.actor);
    const feet=nearby.flatMap(actor=>presentedFeet(actor).map(foot=>({actor,foot}))),id=++this.sequence;
    this.lastQuery=now;this.pending={id,epoch,time:now,feet};
    this.view.queryFootSurfaces({type:'foot-surfaces',id,epoch,feet:feet.map(({foot})=>({position:foot.position,scale:foot.scale}))});
  }
  accept(data,now=performance.now()/1000){
    const pending=this.pending;if(!pending||data.id!==pending.id)return;this.pending=null;
    if(data.epoch!==this.contacts.epoch||now-pending.time>.12)return;
    pending.feet.forEach(({actor,foot},i)=>{
      const current=this.current.get(actor.id),hit=data.hits[i];
      if(!current||current.hp<=0||Math.hypot(current.x-actor.x,current.y-actor.y,current.z-actor.z)>.8)return;
      // Reject responses crossing a jump, death or mantle after the sample.
      if(!current.grounded||current.mantle)actor={...actor,grounded:false};
      if(this.contacts.sample(actor,foot,hit,now))this.contact(actor,foot,hit,now);
    });
  }
  contact(actor,foot,hit,now){
    const {view}=this,mix=hit.surface==='terrain'?view.ground.surfaceMixAt(hit.position[0],hit.position[2]):[{surface:Object.hasOwn(surfaces,hit.surface)?hit.surface:'stone',weight:1}];
    const local=actor.id===this.playerId;
    view.audio.footstep(actor,foot,hit.position,mix[0].surface,now,local);
    if(!local&&!footstepScreenArea(actor,view.engine?.graphics.camera.camera))return;
    const n=hit.normal,heading=contactHeading(actor,foot,n);
    // Four overlapping player contacts may each need two material emitters.
    if(view.transients.filter(t=>t.footstep).length+mix.length<=(local?32:24)){
      const counts=mix.map(({surface,weight})=>FOOTSTEP_EFFECTS['step-'+surface].count*weight*(actor.crouch?.5:foot.hound?.7:1));
      const total=Math.max(mix.length,Math.round(counts.reduce((sum,count)=>sum+count,0)));
      counts[0]=Math.max(1,Math.min(total-mix.length+1,Math.round(counts[0])));
      if(mix.length===2)counts[1]=total-counts[0];
      for(const [i,{surface}] of mix.entries()){
        const step=FOOTSTEP_EFFECTS['step-'+surface],t=new Transform64();t64_look_rotation(t,...heading,...n);t.setTranslation(...hit.position.map((v,i)=>v+n[i]*.045*foot.scale));t.updateMatrix();
        const c=effect('step-'+surface,0,foot.scale),id=new Entity().add(c).add(t).build(view.ecd);
        view.transients.push({id,c,life:step.life+.15,age:0,footstep:true});
        view.particles.burst(id,counts[i]);
      }
    }
    // Leave room for the player's next contacts while crowded NPC prints fade.
    if(this.pool.filter(m=>m.active&&m.hound===foot.hound).length+mix.length>(local?64:56))return;
    const stamp=++this.stampSequence,life=mix.reduce((sum,{surface,weight})=>sum+surfaces[surface].life*weight,0);
    for(const {surface,weight} of mix)this.stamp(foot,hit,heading,surfaces[surface],weight,life,stamp);
  }
  stamp(foot,hit,heading,profile,weight,life,stamp){
    const {view}=this,n=hit.normal;
    let mark=this.pool.find(m=>!m.active&&m.hound===foot.hound);
    if(!mark){if(this.pool.filter(m=>m.hound===foot.hound).length>=64)return;const decal=new Decal(),t=new Transform64();decal.color.setA(0);const id=new Entity().add(t).build(view.ecd);mark={decal,t,id,hound:foot.hound};this.pool.push(mark);}
    const {t,decal,id}=mark;
    const texture=`/assets/vfx/${foot.hound?'paw':'boot'}-${profile.texture??(profile.imprint?'imprint':'print')}`;
    decal.uri_albedo=texture+'.png';
    // Source-over order stays fixed when the dominant splat changes at 50/50.
    decal.priority=profile.priority;
    // Hard floors receive a surface scuff, without the soft ground depression.
    // Reset on reuse so a snowy footprint cannot carve the next wooden floor.
    decal.uri_normal=profile.imprint?texture+'-normal.png':'';
    // Meep projects along +Z into the surface. The PNG's toes are at low V,
    // which the native atlas maps to local -Y, so +Y points toward the heel.
    t64_look_rotation(t,...n.map(v=>-v),...heading.map(v=>-v));t.setTranslation(...hit.position.map((v,i)=>v+n[i]*.018));
    // The mask includes transparent margins; size the sole, not just the quad.
    t.setScale((foot.hound?.22:.29)*foot.scale,(foot.hound?.26:.44)*foot.scale,.16*foot.scale);t.updateMatrix();t64_announce_change(view.ecd,id);
    const alpha=profile.color[3]*weight;
    decal.color.set(...profile.color);decal.color.setA(alpha);Object.assign(mark,{active:true,age:0,life,alpha,stamp});
    view.ecd.addComponentToEntity(id,decal);
  }
}
