import { NavigationMesh } from '@woosh/meep-engine/src/engine/navigation/mesh/NavigationMesh.js';
import { bt_mesh_from_indexed_geometry } from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/io/bt_mesh_from_indexed_geometry.js';
import { bt_mesh_build_face_bvh } from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/query/bt_mesh_build_face_bvh.js';
import { CapsuleShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/CapsuleShape3D.js';
import {sh3_basis_at} from '@woosh/meep-engine/src/core/geom/3d/sphere/harmonics/sh3_basis_at.js';
import {line2_compute_segment_point_distance_sqr} from '@woosh/meep-engine/src/core/geom/2d/line/line2_compute_segment_point_distance_sqr.js';
import {line3_compute_segment_point_distance} from '@woosh/meep-engine/src/core/geom/3d/line/line3_compute_segment_point_distance.js';
import {v3_distance} from '@woosh/meep-engine/src/core/geom/vec3/v3_distance.js';
import {Actor} from '../simulation/components.mjs';
import { heightAt,ROAD_PATHS,landmarkPosition,pathDistance } from './regions.mjs';
import {DUNGEONS,dungeonPoint} from './dungeons.mjs';

// Real SH, order 2 (three bands / nine coefficients), Y up. Coefficients encode
// a directional distribution, not just an average which would cancel two-way traffic.
// Meep's native basis uses Z up, so exchange the vertical and north axes.
export function sh9([x,y,z]){const result=new Array(9);sh3_basis_at(x,z,y,result);return result;}
export function travelSample(position){
  const coefficients=new Array(9).fill(0);let occupancy=0;
  for(const road of ROAD_PATHS){
    let closest=null,best=Infinity;
    for(let i=1;i<road.points.length;i++){
      const p=road.points[i-1],q=road.points[i],distance=line2_compute_segment_point_distance_sqr(...p,...q,position[0],position[2]);
      if(distance<best){best=distance;closest=[p,q];}
    }
    const [start,end]=closest.map(([x,z])=>[x,heightAt(x,z),z]),d=end.map((v,i)=>v-start[i]),length=Math.hypot(...d);
    const distance=line3_compute_segment_point_distance(...start,...end,...position);
    const weight=Math.exp(-distance*distance/32);occupancy+=weight;
    const forward=sh9(d.map(v=>v/length)),backward=sh9(d.map(v=>-v/length));
    for(let i=0;i<9;i++)coefficients[i]+=weight*(forward[i]*.7+backward[i]*.3);
  }
  if(occupancy)for(let i=0;i<9;i++)coefficients[i]/=occupancy;
  return {position,occupancy:1-Math.exp(-occupancy),flow:coefficients};
}

/** A conservative sampled walkable surface. The Meep physics BVHs supply ground
 * and clearance; Meep NavigationMesh supplies topology, nearest-face and Polyanya.
 * Positive paths describe this sampled surface, with conservative cell clearance.
 * They are not a proof of reachability for narrow or stacked interior surfaces.
 */
export class SpatialAtlas {
  constructor(world,{bounds=[-221,-431,221,111],spacing=2}={}){this.world=world;this.bounds=bounds;this.spacing=spacing;this.nav=new NavigationMesh();this.samples=[];}
  build(){
    const [minX,minZ,maxX,maxZ]=this.bounds,s=this.spacing,cols=Math.floor((maxX-minX)/s)+1,rows=Math.floor((maxZ-minZ)/s)+1;
    const positions=[],indices=[],valid=[],heights=[],physics=this.world.physics,out=new Uint32Array(16),capsule=CapsuleShape3D.from(.42,1.05);
    const surface=(x,z)=>{
      const base=heightAt(x,z);this.world.ray.set([x,base+2,z,0,-1,0,4]);
      if(!physics.raycast(this.world.ray,this.world.hit,(_,c)=>c.shape.is_convex===false))return null;
      let y=this.world.hit.position[1];
      for(const solid of this.world.layout.solids){const top=solid.position[1]+solid.size[1]/2;if(Math.abs(x-solid.position[0])<solid.size[0]/2&&Math.abs(z-solid.position[2])<solid.size[2]/2&&top-y<.6&&top>y)y=top;}
      return y;
    };
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
      const x=minX+i*s,z=minZ+j*s,y=surface(x,z)??heightAt(x,z);positions.push(x,y,z);heights.push(y);
      const free=physics.overlap(capsule,[x,y+1.02,z],[0,0,0,1],out,0,(e,c)=>c.shape.is_convex!==false&&!this.world.ecd.getComponent(e,Actor))===0;
      valid.push(free);if(free&&pathDistance(x,z)<10)this.samples.push(travelSample([x,y+.9,z]));
    }
    for(let j=0;j<rows-1;j++)for(let i=0;i<cols-1;i++){
      const a=j*cols+i,b=a+1,c=a+cols,d=c+1;
      if(![a,b,c,d].every(k=>valid[k]))continue;
      const x=minX+(i+.5)*s,z=minZ+(j+.5)*s,y=surface(x,z)??heightAt(x,z);
      // Entire cell footprint must clear raised architecture and trunks.
      if(this.world.layout.solids.some(o=>Math.abs(o.position[0]-x)<o.size[0]/2+s/2+.42&&Math.abs(o.position[2]-z)<o.size[2]/2+s/2+.42&&o.position[1]+o.size[1]/2>y+.15&&o.position[1]-o.size[1]/2<y+1.8))continue;
      if(Math.max(...[a,b,c,d].map(k=>heights[k]))-Math.min(...[a,b,c,d].map(k=>heights[k]))>s*.65)continue;
      indices.push(a,c,b,b,c,d);
    }
    bt_mesh_from_indexed_geometry(this.nav.topology,indices,positions);bt_mesh_build_face_bvh(this.nav.bvh,this.nav.topology);
    this.geometry={positions,indices};
    this.faceCount=indices.length/3;return this;
  }
  path(from,to){
    if([from,to].some(p=>p[0]<this.bounds[0]||p[0]>this.bounds[2]||p[2]<this.bounds[1]||p[2]>this.bounds[3]))return {reachable:false,reason:'Endpoint outside navigation tile',points:[]};
    const output=[],count=this.nav.find_path(output,...from,...to),points=[];
    for(let i=0;i<count;i++)points.push(output.slice(i*3,i*3+3));
    if(!count)return {reachable:false,reason:'No connected walkable surface',points:[]};
    if(v3_distance(...points[0],...from)>this.spacing*1.5||v3_distance(...points.at(-1),...to)>this.spacing*1.5)return {reachable:false,reason:'Endpoint outside sampled walkable surface',points};
    return {reachable:true,points,length:points.slice(1).reduce((sum,p,i)=>sum+v3_distance(...p,...points[i]),0),resolution:this.spacing};
  }
  visibility(from,to,{eyeHeight=1.65,targetHeight=4,samples=9}={}){
    let visible=0;const rays=[];
    for(let i=0;i<samples;i++){
      const start=[from[0]+((i%3)-1)*.35,from[1]+eyeHeight,from[2]+(Math.floor(i/3)-1)*.35],end=[to[0],to[1]+targetHeight,to[2]];
      const clear=this.world.lineOfSight(start,end);visible+=Number(clear);rays.push({from:start,to:end,clear});
    }
    return {visibleFraction:visible/samples,rays};
  }
}

