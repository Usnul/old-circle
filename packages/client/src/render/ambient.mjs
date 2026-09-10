import {t64_look_rotation} from '@woosh/meep-engine/src/engine/ecs/transform/t64_look_rotation.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {REGIONS} from '@old-circle/game/world/regions.mjs';

const kinds={meadow:'pollen',wood:'fireflies',desert:'dust',magic:'glass',tundra:'snow',crown:'ash'};
const rates={pollen:24,fireflies:12,dust:45,glass:23,snow:140,ash:30};
export class WorldAmbient {
  constructor(view){
    this.view=view;this.wind=[0,0,0];this.cover=0;
    this.emitters=Object.fromEntries(Object.values(kinds).map(kind=>[kind,view.emitter(kind,[0,0,0],0)]));
  }
  update(player,hour,dt){
    const {view}=this,{x,y,z}=player;view.wind.follow(x,y,z);view.wind.sample(this.wind,x,y+2,z);
    this.cover+=((view.shelter??0)-this.cover)*(1-Math.exp(-dt*2));
    const nearest=REGIONS.map(r=>({region:r.id,distance:Math.hypot(x-r.center[0],z-r.center[1])})).sort((a,b)=>a.distance-b.distance);
    // Distance to the two nearest centres blends across a 24 m boundary band.
    const blend=Math.max(0,.5-(nearest[1].distance-nearest[0].distance)/48),weights={[nearest[0].region]:1-blend,[nearest[1].region]:blend};
    const daylight=Math.max(0,Math.sin((hour-6)/24*Math.PI*2)),length=Math.hypot(...this.wind);
    for(const [region,kind] of Object.entries(kinds)){
      const e=this.emitters[kind],night=kind==='fireflies'?1-daylight*.94:1;
      const target=rates[kind]*(weights[region]??0)*night*(1-this.cover);
      e.c.spawn_rate+=(target-e.c.spawn_rate)*(1-Math.exp(-dt*1.5));
      // Native emitter direction is its local -Z. Existing particles steer
      // toward the new direction on the GPU; stopping emission preserves fades.
      e.c.emitting=e.c.spawn_rate>.05;e.t.setTranslation(x,y+(kind==='snow'?5:2),z);
      if(length>.01)t64_look_rotation(e.t,...this.wind.map(v=>-v/length),0,1,0);
      e.t.updateMatrix();t64_announce_change(view.ecd,e.id);
    }
  }
}
