import { heightAt, pathDistance, regionAt, landmarkPosition } from './regions.mjs';

export function buildLayout() {
  const props=[], solids=[], lights=[];
  let seed=4171;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const add=(model,x,z,scale=1,yaw=0,y=heightAt(x,z))=>{ const p={model,position:[x,y,z],scale:Array.isArray(scale)?scale:[scale,scale,scale],yaw};props.push(p);return p; };
  const box=(x,y,z,w,h,d)=>solids.push({position:[x,y,z],size:[w,h,d]});
  const lamp=(x,z,y=heightAt(x,z))=>{add('brazier',x,z,1,0,y);lights.push([x,y+1.25,z]);};
  for(let tx=-3;tx<3;tx++)for(let tz=-6;tz<2;tz++)add(`terrain_${tx}_${tz}`,0,0,1,0,0);
  for(let i=0;i<640;i++){
    const x=random()*440-220,z=random()*565-420;
    const near=pathDistance(x,z), region=regionAt(x,z).id;
    if(near<6 || Math.hypot(x,z+48)<19 || Math.hypot(x-38,z+15)<15)continue;
    const model=region==='magic'?'magicTree':region==='tundra'?'winterTree':region==='desert'||region==='crown'?`rock${i%3}`:i%3===0?'pine':'tree';
    const scale=model.startsWith('rock')?2+random()*5:.6+random()*.85;
    add(model,x,z,scale,random()*Math.PI*2);
    if(!model.startsWith('rock'))box(x,heightAt(x,z)+2,z,.6*scale,4,.6*scale);
  }
  for(let i=0;i<750;i++){
    const x=random()*160-80,z=random()*180-105;
    if(pathDistance(x,z)<3.2 || Math.hypot(x,z+48)<17)continue;
    add(i%8===0?'flowers':'grass',x,z,.7+random()*.8,random()*6.28);
  }
  for(let i=0;i<80;i++){
    const x=random()*180-90,z=random()*190-120;
    if(pathDistance(x,z)>6)add(`rock${i%3}`,x,z,.3+random()*.9,random()*6.28);
  }
  // Opening overlook: an architectural frame, a hearth and a low mantle wall.
  add('arch',-6,25,1.35,.35);
  lamp(0,20); lamp(-8,24);
  for(let i=0;i<4;i++) {add('block',8+i,15,[1,.9,1]);box(8+i,heightAt(8+i,15)+.45,15,1,.9,1);}
  // Circular abbey, with south and north gates open to late arrivals.
  const floor=heightAt(0,-48);
  add('block',0,-48,[30,.65,30],0,floor-.55);box(0,floor-.225,-48,30,.65,30);
  for(let i=0;i<20;i++){
    const a=i*Math.PI*2/20,x=Math.sin(a)*16,z=-48+Math.cos(a)*16;
    if(i%5!==0){add('column',x,z,1.25,-a,floor);add('arch',x,z,1,-a,floor+4.2);box(x,floor+3,z,1.2,6,1.2);}
    if(i%2===0)lamp(x*.85,-48+(z+48)*.85,floor);
  }
  add('halo',0,-57,1.7,0,floor+12);
  add('arch',0,-32,1.55,0,floor);
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
  const [cx,,]=landmarkPosition('halo'),cz=-370,cy=heightAt(cx,cz);
  // Open mountain courtyard: keep the naturally walkable slope through the gates.
  for(let i=-2;i<=2;i++){
    add('column',cx+i*6,cz, [2,7-Math.abs(i),2],0,cy+.1);
    add('arch',cx+i*6,cz+12,1.5,0,cy+.1);
  }
  add('halo',0,-373,6,0,cy+58);
  for(let i=0;i<8;i++)lamp(-14+i*4,-351);
  return {props,solids,lights};
}
