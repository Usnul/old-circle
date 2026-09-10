import {AcousticProbeField} from '@woosh/meep-engine/src/engine/sound/simulation/probe/AcousticProbeField.js';
import {ProbeReverbRenderer} from '@woosh/meep-engine/src/engine/sound/simulation/render/ProbeReverbRenderer.js';
import {EventInstanceState} from '@woosh/meep-engine/src/engine/sound/sopra/runtime/EventInstance.js';
import {Ray3} from '@woosh/meep-engine/src/core/geom/3d/ray/Ray3.js';
import {createWorldAcoustics} from '@old-circle/game/world/acoustics.mjs';
import probes from '@old-circle/game/content/acoustic-probes.json';

export const ACOUSTIC_VOICE_LIMIT=24;
const SKY_DIRECTIONS=[[0,1,0],[.6,.8,0],[-.6,.8,0],[0,.8,.6],[0,.8,-.6]];
export class WorldAcoustics {
  constructor(sopra,layout){
    const {simulator,bodies}=createWorldAcoustics(layout);this.simulator=simulator;
    this.field=new AcousticProbeField();this.field.fromJSON(probes.field);
    // A post-effects send returns through master gain; broad wind stays dry.
    this.reverb=new ProbeReverbRenderer(sopra.audioContext,sopra.busGraph.getInput('master'));
    this.reverb.maxDecaySeconds=2;this.reverb.sendLevel=.018;this.reverb.changeThreshold=.15;
    sopra.busGraph.getOutput('effects').connect(this.reverb.input);
    this.elapsed=1;this.probeElapsed=1;this.ray=new Ray3();this.bands=new Float32Array(3);
    this.stats={bodies,probes:this.field.size,voices:0,probe:-1,cover:0,ms:0,decay:0};
  }
  update(listener,voices,dt){
    this.elapsed+=dt;this.probeElapsed+=dt;if(this.elapsed<.05)return;this.elapsed=0;const started=performance.now();
    const live=[...voices].filter(v=>v.acoustic&&v.position&&v.state===EventInstanceState.Playing&&Math.hypot(...v.position.map((x,i)=>x-listener[i]))<v.description.distanceMax);
    live.sort((a,b)=>Math.hypot(...a.position.map((x,i)=>x-listener[i]))-Math.hypot(...b.position.map((x,i)=>x-listener[i])));
    live.length=Math.min(live.length,ACOUSTIC_VOICE_LIMIT);this.simulator.apply(live,listener);this.stats.voices=live.length;
    if(this.probeElapsed>=.2){
      this.probeElapsed=0;const index=this.simulator.occluderIndex,probe=this.field.nearestVisibleIndex(...listener,index);this.stats.probe=probe;
      let covered=0;for(const direction of SKY_DIRECTIONS){this.ray.set([...listener,...direction,24]);if(index.anyHit(this.ray))covered++;}
      const cover=covered/SKY_DIRECTIONS.length;this.stats.cover=cover;
      // Normalised convolution has no absolute reflected-energy level. Bound
      // its outdoor return and tail using local shelter, while enclosed rooms
      // retain the baked three-band decay. This is an authored mix choice.
      this.reverb.sendLevel=.018+.162*cover;
      for(let band=0;band<3;band++)this.bands[band]=probe<0?0:Math.min(this.field.reverbBand(probe,band),.35+1.65*cover);
      this.reverb.setBands(this.bands);this.stats.decay=Math.max(...this.bands);
    }
    this.stats.ms=performance.now()-started;
  }
}
