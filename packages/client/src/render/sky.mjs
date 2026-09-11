import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {sampler2d_to_f16} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/sampler2d_to_f16.js';
import {make_sky_hosek} from '@woosh/meep-engine/src/engine/graphics/sh3/path_tracer/make_sky_hosek.js';
import {octahedral_uv_to_direction} from '@woosh/meep-engine/src/shade/renderer/light/environment/octahedral_uv_to_direction.js';
import {ShadeImage} from '@woosh/meep-engine/src/shade/renderer/texture/source/ShadeImage.js';
import {ShadeTexture} from '@woosh/meep-engine/src/shade/renderer/texture/ShadeTexture.js';
import {smoothStep} from '@woosh/meep-engine/src/core/math/smoothStep.js';
import {lerp} from '@woosh/meep-engine/src/core/math/lerp.js';
import {euclidean_modulo} from '@woosh/meep-engine/src/core/math/euclidean_modulo.js';

const nightFill=[.10,.16,.24];
function celestial(hour){
  const angle=(hour-6)/24*Math.PI*2,elevation=Math.sin(angle),day=Math.max(0,elevation),night=Math.max(0,-elevation),side=elevation>=0?1:-1;
  const warm=smoothStep(0,1,(elevation+.1)/.2),moon=[.40,.57,.86],sun=[1,.66+day*.23,.36+day*.41];
  return {day,night,nightBlend:smoothStep(0,1,(.18-elevation)/.36),direction:[Math.cos(angle)*side,Math.max(.06,Math.abs(elevation)),.35*side],color:moon.map((v,i)=>lerp(v,sun[i],warm)),intensity:(.12+day*3.6+night*.72)*smoothStep(0,1,Math.abs(elevation)/.08)};
}

/** Meep's Hosek atmosphere supplies the HDR background and environment light.
 * A sun and opposing moon follow the world clock; 64 cached skies bound memory. */
export class WorldSky {
  constructor(){this.levels=new Map();this.last=-1;}
  async prepare(){
    // Bake the small, bounded cycle while the loading screen is present. A sky
    // change during walking should only select a texture, never run Hosek loops.
    for(let level=0;level<64;level++){this.texture(level);if(level%4===3)await new Promise(resolve=>setTimeout(resolve,0));}
  }
  update(scene,hour){
    const light=celestial(hour),level=euclidean_modulo(Math.round(hour/24*64),64);
    if(level===this.last)return light;this.last=level;
    scene.lights.environment=this.texture(level);return light;
  }
  texture(level){
    let texture=this.levels.get(level);
    if(!texture){
      const {day,night,nightBlend,direction:source}=celestial(level/64*24);
      // Twilight skylight remains after the directional source meets the
      // horizon. Keep that diffuse fill independent of the moon's elevation.
      const sample=make_sky_hosek([source[0],Math.max(.3,source[1]),source[2]],2.4,.04,[.22,.24,.16]);
      const octahedral=Sampler2D.float32(4,256,256),direction=new Float32Array(3),brightness=.22+day*.62+night*.07,tint=[1-nightBlend*.66,1-nightBlend*.50,1-nightBlend*.18];
      // Sample in the renderer's direction convention directly. The Hosek
      // equirectangular helper has a different pole/longitude convention.
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){
        const offset=(y*256+x)*4;octahedral_uv_to_direction(direction,(x+.5)/256,(y+.5)/256);
        sample(octahedral.data,offset,direction,0);
        for(let c=0;c<3;c++)octahedral.data[offset+c]=octahedral.data[offset+c]*brightness*tint[c]+nightFill[c]*nightBlend;
        octahedral.data[offset+3]=1;
      }
      texture=ShadeTexture.from(ShadeImage.fromSampler2D(sampler2d_to_f16(octahedral)));this.levels.set(level,texture);
    }
    return texture;
  }
}
