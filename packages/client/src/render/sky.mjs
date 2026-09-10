import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {sampler2d_to_f16} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/sampler2d_to_f16.js';
import {sampler2d_from_image_bitmap} from '@woosh/meep-engine/src/shade/renderer/scene/optimization/sampler2d_from_image_bitmap.js';
import {resample_equirectangular_to_octahedral} from '@woosh/meep-engine/src/shade/renderer/light/environment/resample_equirectangular_to_octahedral.js';
import {ShadeImage} from '@woosh/meep-engine/src/shade/renderer/texture/source/ShadeImage.js';
import {ShadeTexture} from '@woosh/meep-engine/src/shade/renderer/texture/ShadeTexture.js';

/** Blender panorama → Meep octahedral HDR environment. Native background and
 * indirect lighting share it. A bounded cache avoids allocating textures per frame. */
export class WorldSky {
  constructor(bitmap){
    const bytes=sampler2d_from_image_bitmap(bitmap),linear=Sampler2D.float32(4,bytes.width,bytes.height);
    for(let i=0;i<bytes.data.length;i++){const c=bytes.data[i]/255;linear.data[i]=i%4===3?1:c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}
    this.base=resample_equirectangular_to_octahedral(linear,128);this.levels=new Map();this.last=-1;
  }
  update(scene,daylight){
    const level=Math.round(daylight*31);if(level===this.last)return;this.last=level;
    let texture=this.levels.get(level);
    if(!texture){
      const sampler=Sampler2D.float32(4,128,128),day=level/31;
      for(let i=0;i<sampler.data.length;i++)sampler.data[i]=i%4===3?1:this.base.data[i]*(.55+day*2)*(i%4===2?1.15:1);
      texture=ShadeTexture.from(ShadeImage.fromSampler2D(sampler2d_to_f16(sampler)));this.levels.set(level,texture);
    }
    scene.lights.environment=texture;
  }
}
