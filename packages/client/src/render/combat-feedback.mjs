import {Light} from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';

/** Short lived feedback follows presentation poses, never simulation or camera aim. */
export class CombatFeedback {
  constructor(view,overlay){this.view=view;this.overlay=overlay;this.healing=new Map();this.seen=new Set();this.hit=0;this.time=0;}
  update(snapshot,actors,playerId,dt){
    // Rewinding an effect's decay must never create or amplify an impact.
    dt=Math.max(0,dt);
    const view=this.view;
    if(this.epoch!==snapshot.presentationEpoch){
      this.epoch=snapshot.presentationEpoch;this.seen.clear();this.hit=0;
      for(const glow of this.healing.values())view.ecd.removeEntity(glow.light.id);
      this.healing.clear();
    }
    this.hit=Math.max(0,this.hit-dt*2.8);this.time+=dt;
    if(this.lastSnapshot!==snapshot){
      for(const event of snapshot.events){
        const key=event.key??`${event.tick}:${event.id}:${event.type}`;
        if(this.seen.has(key))continue;this.seen.add(key);
        if(event.type==='hit'&&event.id===playerId){
          const player=actors.find(a=>a.id===playerId),strength=Math.min(1,.35+event.damage/Math.max(1,player?.healthMax??100)*2);
          this.hit=Math.min(1,this.hit+strength);this.time=0;
        }
        if(event.type==='heal'){
          const actor=actors.find(a=>a.id===event.id),position=actor?[actor.x,actor.y,actor.z]:event.position;
          const emitter=view.emitter('heal',position,0,1.5);view.particles.burst(emitter.id,80);
          let glow=this.healing.get(event.id);
          if(!glow){glow={light:view.light(position,[.45,1,.32],3,Light.Type.POINT,false,4)};this.healing.set(event.id,glow);}
          glow.age=0;
        }
      }
      while(this.seen.size>2048)this.seen.delete(this.seen.values().next().value);
      this.lastSnapshot=snapshot;
    }
    for(const [id,glow] of this.healing){
      glow.age+=dt;const actor=actors.find(a=>a.id===id);
      if(glow.age>=1.3||!actor||actor.hp<=0){view.ecd.removeEntity(glow.light.id);this.healing.delete(id);continue;}
      glow.light.t.setTranslation(actor.x,actor.y+.3,actor.z);glow.light.t.updateMatrix();t64_announce_change(view.ecd,glow.light.id);
      glow.light.l.intensity.set(3*(1-glow.age/1.3));
    }
    if(this.overlay)this.overlay.style.opacity=String(this.hit*.85);
  }
  cameraKick(){return {pitch:this.hit*.028*Math.cos(this.time*35),roll:this.hit*.018*Math.sin(this.time*29)};}
}
