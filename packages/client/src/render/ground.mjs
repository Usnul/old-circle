import {TerrainExtension} from '@woosh/meep-engine/src/engine/graphics3/TerrainSystem.js';
import {GPUTerrainSplatRenderer} from '@woosh/meep-engine/src/engine/graphics3/terrain/GPUTerrainSplatRenderer.js';
import {pack_terrain_row_table} from '@woosh/meep-engine/src/engine/graphics3/terrain/pack_terrain_row_table.js';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';

async function pixels(url){
  const response=await fetch(url);if(!response.ok)throw new Error(`Missing terrain image: ${url}`);
  const bitmap=await createImageBitmap(await response.blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');
  context.drawImage(bitmap,0,0);const data=context.getImageData(0,0,bitmap.width,bitmap.height).data;bitmap.close();return data;
}
/** Meep's terrain texturing pass, applied to the native meshes authored in Blender. */
export class WorldGround {
  async start(graphics,meshes){
    this.meshes=meshes;this.rows=new Uint32Array(0);this.pass=new GPUTerrainSplatRenderer();
    const base='/assets/terrain/',m=await fetch(base+'manifest.json').then(r=>r.json());
    const images=await Promise.all(m.layers.map(name=>pixels(base+name+'.png'))),masks=await Promise.all([0,1,2].map(i=>pixels(base+`weights-${i}.png`)));
    const count=m.layers.length,area=m.width*m.height,weights=new Uint8Array(area*count),layers=new Uint8Array(m.layerSize*m.layerSize*4*count);
    for(let layer=0;layer<count;layer++){
      layers.set(images[layer],layer*images[layer].length);
      for(let i=0;i<area;i++)weights[layer*area+i]=masks[Math.floor(layer/3)][i*4+layer%3];
    }
    const transform=Float32Array.from([1,0,0,0,0,1,0,0,0,0,1,0,240,0,480,1]);
    this.data={scales:Float32Array.from(m.tileMetres.flatMap(size=>[480/size,640/size])),layer_count:count,world_to_terrain:transform,
      inv_world_size:[1/480,1/640],grid_transform:[480,640,0,0],grid_resolution:[1,1],
      weights:{data:weights,width:m.width,height:m.height,depth:count,version:1},
      layer_image:{data:layers,width:m.layerSize,height:m.layerSize,depth:count,version:1},
      overlay:Sampler2D.uint8(4,1,1),sprite:Sampler2D.uint8(4,1,1)};
    this.extension=graphics.add_extension(new TerrainExtension(this));
  }
  record(frame){
    const packed=pack_terrain_row_table({meshes:this.meshes,scene:frame.view.scene,table:this.rows});this.rows=packed.table;
    if(packed.size)this.pass.graph_draw({...this.data,frame,rows:this.rows,row_count:packed.size});
  }
}
