import {WorldGroundMaterial} from './ground-material.mjs';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';
import {WORLD_BOUNDS} from '@old-circle/game/world/regions.mjs';

const surfaceLayers={meadow:'grass',wood:'grass',desert:'sand',magic:'stone',tundra:'snow',crown:'stone',road:'gravel'};

async function pixels(url){
  const response=await fetch(url);if(!response.ok)throw new Error(`Missing terrain image: ${url}`);
  const bitmap=await createImageBitmap(await response.blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');
  context.drawImage(bitmap,0,0);const data=context.getImageData(0,0,bitmap.width,bitmap.height).data;bitmap.close();return data;
}
/** Meep's terrain material, shared by the native meshes authored in Blender. */
export class WorldGround {
  constructor(){this.material=new WorldGroundMaterial();}
  async start(){
    const base='/assets/terrain/',m=await fetch(base+'manifest.json').then(r=>r.json());
    const images=await Promise.all(m.layers.map(name=>pixels(base+name+'.png'))),masks=await Promise.all([0,1,2].map(i=>pixels(base+`weights-${i}.png`)));
    const count=m.layers.length,area=m.width*m.height,weights=new Uint8Array(area*count),layers=new Uint8Array(m.layerSize*m.layerSize*4*count);
    for(let layer=0;layer<count;layer++){
      layers.set(images[layer],layer*images[layer].length);
      for(let i=0;i<area;i++)weights[layer*area+i]=masks[Math.floor(layer/3)][i*4+layer%3];
    }
    this.manifest=m;this.weightSamplers=m.layers.map((_,i)=>new Sampler2D(weights.subarray(i*area,(i+1)*area),1,m.width,m.height));
    const {minX,minZ,width,depth}=WORLD_BOUNDS;
    Object.assign(this.material,{layer_scales:Float32Array.from(m.tileMetres.flatMap(size=>[width/size,depth/size])),layer_scales_version:1,layer_count:count,
      inv_world_size:Float32Array.from([1/width,1/depth]),grid_transform:Float32Array.from([width,depth,minX,minZ]),grid_resolution:Float32Array.from([1,1]),
      weights:{data:weights,width:m.width,height:m.height,depth:count,version:1},
      layers:{data:layers,width:m.layerSize,height:m.layerSize,depth:count,version:1},
      overlay:Sampler2D.uint8(4,1,1),sprite:Sampler2D.uint8(4,1,1)});
    this.material.needsUpdate=true;
  }
  surfaceMixAt(x,z){
    const m=this.manifest,b=WORLD_BOUNDS,u=clamp((x-b.minX)/b.width*m.width-.5,0,m.width-1),v=clamp((z-b.minZ)/b.depth*m.height-.5,0,m.height-1);
    const weights=new Map();let total=0;
    for(let i=0;i<this.weightSamplers.length;i++){
      const layer=m.layers[i];if(!Object.hasOwn(surfaceLayers,layer))continue;
      const weight=this.weightSamplers[i].sampleChannelBilinear(u,v,0);if(!Number.isFinite(weight)||weight<=0)continue;
      const surface=surfaceLayers[layer];weights.set(surface,(weights.get(surface)??0)+weight);total+=weight;
    }
    if(!total)return [{surface:'stone',weight:1}];
    // Merge biome aliases before ranking; equal shares use a fixed material order.
    const ranked=[...weights].map(([surface,weight])=>({surface,weight})).sort((a,b)=>b.weight-a.weight||(a.surface<b.surface?-1:a.surface>b.surface?1:0));
    if(ranked[0].weight/total>.66)return [{surface:ranked[0].surface,weight:1}];
    const selected=ranked.slice(0,2),sum=selected.reduce((value,entry)=>value+entry.weight,0);
    return selected.map(({surface,weight})=>({surface,weight:weight/sum}));
  }
  surfaceAt(x,z){return this.surfaceMixAt(x,z)[0].surface;}
}
