import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import Trail3D from '@woosh/meep-engine/src/engine/graphics/ecs/trail3d/Trail3D.js';
import {Trail3DFlags} from '@woosh/meep-engine/src/engine/graphics/ecs/trail3d/Trail3DFlags.js';
import {WEAPONS} from '@old-circle/game/content/catalog.mjs';
import {weaponPose} from '@old-circle/game/simulation/weapon-pose.mjs';
import {isBossHazard} from './boss-hazards.mjs';

const MAX_TRAILS=24,RANGE=48;
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export class CombatTrails {
  constructor(view){this.view=view;this.entries=new Map();this.epoch=null;}
  clear(){for(const e of this.entries.values())this.view.ecd.removeEntity(e.id);this.entries.clear();}
  update(actors,projectiles,player,epoch,dt){
    if(epoch!==this.epoch){this.clear();this.epoch=epoch;}
    if(!player)return;
    const focus=[player.x,player.y,player.z],candidates=[];
    for(const a of actors){
      const weapon=WEAPONS[a.weapon];
      if(a.hp<=0||a.archetype==='hound'||weapon?.style!=='melee'||a.attackKind!=='weapon'||a.attackAge<weapon.active[0]||a.attackAge>weapon.active[1])continue;
      const pose=weaponPose(a),d=distance(pose.end,focus);if(d>RANGE)continue;
      candidates.push({key:`blade:${a.id}:${a.attackId}`,position:pose.end,age:a.attackAge,distance:a.id===player.id?-1:d,width:(a.boss?.085:.045)*pose.scale,life:.14,color:a.boss?[1,.66,.34,.45]:[.79,.89,.94,.42]});
    }
    for(const p of projectiles){
      if(isBossHazard(p))continue;const d=distance(p.position,focus);if(d>RANGE)continue;
      const arrow=p.weapon==='bow';candidates.push({key:`missile:${p.key??p.id}`,position:p.position,age:p.age,distance:d,width:arrow?.025:p.effect==='cinder'?.14:.09,life:arrow?.09:.22,color:arrow?[.70,.73,.68,.23]:p.effect==='cinder'?[1,.38,.10,.68]:[.28,.70,1,.62]});
    }
    candidates.sort((a,b)=>a.distance-b.distance);const selected=candidates.slice(0,MAX_TRAILS),wanted=new Set(selected.map(c=>c.key)),live=new Set();
    for(const source of selected){
      live.add(source.key);let e=this.entries.get(source.key);
      if(!e){
        if(this.entries.size>=MAX_TRAILS){const old=[...this.entries].find(([key])=>!wanted.has(key));if(old){this.view.ecd.removeEntity(old[1].id);this.entries.delete(old[0]);}else continue;}
        const trail=new Trail3D();trail.maxAge=source.life;trail.width=source.width;trail.radialSegments=4;trail.color.set(...source.color);
        const t=new Transform64();t.setTranslation(...source.position);t.updateMatrix();
        const id=new Entity().add(t).add(trail).build(this.view.ecd);e={id,t,trail,last:source.position,age:source.age,fading:0};this.entries.set(source.key,e);
      }else{
        // Reconciliation or a relocation must never draw a bridge through the
        // world. Native clear reseeds every knot at the next displayed head.
        if(e.fading||source.age<e.age-.04||distance(source.position,e.last)>3)e.trail.clear();
        e.trail.setFlag(Trail3DFlags.Spawning);e.t.setTranslation(...source.position);e.t.updateMatrix();t64_announce_change(this.view.ecd,e.id);
      }
      e.last=source.position;e.age=source.age;e.fading=0;
    }
    for(const [key,e] of this.entries)if(!live.has(key)){
      e.trail.clearFlag(Trail3DFlags.Spawning);e.fading+=dt;
      if(e.fading>e.trail.maxAge+.04){this.view.ecd.removeEntity(e.id);this.entries.delete(key);}
    }
  }
}
