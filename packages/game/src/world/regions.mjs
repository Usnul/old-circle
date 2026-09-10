import {computeCatmullRomSpline} from '@woosh/meep-engine/src/core/math/spline/computeCatmullRomSpline.js';
import {create_simplex_noise_2d} from '@woosh/meep-engine/src/core/math/noise/create_simplex_noise_2d.js';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {DUNGEONS,dungeonPoint} from './dungeons.mjs';
// World coordinates are metres, Y-up. North is -Z. One continuous landscape.
export const WORLD_VERSION = 4;
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
];
const bends={
  'hearth:abbey':[[5,3],[-4,-19]],'hearth:cave':[[19,15],[30,2]],'cave:abbey':[[38,-35],[22,-43]],
  'abbey:oak':[[-28,-60],[-62,-73],[-94,-57]],'abbey:aqueduct':[[33,-71],[71,-81],[101,-103]],
  'oak:spire':[[-147,-100],[-149,-148],[-123,-184]],'aqueduct:pilgrims':[[153,-152],[131,-202],[105,-228]],
  'spire:pilgrims':[[-64,-242],[-16,-252],[40,-245]],'spire:halo':[[-117,-270],[-78,-318],[-31,-337]],
  'pilgrims:halo':[[66,-299],[34,-318],[25,-342]],
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
const hills=[
  [0,32,7,58,38],[-85,5,19,42,53],[80,8,19,33,47],
  [-67,-156,33,32,79],[59,-158,35,29,65],[150,-116,8,70,45],
  [-200,-200,39,45,105],[197,-210,33,38,66],[0,-392,29,83,72],
  [-183,-354,61,35,70],[168,-365,67,35,78],[8,-463,44,100,34],
];
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
let terrainSeed=81731;
const noise=create_simplex_noise_2d(()=>{terrainSeed=(Math.imul(terrainSeed,1664525)+1013904223)>>>0;return terrainSeed/4294967296;});
function sculptedHeightAt(x, z) {
  let y=Math.max(0,-z-100)*.17+Math.sin(x*.026)*1.4+Math.sin(z*.036)*1.1+Math.sin(x*.061+z*.027)*.5;
  for(const [cx,cz,h,rx,rz] of hills)y+=h*Math.exp(-(((x-cx)/rx)**2+((z-cz)/rz)**2));
  const roughness=1.2+smooth((-z-60)/240)*5;
  // Preserve the graded road bed while allowing broken terrain beside it.
  y+=roughness*(noise(x*.035,z*.035)+noise(x*.085+41,z*.085)*.22)*smooth((pathDistance(x,z)-5)/18);
  // The abbey was cut into a level basin. The shoulder eases into the hillside.
  const abbey=smooth((Math.hypot(x/1.05,z+48)-19)/17);y=.65+(y-.65)*abbey;
  // Excavated foundations keep the authored lower rooms clear of the hill.
  // Their shoulders ease into the same native terrain sampler as the road.
  for(const d of DUNGEONS)for(const room of d.rooms){
    if(room.level!==0||room.rise)continue;
    const px=x-d.origin[0],n=d.origin[1]-z,[x0,n0,x1,n1]=room.rect;
    const distance=Math.hypot(Math.max(x0-px,0,px-x1),Math.max(n0-n,0,n-n1));
    if(distance<4)y=d.elevation-.35+(y-d.elevation+.35)*smooth(distance/4);
  }
  return y;
}
let surface;
/** One native sampler supplies physics and the vertex heights exported to Blender.
 * Meep UVs address texel centres (u * width - .5), not vertex-grid indices. */
export function terrainSurface(){
  if(surface)return surface;
  const width=241,height=321,sampler=new Sampler2D(new Float32Array(width*height),1,width,height),vertices=new Float32Array(width*height);
  for(let z=0;z<height;z++)for(let x=0;x<width;x++)sampler.data[z*width+x]=sculptedHeightAt((x+.5)/width*480-240,(z+.5)/height*640-480)+15;
  for(let z=0;z<height;z++)for(let x=0;x<width;x++)vertices[z*width+x]=sampler.sampleChannelCatmullRomUV(x/(width-1),z/(height-1),0)-15;
  surface={sampler,vertices};return surface;
}
export function heightAt(x,z){
  const {vertices}=terrainSurface(),gx=Math.max(0,Math.min(240,(x+240)/2)),gz=Math.max(0,Math.min(320,(z+480)/2));
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
export function pathDistance(x, z) {
  let best = Infinity;
  for(const road of ROAD_PATHS)for(let i=1;i<road.points.length;i++){
    const p=road.points[i-1],q=road.points[i],dx=q[0]-p[0],dz=q[1]-p[1];
    const t=Math.max(0,Math.min(1,((x-p[0])*dx+(z-p[1])*dz)/(dx*dx+dz*dz)));
    best=Math.min(best,Math.hypot(x-p[0]-dx*t,z-p[1]-dz*t));
  }
  return best;
}
