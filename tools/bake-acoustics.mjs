import {writeFile} from 'node:fs/promises';
import {createWorldAcoustics} from '../packages/game/src/world/acoustics.mjs';
import {heightAt,WORLD_BOUNDS,WORLD_VERSION,ROAD_PATHS,LANDMARKS} from '../packages/game/src/world/regions.mjs';
import {DUNGEONS,dungeonFloors,floorHeight,dungeonPoint} from '../packages/game/src/world/dungeons.mjs';
import {CAVES} from '../packages/game/src/world/interiors.mjs';
import {AcousticProbeField} from '../packages/game/node_modules/@woosh/meep-engine/src/engine/sound/simulation/probe/AcousticProbeField.js';
import {bakeReverbBands} from '../packages/game/node_modules/@woosh/meep-engine/src/engine/sound/simulation/probe/bakeReverbBands.js';
import {seededRandom} from '../packages/game/node_modules/@woosh/meep-engine/src/core/math/random/seededRandom.js';

// Place at playable listener heights: a volumetric world-hull grid would spend
// most of its budget inside mountains or above their summits. Meep traces and
// serializes every probe; acoustic pathing/visibility graphs are not baked.
const {simulator,bodies}=createWorldAcoustics(),index=simulator.occluderIndex,field=new AcousticProbeField(),positions=new Set();
const add=(x,y,z)=>{
  const key=[x,y,z].map(v=>Math.round(v*2)).join(':');if(positions.has(key)||index.signedDistanceAt(x,y,z,.35)<.2)return;
  positions.add(key);field.setProbePosition(field.size,x,y,z);
};
const ground=(x,z)=>add(x,heightAt(x,z)+1.5,z),{minX,minZ,width,depth}=WORLD_BOUNDS;
for(let x=minX+16;x<minX+width;x+=32)for(let z=minZ+16;z<minZ+depth;z+=32)ground(x,z);
for(const road of ROAD_PATHS)for(let i=0;i<road.points.length;i+=2)ground(...road.points[i]);
for(const landmark of LANDMARKS)ground(landmark.position[0],landmark.position[2]);
for(const cave of CAVES)for(const [x,z,w] of cave.sections)for(const offset of [-w*.45,0,w*.45])ground(x+offset,z);
for(const dungeon of DUNGEONS)for(const floor of dungeonFloors(dungeon,heightAt)){
  const [x0,n0,x1,n1]=floor.rect;
  for(let x=x0+1;x<x1;x+=3)for(let n=n0+1;n<n1;n+=3){
    const p=dungeonPoint(dungeon,[x,n]);add(p[0],floorHeight(floor,x,n)+1.5,p[2]);
  }
}
const bands=new Float32Array(3),directions=new Float32Array(9),random=seededRandom(4171),rays=256,started=performance.now();
console.log(`Baking ${field.size} listener probes against ${bodies} native occluders (${rays} rays each).`);
for(let i=0;i<field.size;i++){
  bakeReverbBands(index,field.probeX(i),field.probeY(i),field.probeZ(i),rays,random,bands,directions);
  if(![...bands,...directions].every(Number.isFinite))throw new Error(`Non-finite acoustic probe ${i}`);
  field.setProbeReverbDecay(i,...bands);field.setProbeReverbDirections(i,directions);
  if(i%100===99)console.log(`${i+1}/${field.size} probes`);
}
const output={version:1,worldVersion:WORLD_VERSION,rays,bodies,field:field.toJSON()};
await writeFile(new URL('../packages/game/src/content/acoustic-probes.json',import.meta.url),JSON.stringify(output));
console.log(`Baked ${field.size} probes in ${((performance.now()-started)/1000).toFixed(1)} s; pathing remains disabled.`);