export const COMPOSITION_VIEWS=[
  {id:'first-light',label:'First Light',from:'hearth',toward:'abbey',fromOffset:[0,0,4],targetOffset:[-7,18,-16],yaw:0,pitch:-.05,time:15.2,requirement:'Abbey bell tower rises from the meadow basin; the gate is framed by near ruins.'},
  {id:'bellkeeper-mouth',label:'Bellkeeper’s Mouth',from:'cave',toward:'cave',fromOffset:[0,0,18],targetOffset:[0,2.4,5],yaw:0,pitch:.1,time:16,requirement:'Warm cave entrance separates from cool vegetation; route through the arch is legible.'},
  {id:'last-ascent',label:'Last Ascent',from:'pilgrims',toward:'halo',fromOffset:[-29,0,-34],targetOffset:[0,heightAt(0,-385)-heightAt(0,-361)+40,-24],yaw:.65,pitch:-.32,distance:7,time:9,requirement:'Final halo dominates the upper third; approach route remains visible.'},
  {id:'reliquary-court',label:'Reliquary · Lower Court',fromPosition:dungeonPoint(DUNGEONS[0],[0,3,0]),targetPosition:dungeonPoint(DUNGEONS[0],[0,12,1.7]),yaw:0,pitch:.1,distance:4,time:15,requirement:'The chapter doorway and side burial route are legible below the returning bridge.'},
  {id:'reliquary-lantern',label:'Reliquary · Lantern Chamber',fromPosition:dungeonPoint(DUNGEONS[0],[0,23,4.8]),targetPosition:dungeonPoint(DUNGEONS[0],[0,27,6]),yaw:0,pitch:.15,distance:2.8,time:23,requirement:'The Quiet Flame draws the eye through a sheltered upper chamber at night.'},
  ...DUNGEONS.slice(1).flatMap(d=>{
    const stair=d.connections.find(([a,b])=>a===d.rooms[0].id&&d.rooms.some(r=>r.id===b&&r.rise));
    const from=dungeonPoint(d,[0,2,0]),to=dungeonPoint(d,stair[2]);to[1]+=1.4;
    const at=d.treasure.at,room=d.rooms.find(r=>r.level===at[2]&&at[0]>r.rect[0]&&at[0]<r.rect[2]&&at[1]>r.rect[1]&&at[1]<r.rect[3]);
    const reverse=at[1]-room.rect[1]<5&&room.rect[3]-at[1]>5;
    return [
      {id:d.id+'-approach',label:d.name+' · Approach',fromPosition:from,targetPosition:to,yaw:Math.atan2(from[0]-to[0],from[2]-to[2]),pitch:.1,distance:4,time:15,requirement:'The entrance leads clearly toward the connecting stair, with the upper return route visible.'},
      {id:d.id+'-treasure',label:d.name+' · Relic',fromPosition:dungeonPoint(d,[at[0],at[1]+(reverse?3.5:-Math.min(3.5,at[1]-room.rect[1]-1.2)),at[2]]),targetPosition:dungeonPoint(d,[at[0],at[1],at[2]+1]),yaw:reverse?Math.PI:0,pitch:.15,distance:2.8,time:23,requirement:'The personal relic is readable under automatic exposure in its sheltered chamber at night.'},
    ];
  }),
];
export function compositionPoints(view){
  if(view.fromPosition)return {from:[...view.fromPosition],to:[...view.targetPosition]};
  const base=landmarkPosition(view.from),offset=view.fromOffset??[0,0,0],x=base[0]+offset[0],z=base[2]+offset[2];
  return {from:[x,heightAt(x,z)+offset[1],z],to:landmarkPosition(view.toward).map((v,i)=>v+(view.targetOffset?.[i]??0))};
}
