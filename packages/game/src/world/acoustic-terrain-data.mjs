import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {BinaryClassSerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/storage/binary/BinaryClassSerializationAdapter.js';
import {BinaryObjectSerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/storage/binary/object/BinaryObjectSerializationAdapter.js';
import {BinarySerializationRegistry} from '@woosh/meep-engine/src/engine/ecs/storage/binary/BinarySerializationRegistry.js';
import {BVH,ELEMENT_WORD_COUNT} from '@woosh/meep-engine/src/core/bvh2/bvh3/BVH.js';
import {MeshShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/MeshShape3D.js';
import {AABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/AABB3.js';
import {serializeAABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/serializeAABB3.js';
import {deserializeAABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/deserializeAABB3.js';
import enginePackage from '@woosh/meep-engine/package.json' with {type:'json'};
import {WORLD_VERSION} from './world-definition.mjs';

const assetType='OldCircle.AcousticTerrainSurface';

// Meep has no MeshShape3D adapter yet. This narrow acoustic surface adapter
// stores its native arrays and BVH through the documented raw-data contract.
// __raycast_blas is the native mesh's private lazy cache: restoring it avoids
// the first-ray rebuild. Pin the engine version and test this compatibility
// boundary; every intersection and normal still uses MeshShape3D.raycast.
export class AcousticTerrainSurfaceSerializationAdapter extends BinaryClassSerializationAdapter {
  klass=MeshShape3D;
  version=0;
  serialize(buffer,mesh){
    if(mesh.tet_mesh.count!==0||!mesh.__raycast_blas)throw new Error('Expected a baked acoustic surface');
    buffer.writeUint32(mesh.positions.length);buffer.writeFloat32Array(mesh.positions,0,mesh.positions.length);
    buffer.writeUint32(mesh.indices.length);buffer.writeUint32Array(mesh.indices,0,mesh.indices.length);
    serializeAABB3(buffer,new AABB3(...mesh.__bbox));buffer.writeFloat64(mesh.surface_area);
    const tree=mesh.__raycast_blas,bytes=tree.size*ELEMENT_WORD_COUNT*4;
    buffer.writeUint32(ELEMENT_WORD_COUNT);buffer.writeUint32(tree.size);buffer.writeUint32(tree.root);
    buffer.writeBytes(new Uint8Array(tree.data_buffer,0,bytes),0,bytes);
  }
  deserialize(buffer,mesh){
    const positions=buffer.readUint32();
    if(positions%3||positions>2000000||buffer.position+positions*4>buffer.capacity)throw new Error('Malformed acoustic terrain vertices');
    mesh.positions=new Float32Array(positions);buffer.readFloat32Array(mesh.positions,0,positions);
    const indices=buffer.readUint32();
    if(indices%3||indices>2000000||buffer.position+indices*4>buffer.capacity)throw new Error('Malformed acoustic terrain indices');
    mesh.indices=new Uint32Array(indices);buffer.readUint32Array(mesh.indices,0,indices);
    const bounds=new AABB3();deserializeAABB3(buffer,bounds);mesh.__bbox.set([...bounds]);mesh.__surface_area=buffer.readFloat64();
    const stride=buffer.readUint32(),nodes=buffer.readUint32(),root=buffer.readUint32();
    if(stride!==ELEMENT_WORD_COUNT||nodes!==indices/3*2-1||root>=nodes||buffer.position+nodes*stride*4>buffer.capacity)throw new Error('Malformed acoustic terrain BVH');
    const bytes=new Uint8Array(nodes*stride*4);buffer.readBytes(bytes,0,bytes.length);
    const tree=new BVH();tree.data_buffer=bytes.buffer;tree.allocate_linear(nodes);tree.root=root;
    mesh.__raycast_blas=tree;
    if(!mesh.positions.every(Number.isFinite)||!mesh.indices.every(index=>index<positions/3))throw new Error('Invalid acoustic terrain geometry');
  }
}

function objectAdapter(){
  const registry=new BinarySerializationRegistry();registry.registerAdapter(new AcousticTerrainSurfaceSerializationAdapter(),assetType);
  const adapter=new BinaryObjectSerializationAdapter();adapter.initialize(registry);return adapter;
}

export function encodeAcousticTerrainSurface(mesh){
  const buffer=new BinaryBuffer();buffer.writeUint32(WORLD_VERSION);buffer.writeUTF8String(enginePackage.version);
  objectAdapter().serialize(buffer,mesh,assetType);return new Uint8Array(buffer.data,0,buffer.position);
}

export function decodeAcousticTerrainSurface(bytes){
  const buffer=new BinaryBuffer();buffer.fromArrayBuffer(bytes);
  if(buffer.readUint32()!==WORLD_VERSION||buffer.readUTF8String()!==enginePackage.version)throw new Error('Acoustic terrain needs rebuilding for this world and engine version');
  const mesh=objectAdapter().deserialize(buffer);
  if(buffer.position!==bytes.byteLength)throw new Error('Malformed acoustic terrain asset');
  return mesh;
}

let prepared;
export function loadAcousticTerrainSurface(){
  return prepared??=(async()=>{
    const url=new URL('../content/acoustic-terrain.bin',import.meta.url);
    if(url.protocol==='file:'){
      const {readFile}=await import('node:fs/promises'),data=await readFile(url);
      return decodeAcousticTerrainSurface(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
    }
    const response=await fetch(url);if(!response.ok)throw new Error('Could not load acoustic terrain');
    return decodeAcousticTerrainSurface(await response.arrayBuffer());
  })().catch(error=>{prepared=undefined;throw error;});
}
