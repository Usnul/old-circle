import {line2_compute_segment_point_distance_sqr} from '@woosh/meep-engine/src/core/geom/2d/line/line2_compute_segment_point_distance_sqr.js';
import {ROAD_PATHS} from './world-definition.mjs';

export function pathDistance(x, z) {
  let best = Infinity;
  for(const road of ROAD_PATHS)for(let i=1;i<road.points.length;i++){
    const p=road.points[i-1],q=road.points[i];
    best=Math.min(best,line2_compute_segment_point_distance_sqr(p[0],p[1],q[0],q[1],x,z));
  }
  return Math.sqrt(best);
}
