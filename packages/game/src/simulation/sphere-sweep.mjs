import { SphereShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/SphereShape3D.js';

const rotation=[0,0,0,1];
// Sweeps are called per weapon segment and per projectile every tick and never
// nest, so one shared Meep query shape serves them all without per-call allocation.
const sphere=SphereShape3D.from(1);
export function sphereSweep(physics,ray,radius,result,filter=()=>true){
  sphere.radius=radius;
  return physics.shapeCast(ray,sphere,rotation,result,filter);
}
