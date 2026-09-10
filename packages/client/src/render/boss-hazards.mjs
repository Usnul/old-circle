import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {t64_look_rotation} from '@woosh/meep-engine/src/engine/ecs/transform/t64_look_rotation.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {Decal} from '@woosh/meep-engine/src/engine/graphics/ecs/decal/v2/Decal.js';
import {waveRadius} from '@old-circle/game/content/boss-moves.mjs';
import {heightAt} from '@old-circle/game/world/regions.mjs';

const colors={shockwave:[1,.55,.15],roots:[.72,.78,.24],stars:[.57,.71,1],frost:[.28,.75,1]};
export const isBossHazard=p=>p.kind==='wave'||p.kind==='sigil';
/** Warning and active boundary share the authoritative radius and terrain.
 * Stable cast keys survive worker replay, which recreates ECS entity IDs. */
export class BossHazards {
  constructor(view){this.view=view;this.marks=new Map();this.bursts=new Map();this.time=0;}
  update(projectiles,player,epoch,dt){
    const {view}=this;this.time+=dt;
    if(epoch!==this.epoch){for(const mark of this.marks.values())view.ecd.removeEntity(mark.id);this.marks.clear();this.bursts.clear();this.epoch=epoch;}
    for(const [key,time] of this.bursts)if(this.time-time>10)this.bursts.delete(key);
    const active=new Set(),nearby=projectiles.filter(p=>isBossHazard(p)&&p.age<=p.life&&(!player||Math.hypot(p.position[0]-player.x,p.position[2]-player.z)<60));
    nearby.sort((a,b)=>Math.hypot(a.position[0]-(player?.x??0),a.position[2]-(player?.z??0))-Math.hypot(b.position[0]-(player?.x??0),b.position[2]-(player?.z??0)));
    for(const p of nearby.slice(0,64)){
      const key=p.key??`${p.owner}:${p.id}`;active.add(key);let mark=this.marks.get(key);
      if(!mark){
        const decal=new Decal(),t=new Transform64(),glyph=p.kind==='wave'?'wave':p.effect==='roots'?'roots':p.effect==='stars'?'stars':'frost';
        decal.uri_albedo=decal.uri_emissive=`/assets/vfx/warning-${glyph}.png`;decal.priority=10;
        const color=colors[p.effect]??colors.shockwave;decal.color.set(...color,.85);decal.emissive_color.set(...color);
        const id=new Entity().add(t).add(decal).build(view.ecd);mark={id,t,decal,lastAge:p.age,changed:this.time};this.marks.set(key,mark);
      }
      if(mark.lastAge!==p.age){mark.lastAge=p.age;mark.changed=this.time;}
      const age=p.age+Math.min(1/30,this.time-mark.changed),casting=age<p.delay;
      // A delayed wave gathers at its source before expanding; a trap stays fixed.
      const radius=p.kind==='wave'?Math.max(.3,waveRadius(p,age)):p.radius,progress=p.delay?Math.min(1,age/p.delay):1;
      const fade=casting?1:Math.min(1,Math.max(0,(p.life-age)/.2));
      mark.decal.color.setA((casting?.35+.5*progress:.92)*fade);
      mark.decal.emissive_intensity=(casting?.3+.7*progress:1.5)*fade;
      const [x,y,z]=p.position;
      // Projection reaches the canonical floor across the full undulating arena.
      let top=y+2,bottom=y-2;
      for(let i=0;i<16;i++){const a=i/16*Math.PI*2,h=heightAt(x+Math.sin(a)*radius,z+Math.cos(a)*radius);top=Math.max(top,h+2);bottom=Math.min(bottom,h-2);}
      t64_look_rotation(mark.t,0,-1,0,0,0,-1);mark.t.setTranslation(x,(top+bottom)/2,z);mark.t.setScale(radius*2,radius*2,top-bottom);mark.t.updateMatrix();t64_announce_change(view.ecd,mark.id);
      if(!casting&&!this.bursts.has(key)){
        this.bursts.set(key,this.time);
        if(age-p.delay<.15&&view.transients.filter(t=>t.bossHazard).length<12){
          const emitter=view.emitter('hazard-'+(p.effect==='roots'?'roots':p.effect==='frost'?'frost':p.effect==='stars'?'stars':'bell'),[x,y,z],0,1.1);
          view.transients.at(-1).bossHazard=true;view.particles.burst(emitter.id,p.kind==='wave'?24:40);
        }
      }
    }
    for(const [key,mark] of this.marks)if(!active.has(key)){view.ecd.removeEntity(mark.id);this.marks.delete(key);}
  }
}
