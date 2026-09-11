import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_look_rotation} from '@woosh/meep-engine/src/engine/ecs/transform/t64_look_rotation.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {Decal} from '@woosh/meep-engine/src/engine/graphics/ecs/decal/v2/Decal.js';
import {FootContacts,presentedFeet} from '@old-circle/game/simulation/foot-contacts.mjs';

const surfaces={
  grass:{color:[.07,.10,.03,.3],life:7},gravel:{color:[.12,.10,.055,.4],life:10},
  sand:{color:[.22,.14,.06,.45],life:14},snow:{color:[.10,.16,.19,.62],life:18},
  stone:{color:[.38,.32,.23,.13],life:4},wood:{color:[.34,.27,.18,.12],life:4},
};
/** Presentation-only contacts: one outstanding worker query, at most 16 actors. */
export class WorldFootsteps {
  constructor(view){this.view=view;this.contacts=new FootContacts();this.pool=[];this.sequence=0;this.lastQuery=-1;this.current=new Map();}
  update(actors,playerId,epoch,now,dt){
    if(epoch!==this.contacts.epoch){this.contacts.reset(epoch);this.pending=null;}
    this.current=new Map(actors.map(a=>[a.id,a]));this.playerId=playerId;
    for(const mark of this.pool){if(!mark.active)continue;mark.age+=dt;const fade=Math.max(0,Math.min(1,(mark.life-mark.age)/2));mark.decal.color.setA(mark.alpha*fade);if(mark.age>=mark.life){mark.active=false;mark.decal.color.setA(0);this.view.ecd.removeComponentFromEntity(mark.id,Decal);}}
    // Leave spare projectors while the oldest prints fade under crowd pressure.
    for(const hound of [false,true]){const active=this.pool.filter(m=>m.active&&m.hound===hound).sort((a,b)=>b.age-a.age);for(const mark of active.slice(0,Math.max(0,active.length-44)))mark.life=Math.min(mark.life,mark.age+.6);}
    this.contacts.prune(now);
    if(this.pending&&now-this.pending.time>.15)this.pending=null;
    if(this.pending||now-this.lastQuery<1/30||!this.view.queryFootSurfaces)return;
    const player=this.current.get(playerId);if(!player)return;
    const nearby=actors.filter(a=>a.hp>0&&Math.hypot(a.x-player.x,a.y-player.y,a.z-player.z)<22).sort((a,b)=>(a.id===playerId?-1:b.id===playerId?1:Math.hypot(a.x-player.x,a.z-player.z)-Math.hypot(b.x-player.x,b.z-player.z))).slice(0,16);
    const feet=nearby.flatMap(actor=>presentedFeet(actor).map(foot=>({actor,foot}))),id=++this.sequence;
    this.lastQuery=now;this.pending={id,epoch,time:now,feet};
    this.view.queryFootSurfaces({type:'foot-surfaces',id,epoch,feet:feet.map(({foot})=>({position:foot.position,scale:foot.scale}))});
  }
  accept(data){
    const pending=this.pending,now=performance.now()/1000;if(!pending||data.id!==pending.id)return;this.pending=null;
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
    const {view}=this,surface=hit.surface==='terrain'?view.ground.surfaceAt(hit.position[0],hit.position[2]):hit.surface,profile=surfaces[surface]??surfaces.stone;
    view.audio.footstep(actor,foot,hit.position,surface,now,actor.id===this.playerId);
    if(view.transients.filter(t=>t.footstep).length<32){
      const p=hit.position.map((v,i)=>v+hit.normal[i]*.025),emitter=view.emitter('step-'+surface,p,0,.7);
      view.transients.at(-1).footstep=true;view.particles.burst(emitter.id,actor.crouch?2:foot.hound?3:6);
    }
    let mark=this.pool.find(m=>!m.active&&m.hound===foot.hound);
    if(!mark){if(this.pool.filter(m=>m.hound===foot.hound).length>=64)return;const decal=new Decal(),t=new Transform64();decal.uri_albedo=`/assets/vfx/${foot.hound?'paw':'boot'}-print.png`;decal.color.setA(0);const id=new Entity().add(t).build(view.ecd);mark={decal,t,id,hound:foot.hound};this.pool.push(mark);}
    const {t,decal,id}=mark,n=hit.normal,h=foot.heading,dot=h.reduce((sum,v,i)=>sum+v*n[i],0),heading=h.map((v,i)=>v-dot*n[i]);
    // Meep decals project along local +Z INTO the surface. Local Y is the toe.
    t64_look_rotation(t,...n.map(v=>-v),...heading);t.setTranslation(...hit.position.map((v,i)=>v+n[i]*.018));
    t.setScale((foot.hound?.16:.22)*foot.scale,(foot.hound?.19:.34)*foot.scale,.12*foot.scale);t.updateMatrix();t64_announce_change(view.ecd,id);
    decal.color.set(...profile.color);Object.assign(mark,{active:true,age:0,life:profile.life,alpha:profile.color[3]});
    view.ecd.addComponentToEntity(id,decal);
  }
}
