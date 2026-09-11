import {WORLD_BOUNDS} from './regions.mjs';

export const MAP_SIZE=[WORLD_BOUNDS.width,WORLD_BOUNDS.depth];
export const worldToMap=(x,z)=>[x-WORLD_BOUNDS.minX,z-WORLD_BOUNDS.minZ];
export const mapToWorld=(x,y)=>[x+WORLD_BOUNDS.minX,y+WORLD_BOUNDS.minZ];
