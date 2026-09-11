import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {Cache} from '@woosh/meep-engine/src/core/cache/Cache.js';
import {computeStringHash} from '@woosh/meep-engine/src/core/primitives/strings/computeStringHash.js';
import {strictEquals} from '@woosh/meep-engine/src/core/function/strictEquals.js';
import {NavigationMesh} from '@woosh/meep-engine/src/engine/navigation/mesh/NavigationMesh.js';
import {bt_mesh_from_indexed_geometry} from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/io/bt_mesh_from_indexed_geometry.js';
import {bt_mesh_build_face_bvh} from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/query/bt_mesh_build_face_bvh.js';
import {WORLD_VERSION} from './regions.mjs';
import {SpatialAtlas} from './spatial-atlas.mjs';
import {decodeDungeonNavigation,withDungeonNavigation} from './dungeon-navigation.mjs';

export function encodeNavigation(atlas){
  const b=new BinaryBuffer(),{positions,indices}=atlas.geometry;
  b.writeUint32(1);b.writeUint32(WORLD_VERSION);b.writeFloat32(atlas.spacing);
  b.writeUint32(positions.length);b.writeUint32(indices.length);
  b.writeFloat32Array(positions,0,positions.length);b.writeUint32Array(indices,0,indices.length);
  return new Uint8Array(b.data,0,b.position);
}

export function decodeNavigation(bytes,{maxTiles=32}={}){
  if(!Number.isInteger(maxTiles)||maxTiles<1)throw new Error('Invalid navigation cache budget');
  const b=new BinaryBuffer();b.fromArrayBuffer(bytes);
  if(b.readUint32()!==1||b.readUint32()!==WORLD_VERSION)throw new Error('Navigation needs rebuilding for this world version');
  const spacing=b.readFloat32(),vertexValues=b.readUint32(),indexValues=b.readUint32();
  if(vertexValues%3||indexValues%3||vertexValues+indexValues>2000000||20+4*(vertexValues+indexValues)!==bytes.byteLength)throw new Error('Malformed navigation geometry');
  const positions=new Float32Array(vertexValues),indices=new Uint32Array(indexValues);
  b.readFloat32Array(positions,0,vertexValues);b.readUint32Array(indices,0,indexValues);
  if(!positions.every(Number.isFinite)||!indices.every(i=>i<vertexValues/3))throw new Error('Malformed navigation vertices');
  const tiles=new Cache({maxWeight:maxTiles,keyHashFunction:computeStringHash,keyEqualityFunction:strictEquals});
  return {spacing,faceCount:indexValues/3,cacheStats:()=>({tiles:tiles.size(),maxTiles}),tile(home){
    const x=Math.floor(home[0]/40)*40,z=Math.floor(home[2]/40)*40,key=`${x},${z}`;
    const cached=tiles.get(key);if(cached!==null)return cached;
    const bounds=[x-32,z-32,x+72,z+72],vertices=[],faces=[],mapping=new Map();
    for(let i=0;i<indices.length;i+=3){
      const corners=[indices[i],indices[i+1],indices[i+2]];
      if(!corners.every(j=>positions[j*3]>=bounds[0]&&positions[j*3]<=bounds[2]&&positions[j*3+2]>=bounds[1]&&positions[j*3+2]<=bounds[3]))continue;
      for(const j of corners){if(!mapping.has(j)){mapping.set(j,vertices.length/3);vertices.push(...positions.subarray(j*3,j*3+3));}faces.push(mapping.get(j));}
    }
    const atlas=new SpatialAtlas(null,{bounds,spacing});atlas.nav=new NavigationMesh();
    bt_mesh_from_indexed_geometry(atlas.nav.topology,faces,vertices);bt_mesh_build_face_bvh(atlas.nav.bvh,atlas.nav.topology);atlas.faceCount=faces.length/3;
    tiles.put(key,atlas);return atlas;
  }};
}

let prepared;
export function loadNavigation(){
  return prepared??=(async()=>{
    const read=async url=>{
      if(url.protocol==='file:'){const {readFile}=await import('node:fs/promises'),data=await readFile(url);return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);}
      const response=await fetch(url);if(!response.ok)throw new Error('Could not load world navigation');return response.arrayBuffer();
    };
    const [ground,dungeons]=await Promise.all([read(new URL('../content/navigation.bin',import.meta.url)),read(new URL('../content/dungeon-navigation.bin',import.meta.url))]);
    return withDungeonNavigation(decodeNavigation(ground),decodeDungeonNavigation(dungeons));
  })();
}
