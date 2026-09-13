import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {TransformAttachment} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachment.js';
import {t64_look_rotation} from '@woosh/meep-engine/src/engine/ecs/transform/t64_look_rotation.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {heightAt} from '@old-circle/game/world/regions.mjs';
import {PARTICLE_LAYERS,EFFECT_LAYERS,layerEffect} from './particle-layers.mjs';
import {GameAssetType} from '@woosh/meep-engine/src/engine/asset/GameAssetType.js';

export function impactKind(event){
  if(['cinder','frost','stars','roots'].includes(event.effect))return event.effect==='stars'?'arcane':event.effect;
  if(event.damageType==='magic'||event.weapon==='staff')return 'arcane';
  return event.targetMaterial==='flesh'?'flesh':'physical';
}

/** An assembly owns an anchor and independent ParticleEffect children. Particles
 * are born in world space: moving the anchor leaves a naturally fading wake. */
export class WorldVFX {
  constructor(view){this.view=view;this.groups=new Set();this.missiles=new Map();this.seen=new Set();}
  async prepare(assets){
    // Pin one dormant native emitter per sprite in the shared atlas. A .13 s
    // contact flash must not spend its only visible frames waiting for an image,
    // nor should the atlas repack every time the last impact tail disappears.
    const textures=new Map();
    for(const [kind,p] of Object.entries(PARTICLE_LAYERS))if(!textures.has(p.texture))textures.set(p.texture,kind);
    await Promise.all([...textures.keys()].map(name=>assets.promise(`/assets/vfx/${name}.png`,GameAssetType.Image)));
    this.palette=[...textures.values()].map(kind=>{
      const c=layerEffect(kind);c.emitting=false;
      return new Entity().add(new Transform64()).add(c).build(this.view.ecd);
    });
  }
  create(kind,position,{continuous=false,persistent=false,direction=[0,1,0],scale=1,countScale=1,follow=null}={}){
    const recipe=EFFECT_LAYERS[kind];if(!recipe)throw new Error(`Unknown VFX assembly: ${kind}`);
    const {ecd,particles}=this.view,t=new Transform64(),length=Math.hypot(...direction);
    const heading=length>.0001?direction.map(v=>v/length):[0,1,0];
    // EMITTER_DIRECTION is local -Z; choose a nonparallel up for floor impacts.
    t64_look_rotation(t,...heading.map(v=>-v),...(Math.abs(heading[1])>.95?[0,0,1]:[0,1,0]));
    t.setTranslation(...position);t.updateMatrix();
    const id=new Entity().add(t).build(ecd),g={id,t,kind,continuous,persistent,follow,age:0,life:0,layers:[]};
    this.groups.add(g);
    for(const [name,count] of recipe){
      const profile=PARTICLE_LAYERS[name],c=layerEffect(name,continuous?count:0,scale),child=new Transform64();child.copy(t);
      if(kind==='brazier'&&continuous)c.prewarm=profile.life;
      const attachment=new TransformAttachment();attachment.parent=id;
      const entity=new Entity().add(child).add(c).add(attachment).build(ecd);
      g.layers.push({id:entity,c});g.life=Math.max(g.life,profile.life+.12);
      if(!continuous)particles.burst(entity,Math.max(1,Math.round(count*countScale)));
    }
    return g;
  }
  move(g,position){g.t.setTranslation(...position);g.t.updateMatrix();t64_announce_change(this.view.ecd,g.id);}
  stop(g){if(!g?.continuous||!this.groups.has(g))return;g.continuous=false;g.age=0;for(const layer of g.layers)layer.c.emitting=false;}
  remove(g){if(!g||!this.groups.delete(g))return;for(const layer of g.layers)this.view.ecd.removeEntity(layer.id);this.view.ecd.removeEntity(g.id);}
  groundBurst(kind,position,radius,{wave=false,countScale=1,continuous=false}={}){
    const recipe=kind==='frost'?'frost-ground':kind;
    // Sample the actual footprint, with independent upward jets. A central
    // square spray cannot describe either a circular trap or a moving wave.
    const count=wave?12:9,groups=[];
    for(let i=0;i<count;i++){
      const angle=i*Math.PI*2/count,r=wave?radius:radius*Math.sqrt((i+.5)/count);
      const x=position[0]+Math.sin(angle)*r,z=position[2]+Math.cos(angle)*r;
      groups.push(this.create(recipe,[x,heightAt(x,z)+.12,z],{direction:[Math.sin(angle),.35,Math.cos(angle)],countScale,continuous}));
    }
    return groups;
  }
  update(snapshot,actors,playerId,dt){
    dt=Math.max(0,dt);
    if(this.epoch!==snapshot.presentationEpoch){
      for(const g of this.groups)if(!g.persistent)this.remove(g);
      this.missiles.clear();this.seen.clear();this.epoch=snapshot.presentationEpoch;
    }
    // Age existing groups before spawning, so a long frame cannot consume a
    // contact flash before its first render.
    for(const g of this.groups){
      if(g.follow){const actor=actors.find(a=>a.id===g.follow);if(actor&&actor.hp>0)this.move(g,[actor.x,actor.y,actor.z]);}
      if(!g.continuous&&(g.age+=dt)>g.life)this.remove(g);
    }
    if(snapshot!==this.lastSnapshot){
      for(const event of snapshot.events){
        const key=event.key??`${event.tick}:${event.id}:${event.type}`;if(this.seen.has(key))continue;this.seen.add(key);
        if(event.type==='hit'||event.type==='impact'){
          // The outward contact normal keeps debris on the visible struck face.
          const normal=event.normal??event.direction??[0,1,0],position=event.position.map((v,i)=>v+normal[i]*.025);
          this.create(impactKind(event),position,{direction:normal,scale:Math.min(1.4,.85+(event.damage??20)/120)});
        }
        if(event.type==='nova'){
          const kind=event.effect==='frost'?'frost':'shockwave';
          this.create(kind,event.position,{scale:1.5});this.groundBurst(kind,event.position,event.radius,{wave:true});
        }
        if(event.type==='heal'){
          const actor=actors.find(a=>a.id===event.id);
          this.create('heal',actor?[actor.x,actor.y,actor.z]:event.position,{follow:event.id});
        }
      }
      while(this.seen.size>2048)this.seen.delete(this.seen.values().next().value);
      this.lastSnapshot=snapshot;
    }
    const player=actors.find(a=>a.id===playerId),live=new Set();
    const spells=snapshot.projectiles.filter(p=>p.weapon==='staff'&&p.kind!=='wave'&&p.kind!=='sigil'&&(!player||Math.hypot(p.position[0]-player.x,p.position[2]-player.z)<48)).slice(0,24);
    for(const p of spells){
      const key=p.key??p.id;live.add(key);let g=this.missiles.get(key);
      if(g&&(p.age<g.projectileAge-.04||Math.hypot(...p.position.map((v,i)=>v-g.t.translation[i]))>3)){this.stop(g);this.missiles.delete(key);g=null;}
      if(!g){g=this.create(p.effect==='cinder'?'cinder-trail':'spell-trail',p.position,{continuous:true});this.missiles.set(key,g);}
      this.move(g,p.position);g.projectileAge=p.age;
    }
    for(const [key,g] of this.missiles)if(!live.has(key)){this.stop(g);this.missiles.delete(key);}
  }
}
