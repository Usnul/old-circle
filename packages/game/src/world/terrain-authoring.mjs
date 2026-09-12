import {create_simplex_noise_2d} from '@woosh/meep-engine/src/core/math/noise/create_simplex_noise_2d.js';
import {seededRandom} from '@woosh/meep-engine/src/core/math/random/seededRandom.js';
import {smoothStep} from '@woosh/meep-engine/src/core/math/smoothStep.js';
import {clamp01} from '@woosh/meep-engine/src/core/math/clamp01.js';
import {line3_compute_segment_closest_point_t} from '@woosh/meep-engine/src/core/geom/3d/line/line3_compute_segment_closest_point_t.js';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {ROAD_PATHS,WORLD_BOUNDS} from './world-definition.mjs';
import {TERRAIN_GRID} from './terrain-data.mjs';
import {DUNGEONS} from './dungeons.mjs';
import {pathDistance} from './roads.mjs';
import {CAVES} from './interiors.mjs';

// Offline landform authoring. Runtime loads the baked sampler and vertex grid.
const hills=[
  [0,32,7,58,38],[-85,5,19,42,53],[80,8,19,33,47],
  [-67,-156,33,32,79],[59,-158,35,29,65],[150,-116,8,70,45],
  [-200,-200,39,45,105],[197,-210,33,38,66],[0,-392,29,83,72],
  [-183,-354,61,35,70],[168,-365,67,35,78],[8,-463,44,100,34],
];
const noise=create_simplex_noise_2d(seededRandom(81731));
function naturalHeightAt(x, z) {
  let y=Math.max(0,-z-100)*.17+Math.sin(x*.026)*1.4+Math.sin(z*.036)*1.1+Math.sin(x*.061+z*.027)*.5;
  for(const [cx,cz,h,rx,rz] of hills)y+=h*Math.exp(-(((x-cx)/rx)**2+((z-cz)/rz)**2));
  const roughness=1.2+smoothStep(0,1,(-z-60)/240)*5;
  // Preserve the graded road bed while allowing broken terrain beside it.
  y+=roughness*(noise(x*.035,z*.035)+noise(x*.085+41,z*.085)*.22)*smoothStep(0,1,(pathDistance(x,z)-5)/18);
  // The abbey was cut into a level basin. The shoulder eases into the hillside.
  const abbey=smoothStep(0,1,(Math.max(Math.abs(x)-24,Math.abs(z+48)-23))/14);y=.65+(y-.65)*abbey;
  // A broad earth terrace carries the arrival gate and its paved landing.
  const landing=smoothStep(0,1,Math.max(Math.abs(x-1)-11,Math.abs(z-20)-13)/14);
  y=8+(y-8)*landing;
  return y;
}
let dungeonRoadGrades;
function sculptedHeightAt(x,z){
  let y=naturalHeightAt(x,z);
  // Burial chambers were cut with level cross-sections. Grade along the vault
  // between its mouths so the rock shell never meets a sideways hillside.
  for(const cave of CAVES){
    const first=cave.sections[0],last=cave.sections.at(-1);
    for(let i=1;i<cave.sections.length;i++){
      const a=cave.sections[i-1],b=cave.sections[i];
      if(z>Math.max(a[1],b[1])||z<Math.min(a[1],b[1]))continue;
      const t=(z-a[1])/(b[1]-a[1]),cx=a[0]+(b[0]-a[0])*t,width=a[2]+(b[2]-a[2])*t;
      const distance=Math.max(0,Math.abs(x-cx)-width-1.5);
      if(distance>=5)continue;
      const along=(z-first[1])/(last[1]-first[1]),target=naturalHeightAt(first[0],first[1])+(naturalHeightAt(last[0],last[1])-naturalHeightAt(first[0],first[1]))*along;
      y=target+(y-target)*smoothStep(0,1,distance/5);
    }
  }
  dungeonRoadGrades??=ROAD_PATHS.filter(r=>DUNGEONS.slice(1).some(d=>d.id===r.to)).map(r=>{
    const lengths=[0];for(let i=1;i<r.points.length;i++)lengths.push(lengths[i-1]+Math.hypot(r.points[i][0]-r.points[i-1][0],r.points[i][1]-r.points[i-1][1]));
    const start=naturalHeightAt(...r.points[0]),end=naturalHeightAt(...r.points.at(-1));
    return r.points.map((p,i)=>[...p,start+(end-start)*lengths[i]/lengths.at(-1)]);
  });
  // A carved grade gives the side roads an even climb through steep natural
  // shoulders. Its endpoint extends into a level landing before each ramp.
  let roadDistance=Infinity,roadHeight=0;
  for(const points of dungeonRoadGrades)for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=line3_compute_segment_closest_point_t(a[0],0,a[1],b[0],0,b[1],x,0,z);
    const distance=Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);if(distance<roadDistance){roadDistance=distance;roadHeight=a[2]+t*(b[2]-a[2]);}
  }
  if(roadDistance<8)y=roadHeight+(y-roadHeight)*smoothStep(0,1,(roadDistance-3.5)/4.5);
  // Continue the road grade beneath each entrance. Leaving the natural hill
  // under a long masonry ramp creates abrupt terrain contacts through its floor.
  for(const d of DUNGEONS){
    const px=x-d.origin[0],n=d.origin[1]-z,start=d.entrance[1];
    if(n<start||n>0)continue;
    const distance=Math.max(Math.abs(px)-2,0);if(distance>=4)continue;
    const toe=naturalHeightAt(d.origin[0],d.origin[1]-start),t=(n-start)/-start;
    const target=toe+(d.elevation-toe)*t-.35,blend=smoothStep(0,1,(n-start)/4)*(1-smoothStep(0,1,distance/4));
    y+=(target-y)*blend;
  }
  // Excavated foundations keep the authored lower rooms clear of the hill.
  // Their shoulders ease into the same native terrain sampler as the road.
  let foundation=Infinity;
  for(const d of DUNGEONS)for(const room of d.rooms){
    const px=x-d.origin[0],n=d.origin[1]-z,[x0,n0,x1,n1]=room.rect;
    const distance=Math.hypot(Math.max(x0-px,0,px-x1),Math.max(n0-n,0,n-n1));
    const target=d.elevation+room.level+(room.rise??0)*clamp01((n-n0)/(n1-n0))-.35;
    if(distance<4&&(room.level<=0||y>target))foundation=Math.min(foundation,target+(y-target)*smoothStep(0,1,distance/4));
  }
  if(foundation!==Infinity)y=foundation;
  return y;
}

/** One native sampler supplies physics and the vertex heights exported to Blender.
 * Meep UVs address texel centres (u * width - .5), not vertex-grid indices. */
export function generateTerrain(){
  const {cols:width,rows:height}=TERRAIN_GRID,{minX,minZ,width:spanX,depth:spanZ}=WORLD_BOUNDS;
  const sampler=new Sampler2D(new Float32Array(width*height),1,width,height),vertices=new Float32Array(width*height);
  for(let z=0;z<height;z++)for(let x=0;x<width;x++)sampler.data[z*width+x]=sculptedHeightAt((x+.5)/width*spanX+minX,(z+.5)/height*spanZ+minZ)+15;
  for(let z=0;z<height;z++)for(let x=0;x<width;x++)vertices[z*width+x]=sampler.sampleChannelCatmullRomUV(x/(width-1),z/(height-1),0)-15;
  return {sampler,vertices};
}
