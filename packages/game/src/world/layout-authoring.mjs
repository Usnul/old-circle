import {seededRandom} from '@woosh/meep-engine/src/core/math/random/seededRandom.js';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';
import { heightAt, pathDistance, regionAt, landmarkPosition, HEARTHS, REGIONS } from './regions.mjs';
import {CAVES,inCaveFootprint} from './interiors.mjs';
import {DUNGEONS,dungeonPoint,dungeonFootprint} from './dungeons.mjs';

export function generateLayout() {
  const props=[], solids=[], lights=[], banners=[];
  const random=seededRandom(4171);
  const add=(model,x,z,scale=1,yaw=0,y=heightAt(x,z))=>{
    const s=Array.isArray(scale)?scale:[scale,scale,scale],p={model,position:[x,y,z],scale:s,yaw};props.push(p);
    if(model==='arch')for(const side of [-1,1]){
      const fx=x+Math.cos(yaw)*side*2.05*s[0],fz=z-Math.sin(yaw)*side*2.05*s[0],ground=heightAt(fx,fz)-.18;
      if(y>ground+.2)props.push({model:'block',position:[fx,ground,fz],scale:[.85*s[0],y-ground+.03,1.05*s[2]],yaw});
    }
    return p;
  };
  const box=(x,y,z,w,h,d)=>solids.push({position:[x,y,z],size:[w,h,d]});
  const lamp=(x,z,y=heightAt(x,z))=>{add('brazier',x,z,1,0,y);lights.push([x,y+1.25,z]);};
  const banner=(x,z,yaw=.6)=>{const p=add('bannerStand',x,z,1,yaw);banners.push({position:p.position,yaw,phase:banners.length*.73});};
  for(let tx=-3;tx<3;tx++)for(let tz=-6;tz<2;tz++)add(`terrain_${tx}_${tz}`,0,0,1,0,0);
  const clear=(x,z,margin=7)=>pathDistance(x,z)>margin&&HEARTHS.every(h=>Math.hypot(x-h.position[0],z-h.position[2])>8)&&Math.hypot(x,z+48)>24&&Math.hypot(x-38,z+23)>14&&REGIONS.every(r=>Math.hypot(x-r.center[0],z-r.center[1])>23)&&!(z<-284&&z>-356&&x>14&&x<82);
  const slope=(x,z)=>[(heightAt(x+1,z)-heightAt(x-1,z))/2,(heightAt(x,z+1)-heightAt(x,z-1))/2];
  const plant=(model,x,z,size=1)=>{
    const [dx,dz]=slope(x,z),p=add(model,x,z,size,random()*Math.PI*2,heightAt(x,z)-.03);
    // Only non-colliding ground plants tilt to the local surface. Trees and
    // structural props keep the same upright transforms in physics and view.
    p.up=[-dx,1,-dz];return p;
  };
  const groves=[];
  // Groves share species and age structure. Meadow openings stay open; conifers
  // belong to the northern foothills instead of alternating with every oak.
  for(let grove=0;grove<140;grove++){
    const cx=random()*420-210,cz=random()*545-415,region=regionAt(cx,cz).id;
    if(!clear(cx,cz,10)||region==='desert'||region==='crown'||(region==='meadow'&&random()<.55))continue;
    const species=region==='magic'?'magicTree':region==='tundra'?(cz>-290?'pine':'winterTree'):'tree';
    groves.push({x:cx,z:cz,region});
    for(let j=0;j<4+grove%5;j++){
      const a=random()*Math.PI*2,r=Math.sqrt(random())*11,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;
      if(!clear(x,z)||regionAt(x,z).id!==region)continue;
      add(species,x,z,(j===0?1.25:.55+random()*.6),random()*Math.PI*2,heightAt(x,z)-.06);
    }
  }
  // Outcrops form families: a buried parent boulder, scree, and vegetation in
  // sheltered gaps. Every member is checked against the route's walking space.
  for(let group=0;group<85;group++){
    const cx=random()*430-215,cz=random()*560-420;if(!clear(cx,cz,9))continue;
    const region=regionAt(cx,cz).id,large=region==='desert'||region==='crown'?3.4:2.2,[dx,dz]=slope(cx,cz),contour=Math.atan2(dz,dx)+Math.PI/2;
    const family=region==='desert'?'sandstone':region==='tundra'?'frostRock':'rock';
    for(let j=0;j<9;j++){
      const a=contour+(j%2?Math.PI:0)+random()*.6,r=j===0?0:j<3?large*.8:large*(1+random()*1.4);
      const x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,s=j===0?large:j<3?large*(.62+random()*.22):.22+random()*large*.16;
      if(!clear(x,z,3+s*1.5))continue;
      const y=Math.min(heightAt(x,z),heightAt(x+s*.75,z),heightAt(x-s*.75,z),heightAt(x,z+s*.6),heightAt(x,z-s*.6));
      add(`${family}${(group+j)%3}`,x,z,[s,s*(.74+random()*.22),s],contour+random()*.5,y-s*.24);
      if(j<3&&(region==='wood'||region==='meadow'||region==='magic')){
        const px=x+Math.cos(a+1.5)*s,pz=z+Math.sin(a+1.5)*s;if(clear(px,pz,4))plant(region==='wood'?'fern':'bracken',px,pz,.8+random()*.5);
      }
    }
  }
  // Fertile bands form continuous ground cover; the road, steep stone and
  // sheltered woodland choose their own plant communities at metre scale.
  for(let z=-410;z<134;z+=4.7)for(let x=-215;x<215;x+=4.7){
    const px=x+(random()-.5)*2,pz=z+(random()-.5)*2,region=regionAt(px,pz).id;
    const fertility=.5+.27*Math.sin(px*.067+Math.sin(pz*.041)*2)+.23*Math.sin(pz*.092+px*.023);
    const density={meadow:.82,wood:.64,magic:.38,desert:.065,tundra:.12,crown:.045}[region];
    if(random()>density*(.3+fertility*.7)||pathDistance(px,pz)<4.6||Math.hypot(px,pz+48)<20||Math.hypot(px-38,pz+23)<5||HEARTHS.some(h=>Math.hypot(px-h.position[0],pz-h.position[2])<4))continue;
    const [dx,dz]=slope(px,pz);if(Math.hypot(dx,dz)>.43)continue;
    const type=region==='desert'?'dryGrass':region==='tundra'||region==='crown'?'moorGrass':fertility>.72?'groundcover1':'groundcover';
    plant(type,px,pz,1.1+random()*.4);
  }
  for(const grove of groves){
    if(!['wood','magic','meadow'].includes(grove.region))continue;
    for(let j=0;j<12;j++){
      const a=random()*Math.PI*2,r=2+Math.sqrt(random())*10,x=grove.x+Math.cos(a)*r,z=grove.z+Math.sin(a)*r;
      if(clear(x,z,4)&&Math.hypot(...slope(x,z))<.6)plant(j%4===0?'bracken':'fern',x,z,.7+random()*.6);
    }
    const x=grove.x+5,z=grove.z+2;if(random()<.35&&clear(x,z,8)&&Math.hypot(...slope(x,z))<.2)add('fallenTrunk',x,z,1,random()*Math.PI*2,heightAt(x,z)-.1);
  }
  // Opening overlook: an architectural frame, a hearth and a low mantle wall.
  add('arch',-6,25,1.35,.35);
  lamp(0,20); lamp(-8,24);
  for(const h of HEARTHS)banner(h.position[0]+3,h.position[2]+1.8);
  banner(-4,-29,-.5);banner(4,-29,.5);
  for(const hearth of HEARTHS.slice(1)){
    const [x,,z]=hearth.position;lamp(x,z);
    const dx=x-hearth.arrival[0],dz=z-hearth.arrival[1];
    add('arch',x+dx,z+dz,.8,Math.atan2(dx,dz));
  }
  for(let i=0;i<4;i++) {add('block',8+i,15,[1,.9,1]);box(8+i,heightAt(8+i,15)+.45,15,1,.9,1);}
  // Circular abbey, with south and north gates open to late arrivals.
  const floor=heightAt(0,-48);
  add('abbeyFloor',0,-48,1,0,floor-.16);
  for(let i=0;i<20;i++){
    const a=i*Math.PI*2/20,x=Math.sin(a)*16,z=-48+Math.cos(a)*16;
    if(i%5!==0)add('arch',x,z,1,a,floor);
    if(i%2===0)lamp(x*.85,-48+(z+48)*.85,floor);
  }
  add('bellTower',-7,-64,1,0,floor-.3);
  add('arch',0,-32,1.55,0,floor);
  for(const side of [-1,1])for(let i=0;i<4;i++){
    add('abbeyWall',side*18,-40-i*5,1,Math.PI/2,floor-.2);
    add('buttress',side*20,-40-i*5,1,side*Math.PI/2,floor-.2);
  }
  // Blender-authored hollow: a sealed rock shell and a central burial chamber.
  for(const cave of CAVES){
    add(cave.model,0,0,1,0,0);
    for(const [x,z] of cave.lights)lamp(x,z);
    for(const [x,z,yaw] of cave.tombs)add('cryptTomb',x,z,1,yaw);
    for(const [x,z,width] of [cave.sections[0],cave.sections.at(-1)])for(const side of [-1,1])for(let i=0;i<3;i++){
      const px=x+side*(width+1.8+i*.65),pz=z+i*.75;
      add(`rock${i}`,px,pz,[1.2-i*.2,.8-i*.1,1.1-i*.15],side*.7+i*.3,heightAt(px,pz)-.5);
    }
    for(const [i,[x,z,,h]] of cave.sections.entries())if(i>0&&i<cave.sections.length-1){
      add('caveFang',x-1,z,1+i%2*.4,0,heightAt(x,z)+h+.3);
      add('caveFang',x+1.5,z-1,.7,0,heightAt(x,z)+h+.25);
    }
  }
  // Regional monuments share a visual grammar, but never the same silhouette.
  for(const dungeon of DUNGEONS){
    add('dungeon_'+dungeon.id,0,0,1,0,0);
    for(const local of dungeon.lamps){const [x,y,z]=dungeonPoint(dungeon,local);lamp(x,z,y);}
    for(const local of dungeon.tombs){const [x,y,z]=dungeonPoint(dungeon,local);add('cryptTomb',x,z,1,0,y);}
    const [x,y,z]=dungeonPoint(dungeon,dungeon.treasure.at);add('reliquary',x,z,1,0,y).relic=dungeon.treasure.id;
  }
  const [ox,oy,oz]=landmarkPosition('oak');add('tree',ox,oz-8,3.7,0,heightAt(ox,oz-8));lamp(ox+5,oz+4);
  for(let i=0;i<9;i++){add('arch',109+i*6,-114,1.5,0);if(i%2===0)lamp(109+i*6,-110);}
  const [sx,sy,sz]=landmarkPosition('spire');
  for(let i=0;i<5;i++)add('column',sx,sz,[2-i*.3,2.5,2-i*.3],0,sy+i*10);
  add('halo',sx,sz,2,0,sy+30);
  for(let i=0;i<6;i++)add('column',75+i*8,-275,[2,3+i%2,2],0);
  const [cx,,]=landmarkPosition('halo'),cz=-385,cy=heightAt(cx,cz);
  // Open mountain courtyard: keep the naturally walkable slope through the gates.
  for(let i=-2;i<=2;i++){
    add('bellTower',cx+i*8,cz,[1,1.6-Math.abs(i)*.3,1],0,heightAt(cx+i*8,cz)-1);
    add('arch',cx+i*6,cz+12,1.5,0,heightAt(cx+i*6,cz+12)-.1);
  }
  add('halo',0,-385,6,0,cy+40);
  for(let i=0;i<8;i++)lamp(-14+i*4,-351);
  // Overlapping massifs conceal the edge. Lower central saddles leave sky
  // behind the final halo; the taller shoulders frame the climb on either side.
  for(let i=0;i<9;i++){
    const x=-340+i*85,z=-505+Math.cos(i*1.3)*18;
    add(['mountain','mountainRidge','mountainShoulder'][i%3],x,z,[1.12+(i%3)*.08,.55+.3*(Math.abs(x)/340)**.8,1.15],Math.sin(i*1.7)*.25,heightAt(clamp(x,-235,235),-460)-20);
  }
  // Remove cover inside authored rock after scatter, preserving all random
  // sequences and placements elsewhere when a local interior changes.
  const vegetation=new Set(['tree','pine','magicTree','winterTree','groundcover','groundcover1','dryGrass','moorGrass','fern','bracken','fallenTrunk']);
  for(let i=props.length-1;i>=0;i--){const p=props[i],x=p.position[0],z=p.position[2];if((vegetation.has(p.model)&&inCaveFootprint(x,z,3))||((vegetation.has(p.model)||/^(rock|sandstone|frostRock)/.test(p.model))&&dungeonFootprint(x,z,2)))props.splice(i,1);}
  return {props,solids,lights,banners};
}
