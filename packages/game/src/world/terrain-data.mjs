import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {serializeTexture,deserializeTexture} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/serialization/TextureBinaryBufferSerializer.js';
import {WORLD_VERSION,WORLD_BOUNDS} from './world-definition.mjs';

const cols=WORLD_BOUNDS.width/2+1,rows=WORLD_BOUNDS.depth/2+1,count=cols*rows;
const headerBytes=8,textureHeaderBytes=10,byteLength=headerBytes+textureHeaderBytes*2+count*8;

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

export function decodeTerrain(bytes){
  if(bytes.byteLength!==byteLength)throw new Error('Malformed terrain data');
  const b=new BinaryBuffer();b.fromArrayBuffer(bytes);
  if(b.readUint32()!==1||b.readUint32()!==WORLD_VERSION)throw new Error('Terrain needs rebuilding for this world version');
  const read=()=>{
    // Validate dimensions before the native decoder allocates its data array.
    const start=b.position;
    if(b.readUint32()!==cols||b.readUint32()!==rows||b.readUint8()!==1)throw new Error('Invalid terrain dimensions');
    b.position=start;const sampler=deserializeTexture(b);
    if(!(sampler.data instanceof Float32Array)||!sampler.data.every(Number.isFinite))throw new Error('Invalid terrain heights');
    return sampler;
  };
  const sampler=read(),vertices=read().data;
  if(b.position!==bytes.byteLength)throw new Error('Malformed terrain data');
  return {sampler,vertices};
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
