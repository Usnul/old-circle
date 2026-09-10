import {HeightMapShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/HeightMapShape3D.js';
import {ConvexHullShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/ConvexHullShape3D.js';
import collisionAssets from '../content/colliders.json' with {type:'json'};
import {terrainSurface,WORLD_BOUNDS} from './regions.mjs';

// One authored source for physics bodies and acoustic occluders. Scale and yaw
// live in the hull, leaving the shape transform rigid for both native indexes.
export function* staticGeometry(layout){
  const {sampler}=terrainSurface(),{minX,minZ,width,depth}=WORLD_BOUNDS;
  yield {model:'terrain',position:[minX+width/2,-15,minZ+depth/2],shape:HeightMapShape3D.from(sampler,width,sampler.data.reduce((h,v)=>Math.max(h,v),0)+1,depth)};
  for(const prop of layout.props)for(const part of collisionAssets[prop.model]??[]){
    const vertices=new Float32Array(part.vertices.length),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<vertices.length;i+=3){
      const x=part.vertices[i]*prop.scale[0],y=part.vertices[i+1]*prop.scale[1],z=part.vertices[i+2]*prop.scale[2];
      vertices[i]=Math.cos(prop.yaw)*x+Math.sin(prop.yaw)*z;vertices[i+1]=y;vertices[i+2]=-Math.sin(prop.yaw)*x+Math.cos(prop.yaw)*z;
      for(let j=0;j<3;j++){min[j]=Math.min(min[j],vertices[i+j]+prop.position[j]);max[j]=Math.max(max[j],vertices[i+j]+prop.position[j]);}
    }
    const position=min.map((v,j)=>(v+max[j])/2);
    for(let i=0;i<vertices.length;i++)vertices[i]-=position[i%3]-prop.position[i%3];
    yield {model:prop.model,position,size:min.map((v,j)=>max[j]-v),shape:ConvexHullShape3D.from(vertices,new Uint32Array(part.indices))};
  }
}
