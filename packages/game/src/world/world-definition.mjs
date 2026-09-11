import {computeCatmullRomSpline} from '@woosh/meep-engine/src/core/math/spline/computeCatmullRomSpline.js';
import {DUNGEONS,dungeonPoint} from './dungeons.mjs';
// World coordinates are metres, Y-up. North is -Z. One continuous landscape.
export const WORLD_VERSION = 6;
export const WORLD_BOUNDS=Object.freeze({minX:-240,minZ:-480,width:480,depth:640});
export const SPAWN = [0, 0, 23];
export const REGIONS = [
  { id: 'meadow', name: 'The Waking Fields', level: [1, 5], center: [0, 15], radius: 95, color: '#8eaa76', enemies: ['hollow', 'hound'], landmark: 'The Bell Without a Tongue', purpose: 'Learn the old road. Light the abbey hearth.', boss: 'warden' },
  { id: 'wood', name: 'Mourningwood', level: [5, 10], center: [-125, -55], radius: 100, color: '#365d50', enemies: ['hollow', 'hound', 'archer'], landmark: 'The Widow Oak', purpose: 'Recover the root seal beneath the Widow Oak.', boss: 'rootbound' },
  { id: 'desert', name: 'The Cinder March', level: [10, 16], center: [135, -105], radius: 100, color: '#bd895b', enemies: ['hollow', 'archer', 'mage'], landmark: 'The Severed Aqueduct', purpose: 'Cross the salt road and recover the ash seal.', boss: 'cantor' },
  { id: 'magic', name: 'The Glasswood', level: [16, 22], center: [-115, -225], radius: 100, color: '#839cba', enemies: ['hound', 'mage', 'archer'], landmark: 'The Listening Spire', purpose: 'Follow the blue lanterns to the star seal.', boss: 'mirror' },
  { id: 'tundra', name: 'Pale Reach', level: [22, 28], center: [95, -265], radius: 110, color: '#c5d1d6', enemies: ['hollow', 'mage', 'sentinel'], landmark: 'The Frozen Pilgrims', purpose: 'Climb the ice road into the crown mountains.', boss: 'frostbound' },
  { id: 'crown', name: 'The Last Crown', level: [28, 35], center: [0, -370], radius: 85, color: '#afa796', enemies: ['sentinel', 'mage'], landmark: 'The Broken Halo', purpose: 'Return the seals. End the circling of the sun.', boss: 'last-king' },
];
export const LANDMARKS = [
  { id: 'hearth', name: 'Pilgrim’s Hearth', position: [0, 0, 20], region: 'meadow', kind: 'hearth' },
  { id: 'abbey', name: 'Abbey of the First Light', position: [0, 0, -48], region: 'meadow', kind: 'boss' },
  { id: 'cave', name: 'The Bellkeeper’s Hollow', position: [38, 0, -15], region: 'meadow', kind: 'cave' },
  { id: 'oak', name: 'The Widow Oak', position: [-125, 0, -47], region: 'wood', kind: 'boss' },
  { id: 'aqueduct', name: 'The Severed Aqueduct', position: [135, 0, -105], region: 'desert', kind: 'boss' },
  { id: 'spire', name: 'The Listening Spire', position: [-115, 0, -225], region: 'magic', kind: 'boss' },
  { id: 'pilgrims', name: 'The Frozen Pilgrims', position: [95, 0, -265], region: 'tundra', kind: 'boss' },
  { id: 'halo', name: 'The Broken Halo', position: [0, 0, -361], region: 'crown', kind: 'boss' },
  ...DUNGEONS.map(d=>({id:d.id,name:d.name,position:dungeonPoint(d,d.entrance),region:d.region,kind:'dungeon'})),
];
export const ROUTES = [
  ['hearth', 'abbey'], ['hearth', 'cave'], ['cave', 'abbey'], ['abbey', 'oak'],
  ['abbey', 'aqueduct'], ['oak', 'spire'], ['aqueduct', 'pilgrims'],
  ['spire', 'pilgrims'], ['spire', 'halo'], ['pilgrims', 'halo'],
  ['oak','root-cloister'],['aqueduct','ashen-cistern'],['spire','glass-observatory'],['pilgrims','white-ossuary'],['halo','uncrowned-archive'],
];
const bends={
  'hearth:abbey':[[5,3],[-4,-19]],'hearth:cave':[[19,15],[30,2]],'cave:abbey':[[38,-35],[22,-43]],
  'abbey:oak':[[-28,-60],[-62,-73],[-94,-57]],'abbey:aqueduct':[[33,-71],[71,-81],[101,-103]],
  'oak:spire':[[-147,-100],[-149,-148],[-123,-184]],'aqueduct:pilgrims':[[153,-152],[131,-202],[105,-228]],
  'spire:pilgrims':[[-64,-242],[-16,-252],[40,-245]],'spire:halo':[[-117,-270],[-78,-318],[-31,-337]],
  'pilgrims:halo':[[66,-299],[34,-318],[25,-342]],
  'spire:glass-observatory':[[-125,-202],[-146,-191]],
  'pilgrims:white-ossuary':[[117,-244],[136,-229]],
};
export const ROAD_PATHS=ROUTES.map(([a,b])=>{
  const start=LANDMARKS.find(l=>l.id===a).position,end=LANDMARKS.find(l=>l.id===b).position;
  const points=[[start[0],start[2]],...(bends[`${a}:${b}`]??[]),[end[0],end[2]]],flat=[];
  computeCatmullRomSpline(flat,points.flat(),points.length,2,points.length*7);
  return {from:a,to:b,points:Array.from({length:flat.length/2},(_,i)=>[flat[i*2],flat[i*2+1]])};
});
// Hearths sit beside a graded approach, with the return point on the road.
// Stable IDs are saved with the character; positions follow authored road edits.
export const HEARTHS=[{...LANDMARKS[0],arrival:[0,23]},...[
  ['widows-rest','Widow’s Rest','wood','abbey','oak',.72],
  ['salt-vigil','The Salt Vigil','desert','abbey','aqueduct',.73],
  ['blue-watch','The Blue Watch','magic','oak','spire',.8],
  ['winter-shelter','Winter’s Shelter','tundra','aqueduct','pilgrims',.78],
  ['last-vigil','The Last Vigil','crown','pilgrims','halo',.6],
].map(([id,name,region,from,to,fraction])=>{
  const road=ROAD_PATHS.find(r=>r.from===from&&r.to===to),index=Math.floor((road.points.length-1)*fraction);
  const p=road.points[index],next=road.points[index+1],dx=next[0]-p[0],dz=next[1]-p[1],length=Math.hypot(dx,dz);
  return {id,name,region,kind:'hearth',position:[p[0]-dz/length*3,0,p[1]+dx/length*3],arrival:[...p]};
})];
LANDMARKS.push(...HEARTHS.slice(1));
