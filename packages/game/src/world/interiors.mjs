import {line3_compute_segment_closest_point_t} from '@woosh/meep-engine/src/core/geom/3d/line/line3_compute_segment_closest_point_t.js';
import {lerp} from '@woosh/meep-engine/src/core/math/lerp.js';

// Sections describe an above-ground rock vault in world metres: X, Z, clear
// half-width, clear height. Blender samples the shared terrain beneath it.
export const CAVES=[{
  id:'bellkeeper',model:'bellkeeperHollow',
  sections:[[38,-9,3.8,4.7],[39,-14,4.2,5.3],[40,-19,5.2,6.0],[40.5,-24,6.2,6.8],[40,-29,5.4,6.2],[39,-34,4.3,5.2],[38,-40,3.9,4.7]],
  lights:[[36,-13],[43.5,-22],[37.5,-30.8],[40,-36]],
  tombs:[[35.9,-23,.1],[45.0,-25,-.12],[35.7,-28,.12]],
  keeper:[41,-27],
}];

export function inCaveFootprint(x,z,margin=0){
  return CAVES.some(cave=>cave.sections.slice(1).some((b,i)=>{
    const a=cave.sections[i],t=line3_compute_segment_closest_point_t(a[0],0,a[1],b[0],0,b[1],x,0,z);
    return Math.hypot(x-lerp(a[0],b[0],t),z-lerp(a[1],b[1],t))<lerp(a[2],b[2],t)+margin;
  }));
}
