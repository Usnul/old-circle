import { NavigationMesh } from '@woosh/meep-engine/src/engine/navigation/mesh/NavigationMesh.js';
import { bt_mesh_from_indexed_geometry } from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/io/bt_mesh_from_indexed_geometry.js';
import { bt_mesh_build_face_bvh } from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/query/bt_mesh_build_face_bvh.js';
import { CapsuleShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/CapsuleShape3D.js';
import {Actor} from '../simulation/components.mjs';
import { heightAt,LANDMARKS,ROUTES,landmarkPosition,pathDistance } from './regions.mjs';

// Real SH, order 2 (three bands / nine coefficients), Y up. Coefficients encode
// a directional distribution, not just an average which would cancel two-way traffic.
export function sh9([x,y,z]){return [.2820947918,.4886025119*z,.4886025119*y,.4886025119*x,1.0925484306*x*z,1.0925484306*y*z,.3153915653*(3*y*y-1),1.0925484306*x*y,.5462742153*(x*x-z*z)];}
export function travelSample(position){
  const coefficients=new Array(9).fill(0);let occupancy=0;
  for(const [a,b] of ROUTES){
    const start=landmarkPosition(a),end=landmarkPosition(b),d=end.map((v,i)=>v-start[i]),length=Math.hypot(...d);
    const t=Math.max(0,Math.min(1,position.reduce((sum,v,i)=>sum+(v-start[i])*d[i],0)/(length*length)));
    const distance=Math.hypot(...position.map((v,i)=>v-start[i]-d[i]*t));
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
    this.faceCount=indices.length/3;return this;
  }
  path(from,to){
    const output=[],count=this.nav.find_path(output,...from,...to),points=[];
    for(let i=0;i<count;i++)points.push(output.slice(i*3,i*3+3));
    if(!count)return {reachable:false,reason:'No connected walkable surface',points:[]};
    if(Math.hypot(...points[0].map((v,i)=>v-from[i]))>this.spacing*1.5||Math.hypot(...points.at(-1).map((v,i)=>v-to[i]))>this.spacing*1.5)return {reachable:false,reason:'Endpoint outside sampled walkable surface',points};
    return {reachable:true,points,length:points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,j)=>v-points[i][j])),0),resolution:this.spacing};
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
  {id:'first-light',label:'First Light',from:'hearth',toward:'abbey',fromOffset:[0,0,4],targetOffset:[0,12,-9],yaw:0,pitch:-.05,time:15.2,requirement:'Abbey gate framed by near ruins; distant halo separates from treeline.'},
  {id:'bellkeeper-mouth',label:'Bellkeeper’s Mouth',from:'cave',toward:'cave',fromOffset:[0,0,18],targetOffset:[0,2.4,5],yaw:0,pitch:.1,time:16,requirement:'Warm cave entrance separates from cool vegetation; route through the arch is legible.'},
  {id:'last-ascent',label:'Last Ascent',from:'pilgrims',toward:'halo',fromOffset:[-40,0,-25],targetOffset:[0,58,-12],yaw:.59,pitch:-.4,distance:8,time:9,requirement:'Final halo dominates the upper third; approach route remains visible.'},
];
export function compositionPoints(view){
  const base=landmarkPosition(view.from),offset=view.fromOffset??[0,0,0],x=base[0]+offset[0],z=base[2]+offset[2];
  return {from:[x,heightAt(x,z)+offset[1],z],to:landmarkPosition(view.toward).map((v,i)=>v+(view.targetOffset?.[i]??0))};
}
