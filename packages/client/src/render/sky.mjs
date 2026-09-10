import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {sampler2d_to_f16} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/sampler2d_to_f16.js';
import {make_sky_hosek} from '@woosh/meep-engine/src/engine/graphics/sh3/path_tracer/make_sky_hosek.js';
import {octahedral_uv_to_direction} from '@woosh/meep-engine/src/shade/renderer/light/environment/octahedral_uv_to_direction.js';
import {ShadeImage} from '@woosh/meep-engine/src/shade/renderer/texture/source/ShadeImage.js';
import {ShadeTexture} from '@woosh/meep-engine/src/shade/renderer/texture/ShadeTexture.js';

/** Meep's Hosek atmosphere supplies the HDR background and environment light.
 * Quantized solar elevation bounds cache size and avoids rebuilding every frame. */
export class WorldSky {
  constructor(){this.levels=new Map();this.last=-1;}
  update(scene,daylight){
    const level=Math.round(daylight*31);if(level===this.last)return;this.last=level;
    let texture=this.levels.get(level);
    if(!texture){
      const day=level/31,sample=make_sky_hosek([.6,Math.max(.08,day),.45],2.4,.04,[.22,.24,.16]);
      const octahedral=Sampler2D.float32(4,256,256),direction=new Float32Array(3),brightness=.09+day*.75;
      // Sample in the renderer's direction convention directly. The Hosek
      // equirectangular helper has a different pole/longitude convention.
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){
        const offset=(y*256+x)*4;octahedral_uv_to_direction(direction,(x+.5)/256,(y+.5)/256);
        sample(octahedral.data,offset,direction,0);
        for(let c=0;c<3;c++)octahedral.data[offset+c]*=brightness;
        octahedral.data[offset+3]=1;
      }
      texture=ShadeTexture.from(ShadeImage.fromSampler2D(sampler2d_to_f16(octahedral)));this.levels.set(level,texture);
    }
    scene.lights.environment=texture;
  }
}
