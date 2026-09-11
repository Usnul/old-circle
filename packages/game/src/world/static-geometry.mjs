import {HeightMapShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/HeightMapShape3D.js';
import {ConvexHullShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/ConvexHullShape3D.js';
import {v3_matrix4_multiply} from '@woosh/meep-engine/src/core/geom/vec3/v3_matrix4_multiply.js';
import {aabb3_from_v3_array} from '@woosh/meep-engine/src/core/geom/3d/aabb/aabb3_from_v3_array.js';
import {bakedPropTransform} from './prop-transform.mjs';
import collisionAssets from '../content/colliders.json' with {type:'json'};
import {terrainSurface,WORLD_BOUNDS} from './regions.mjs';

// One authored source for physics bodies and acoustic occluders. Scale and yaw
// live in the hull, leaving the shape transform rigid for both native indexes.
export function* staticGeometry(layout){
  const {sampler}=terrainSurface(),{minX,minZ,width,depth}=WORLD_BOUNDS;
  yield {model:'terrain',position:[minX+width/2,-15,minZ+depth/2],shape:HeightMapShape3D.from(sampler,width,sampler.data.reduce((h,v)=>Math.max(h,v),0)+1,depth)};
  for(const prop of layout.props)for(const part of collisionAssets[prop.model]??[]){
    const vertices=new Float32Array(part.vertices.length),bounds=new Float64Array(6),transform=bakedPropTransform(prop);
    // The renderer loads this native packed rotation. Bake collision at the
    // same precision so long walls do not disagree with their visible meshes.
    transform.setTranslation(0,0,0);
    for(let i=0;i<vertices.length;i+=3)v3_matrix4_multiply(vertices,i,part.vertices,i,transform.matrix);
    aabb3_from_v3_array(bounds,vertices,vertices.length);
    const center=[0,1,2].map(j=>(bounds[j]+bounds[j+3])/2),position=center.map((v,j)=>v+prop.position[j]);
    for(let i=0;i<vertices.length;i++)vertices[i]-=center[i%3];
    yield {model:prop.model,position,size:[0,1,2].map(j=>bounds[j+3]-bounds[j]),shape:ConvexHullShape3D.from(vertices,new Uint32Array(part.indices))};
  }
}
