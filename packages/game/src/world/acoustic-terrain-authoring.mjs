import {BVH} from '@woosh/meep-engine/src/core/bvh2/bvh3/BVH.js';
import {ebvh_build_for_geometry_morton} from '@woosh/meep-engine/src/core/bvh2/bvh3/ebvh_build_for_geometry_morton.js';
import {MeshShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/MeshShape3D.js';
import {terrainSurface,WORLD_BOUNDS} from './regions.mjs';
import {encodeAcousticTerrainSurface} from './acoustic-terrain-data.mjs';

export function buildAcousticTerrainSurface({vertices,cols,rows,width,depth,offset=15}){
  const mesh=new MeshShape3D();mesh.positions=new Float32Array(cols*rows*3);mesh.indices=new Uint32Array((cols-1)*(rows-1)*6);let k=0;
  for(let z=0;z<rows;z++)for(let x=0;x<cols;x++){
    const i=z*cols+x;mesh.positions.set([x*width/(cols-1)-width/2,vertices[i]+offset,z*depth/(rows-1)-depth/2],i*3);
    if(x<cols-1&&z<rows-1){mesh.indices.set([i,i+cols,i+1,i+1,i+cols,i+cols+1],k);k+=6;}
  }
  mesh.recompute_cached();const tree=new BVH();ebvh_build_for_geometry_morton(tree,mesh.indices,mesh.positions);mesh.__raycast_blas=tree;
  return mesh;
}

export function bakeAcousticTerrain(){
  const {width,depth}=WORLD_BOUNDS;
  return encodeAcousticTerrainSurface(buildAcousticTerrainSurface({vertices:terrainSurface().vertices,cols:width/2+1,rows:depth/2+1,width,depth}));
}
