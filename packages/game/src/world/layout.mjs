import { heightAt, pathDistance, regionAt, landmarkPosition } from './regions.mjs';

export function buildLayout() {
  const props=[], solids=[], lights=[];
  let seed=4171;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
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
  for(let tx=-3;tx<3;tx++)for(let tz=-6;tz<2;tz++)add(`terrain_${tx}_${tz}`,0,0,1,0,0);
  const clear=(x,z,margin=7)=>pathDistance(x,z)>margin&&Math.hypot(x,z+48)>24&&Math.hypot(x-38,z+23)>14&&!(z<-284&&z>-356&&x>14&&x<82);
  // Groves share species and age structure. Meadow openings stay open; conifers
  // belong to the northern foothills instead of alternating with every oak.
  for(let grove=0;grove<140;grove++){
    const cx=random()*420-210,cz=random()*545-415,region=regionAt(cx,cz).id;
    if(!clear(cx,cz,10)||region==='desert'||region==='crown'||(region==='meadow'&&random()<.55))continue;
    const species=region==='magic'?'magicTree':region==='tundra'?(cz>-290?'pine':'winterTree'):'tree';
    for(let j=0;j<4+grove%5;j++){
      const a=random()*Math.PI*2,r=Math.sqrt(random())*11,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;
      if(!clear(x,z)||regionAt(x,z).id!==region)continue;
      add(species,x,z,(j===0?1.25:.55+random()*.6),random()*Math.PI*2,heightAt(x,z)-.06);
    }
  }
  // Outcrops form families: a buried parent boulder, scree, and vegetation in
  // sheltered gaps. Every member is checked against the route's walking space.
  for(let group=0;group<95;group++){
    const cx=random()*430-215,cz=random()*560-420;if(!clear(cx,cz,9))continue;
    const region=regionAt(cx,cz).id,large=region==='desert'||region==='crown'?3.5:1.6;
    for(let j=0;j<5;j++){
      const a=random()*Math.PI*2,r=j===0?0:random()*large*2,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r,s=j===0?large:.3+random()*large*.32;
      if(clear(x,z,5))add(`rock${(group+j)%3}`,x,z,[s,s*(.7+random()*.3),s],random()*6.28,heightAt(x,z)-s*.28);
    }
  }
  for(let patch=0;patch<165;patch++){
    const cx=random()*180-90,cz=random()*190-115;
    if(regionAt(cx,cz).id!=='meadow'&&regionAt(cx,cz).id!=='wood')continue;
    for(let j=0;j<15;j++){
      const a=random()*6.28,r=Math.sqrt(random())*4.5,x=cx+Math.cos(a)*r,z=cz+Math.sin(a)*r;
      if(pathDistance(x,z)<2.8||Math.hypot(x,z+48)<18||Math.hypot(x-38,z+23)<5)continue;
      add('groundcover',x,z,.65+random()*.45,random()*6.28,heightAt(x,z)-.04);
    }
  }
  // Opening overlook: an architectural frame, a hearth and a low mantle wall.
  add('arch',-6,25,1.35,.35);
  lamp(0,20); lamp(-8,24);
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
  // Walk-through rock hollow. Two exits, a clear floor, visible collision-sized roof.
  for(let i=0;i<8;i++){
    const z=-11-i*3.2, y=heightAt(38,z);
    for(const s of [-1,1]){add('rock1',38+s*3.4,z,[1.35,3,1.7],i*.5,y);box(38+s*3.4,y+2.4,z,2.6,5,3.4);}
    add('rock0',38,z,[3,1.2,1.5],i*.2,y+4.7);box(38,y+5.7,z,7,2,3.4);
    if(i%2===0)lamp(36,z,y);
  }
  add('arch',38,-10,1,0);add('arch',38,-37,1,0);
  // Regional monuments share a visual grammar, but never the same silhouette.
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
  // Adjacent cliffs conceal the world edge and give the final crown a mountain skyline.
  for(let i=0;i<17;i++){
    const x=-330+i*42,z=-470-Math.sin(i*1.6)*25;
    add('mountain',x,z,[31+(i%3)*6,46+(i%5)*13,38],i*2.4,heightAt(Math.max(-235,Math.min(235,x)),-460)-20);
  }
  return {props,solids,lights};
}
