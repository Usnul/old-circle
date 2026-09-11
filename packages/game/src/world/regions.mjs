import {REGIONS,LANDMARKS} from './world-definition.mjs';
import {loadTerrain} from './terrain-data.mjs';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';
export * from './world-definition.mjs';
export {pathDistance} from './roads.mjs';

// Module loading awaits I/O; gameplay height queries only read the baked grid.
const surface=await loadTerrain();
export function terrainSurface(){return surface;}
export function heightAt(x,z){
  const {vertices}=surface,gx=clamp((x+240)/2,0,240),gz=clamp((z+480)/2,0,320);
  const ix=Math.min(239,Math.floor(gx)),iz=Math.min(319,Math.floor(gz)),u=gx-ix,v=gz-iz,k=iz*241+ix;
  const a=vertices[k],b=vertices[k+1],c=vertices[k+241],d=vertices[k+242];
  // Match Blender's and Meep's shared A-C-B / B-C-D triangle split.
  return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
}
export function regionAt(x, z) {
  return REGIONS.reduce((a, b) => Math.hypot(x - a.center[0], z - a.center[1]) < Math.hypot(x - b.center[0], z - b.center[1]) ? a : b);
}
export function landmarkPosition(id) {
  const p = LANDMARKS.find(l => l.id === id)?.position;
  if (!p) throw new Error(`Unknown landmark: ${id}`);
  return [p[0], heightAt(p[0], p[2]), p[2]];
}
