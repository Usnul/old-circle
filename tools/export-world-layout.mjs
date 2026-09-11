import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {generateTerrain} from '../packages/game/src/world/terrain-authoring.mjs';
import {encodeTerrain} from '../packages/game/src/world/terrain-data.mjs';
import {CAVES} from '../packages/game/src/world/interiors.mjs';
import {DUNGEONS,DUNGEON_MATERIALS,dungeonFloors} from '../packages/game/src/world/dungeons.mjs';

// Publish the native terrain before importing runtime consumers, including
// scatter authoring. A fresh checkout can rebuild without any prior bake.
await writeFile(new URL('../packages/game/src/content/terrain.bin',import.meta.url),encodeTerrain(generateTerrain()));
const {heightAt,pathDistance,regionAt,WORLD_VERSION,REGIONS,ROAD_PATHS}=await import('../packages/game/src/world/regions.mjs');
const {generateLayout}=await import('../packages/game/src/world/layout-authoring.mjs');
await writeFile(new URL('../packages/game/src/content/layout.json',import.meta.url),JSON.stringify({worldVersion:WORLD_VERSION,data:generateLayout()}));

// Blender consumes sampled design data, never a second implementation of the map.
const materials={meadow:'grass',wood:'leaf',desert:'sand',magic:'stoneDark',tundra:'snow',crown:'stone'};
const heights=[],cells=[];
for(let z=-480;z<=160;z+=2){const row=[];for(let x=-240;x<=240;x+=2)row.push(heightAt(x,z));heights.push(row);}
for(let z=-480;z<160;z+=2){const row=[];for(let x=-240;x<240;x+=2)row.push({material:materials[regionAt(x,z).id],pathDistance:pathDistance(x+1,z+1)});cells.push(row);}
const directory=resolve(import.meta.dirname,'../.local/blender');await mkdir(directory,{recursive:true});
const routes=ROAD_PATHS.flatMap(road=>road.points.slice(1).map((p,i)=>[road.points[i],p].map(([x,z])=>[x,heightAt(x,z),z])));
await writeFile(resolve(directory,'world.json'),JSON.stringify({version:WORLD_VERSION,minX:-240,minZ:-480,spacing:2,heights,cells,regions:REGIONS,routes,caves:CAVES,dungeonMaterials:DUNGEON_MATERIALS,dungeons:DUNGEONS.map(d=>({...d,floors:dungeonFloors(d,heightAt)}))}));
console.log('Exported shared landform and road samples for Blender.');
