import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {heightAt,pathDistance,regionAt,WORLD_VERSION,REGIONS,ROUTES,landmarkPosition} from '../packages/game/src/world/regions.mjs';

// Blender consumes sampled design data, never a second implementation of the map.
const materials={meadow:'grass',wood:'leaf',desert:'sand',magic:'stoneDark',tundra:'snow',crown:'stone'};
const heights=[],cells=[];
for(let z=-480;z<=160;z+=2){const row=[];for(let x=-240;x<=240;x+=2)row.push(heightAt(x,z));heights.push(row);}
for(let z=-480;z<160;z+=2){const row=[];for(let x=-240;x<240;x+=2)row.push({material:materials[regionAt(x,z).id],pathDistance:pathDistance(x+1,z+1)});cells.push(row);}
const directory=resolve(import.meta.dirname,'../.local/blender');await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'world.json'),JSON.stringify({version:WORLD_VERSION,minX:-240,minZ:-480,spacing:2,heights,cells,regions:REGIONS,routes:ROUTES.map(([a,b])=>[landmarkPosition(a),landmarkPosition(b)])}));
console.log('Exported shared landform and road samples for Blender.');
