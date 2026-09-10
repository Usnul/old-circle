import { SphereShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/SphereShape3D.js';
import { Ray3 } from '@woosh/meep-engine/src/core/geom/3d/ray/Ray3.js';
import { PhysicsSurfacePoint } from '@woosh/meep-engine/src/engine/physics/queries/PhysicsSurfacePoint.js';

const rotation=[0,0,0,1];
/** Meep 3.20 workaround; see MEEP_DEFECTS.md. Convex targets receive a true
 * sphere sweep. Concave targets receive seven parallel surface rays, an
 * approximation to sphere thickness which still tests the full travel interval. */
export function sphereSweep(physics,ray,radius,result,filter=()=>true){
  let found=physics.shapeCast(ray,SphereShape3D.from(radius),rotation,result,(e,c)=>c.shape.is_convex!==false&&filter(e,c));
  let nearest=found?result.t:ray.tMax;
  const probe=new Ray3(),hit=new PhysicsSurfacePoint();
  for(const offset of [[0,0,0],[radius,0,0],[-radius,0,0],[0,radius,0],[0,-radius,0],[0,0,radius],[0,0,-radius]]){
    probe.set(ray);for(let i=0;i<3;i++)probe[i]+=offset[i];probe.tMax=nearest;
    if(physics.raycast(probe,hit,(e,c)=>c.shape.is_convex===false&&filter(e,c))&&hit.t<=nearest){
      nearest=hit.t;found=true;result.entity=hit.entity;result.body_id=hit.body_id;result.t=hit.t;
      for(let i=0;i<3;i++){result.position[i]=hit.position[i];result.normal[i]=hit.normal[i];}
    }
  }
  return found;
}
