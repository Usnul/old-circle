import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {NavigationMesh} from '@woosh/meep-engine/src/engine/navigation/mesh/NavigationMesh.js';
import {bt_mesh_from_indexed_geometry} from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/io/bt_mesh_from_indexed_geometry.js';
import {bt_mesh_build_face_bvh} from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/query/bt_mesh_build_face_bvh.js';
import {WORLD_VERSION} from './regions.mjs';
import {SpatialAtlas} from './spatial-atlas.mjs';

export function encodeNavigation(atlas){
  const b=new BinaryBuffer(),{positions,indices}=atlas.geometry;
  b.writeUint32(1);b.writeUint32(WORLD_VERSION);b.writeFloat32(atlas.spacing);
  b.writeUint32(positions.length);b.writeUint32(indices.length);
  b.writeFloat32Array(positions,0,positions.length);b.writeUint32Array(indices,0,indices.length);
  return new Uint8Array(b.data,0,b.position);
}

export function decodeNavigation(bytes){
  const b=new BinaryBuffer();b.fromArrayBuffer(bytes);
  if(b.readUint32()!==1||b.readUint32()!==WORLD_VERSION)throw new Error('Navigation needs rebuilding for this world version');
  const spacing=b.readFloat32(),vertexValues=b.readUint32(),indexValues=b.readUint32();
  if(vertexValues%3||indexValues%3||vertexValues+indexValues>2000000||20+4*(vertexValues+indexValues)!==bytes.byteLength)throw new Error('Malformed navigation geometry');
  const positions=new Float32Array(vertexValues),indices=new Uint32Array(indexValues);
  b.readFloat32Array(positions,0,vertexValues);b.readUint32Array(indices,0,indexValues);
  if(!positions.every(Number.isFinite)||!indices.every(i=>i<vertexValues/3))throw new Error('Malformed navigation vertices');
  const tiles=new Map();
  return {spacing,faceCount:indexValues/3,tile(home){
    const x=Math.floor(home[0]/40)*40,z=Math.floor(home[2]/40)*40,key=`${x},${z}`;
    if(tiles.has(key))return tiles.get(key);
    const bounds=[x-32,z-32,x+72,z+72],vertices=[],faces=[],mapping=new Map();
    for(let i=0;i<indices.length;i+=3){
      const corners=[indices[i],indices[i+1],indices[i+2]];
      if(!corners.every(j=>positions[j*3]>=bounds[0]&&positions[j*3]<=bounds[2]&&positions[j*3+2]>=bounds[1]&&positions[j*3+2]<=bounds[3]))continue;
      for(const j of corners){if(!mapping.has(j)){mapping.set(j,vertices.length/3);vertices.push(...positions.subarray(j*3,j*3+3));}faces.push(mapping.get(j));}
    }
    const atlas=new SpatialAtlas(null,{bounds,spacing});atlas.nav=new NavigationMesh();
    bt_mesh_from_indexed_geometry(atlas.nav.topology,faces,vertices);bt_mesh_build_face_bvh(atlas.nav.bvh,atlas.nav.topology);atlas.faceCount=faces.length/3;
    tiles.set(key,atlas);return atlas;
  }};
}

let prepared;
export function loadNavigation(){
  return prepared??=(async()=>{
    const url=new URL('../content/navigation.bin',import.meta.url);
    let bytes;
    if(url.protocol==='file:'){
      const {readFile}=await import('node:fs/promises'),data=await readFile(url);bytes=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
    }else{const response=await fetch(url);if(!response.ok)throw new Error('Could not load world navigation');bytes=await response.arrayBuffer();}
    return decodeNavigation(bytes);
  })();
}
