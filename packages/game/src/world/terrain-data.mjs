import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {serializeTexture,deserializeTexture} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/serialization/TextureBinaryBufferSerializer.js';
import {WORLD_VERSION,WORLD_BOUNDS} from './world-definition.mjs';

// One description of the baked height grid: two metres between samples, with a
// sample on both edges of WORLD_BOUNDS. Sampling and authoring share it.
export const TERRAIN_GRID=Object.freeze({spacing:2,cols:WORLD_BOUNDS.width/2+1,rows:WORLD_BOUNDS.depth/2+1});
const cols=TERRAIN_GRID.cols,rows=TERRAIN_GRID.rows,count=cols*rows;

// Native texture serialization preserves the float32 sampler and vertex grid.
export function encodeTerrain({sampler,vertices}){
  if(sampler.width!==cols||sampler.height!==rows||sampler.itemSize!==1||sampler.data.length!==count||vertices.length!==count)throw new Error('Invalid terrain dimensions');
  const b=new BinaryBuffer();b.writeUint32(1);b.writeUint32(WORLD_VERSION);
  // The native writer serializes the backing buffer from zero; owning copies
  // also handle authoring callers that supply a typed-array subview.
  serializeTexture(b,new Sampler2D(new Float32Array(sampler.data),1,cols,rows));
  serializeTexture(b,new Sampler2D(new Float32Array(vertices),1,cols,rows));
  return new Uint8Array(b.data,0,b.position);
}

export function decodeTerrain(bytes) {
  const buffer = new BinaryBuffer();
  buffer.fromArrayBuffer(bytes);
  if (buffer.readUint32() !== 1 || buffer.readUint32() !== WORLD_VERSION) {
    throw new Error('Terrain needs rebuilding for this world version');
  }
  const sampler = deserializeTexture(buffer);
  const vertices = deserializeTexture(buffer).data;
  return {sampler, vertices};
}

let prepared;
export function loadTerrain(){
  return prepared??=(async()=>{
    const url=new URL('../content/terrain.bin',import.meta.url);
    if(url.protocol==='file:'){
      const {readFile}=await import('node:fs/promises'),data=await readFile(url);
      return decodeTerrain(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
    }
    const response=await fetch(url);if(!response.ok)throw new Error('Could not load world terrain');
    return decodeTerrain(await response.arrayBuffer());
  })().catch(error=>{prepared=undefined;throw error;});
}
