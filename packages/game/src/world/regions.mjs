import {REGIONS,LANDMARKS,WORLD_BOUNDS} from './world-definition.mjs';
import {loadTerrain,TERRAIN_GRID} from './terrain-data.mjs';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';
export * from './world-definition.mjs';
export {pathDistance} from './roads.mjs';

// Module loading awaits I/O; gameplay height queries only read the baked grid.
const surface=await loadTerrain();
export function terrainSurface(){return surface;}
const {spacing:gridStep,cols:gridCols,rows:gridRows}=TERRAIN_GRID;
const {minX:gridX,minZ:gridZ}=WORLD_BOUNDS;
export function heightAt(x,z){
  const {vertices}=surface,gx=clamp((x-gridX)/gridStep,0,gridCols-1),gz=clamp((z-gridZ)/gridStep,0,gridRows-1);
  const ix=Math.min(gridCols-2,Math.floor(gx)),iz=Math.min(gridRows-2,Math.floor(gz)),u=gx-ix,v=gz-iz,k=iz*gridCols+ix;
  const a=vertices[k],b=vertices[k+1],c=vertices[k+gridCols],d=vertices[k+gridCols+1];
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
