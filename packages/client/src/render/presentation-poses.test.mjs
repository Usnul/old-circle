import {expect,test} from 'vitest';
import {PresentationPoses} from './presentation-poses.mjs';
test('Meep pose interpolation gives continuous travel and shortest-arc facing',()=>{
  const poses=new PresentationPoses(),a={id:'player',x:0,y:1,z:0,yaw:Math.PI-.05};
  poses.accept({actors:[a]},0);const b={...a,x:.12,yaw:-Math.PI+.05};poses.accept({actors:[b]},1/30);
  const p=poses.sample(b,.05);expect(p.x).toBeCloseTo(.06);expect(Math.abs(p.yaw)).toBeCloseTo(Math.PI);
});
test('a respawn snaps without interpolating through the world',()=>{
  const poses=new PresentationPoses(),a={id:'player',x:0,y:1,z:0,yaw:0};poses.accept({actors:[a]},0);
  const b={...a,x:100};poses.accept({actors:[b]},1/30);expect(poses.sample(b,.04).x).toBe(100);
});

test('fixed simulation frames keep walking smooth under uneven Worker message arrival',()=>{
  const poses=new PresentationPoses(),arrivals=Array.from({length:90},(_,i)=>({frame:i*2,time:i/30+[0,.008,.002,.016,.004][i%5]}));
  let index=0,actor,previous;const speeds=[];
  for(let time=0;time<2.8;time+=1/120){
    while(index<arrivals.length&&arrivals[index].time<=time){const {frame,time:arrival}=arrivals[index++];actor={id:'player',x:frame/60*3.5,y:1,z:0,yaw:0};poses.accept({actors:[actor],presentationFrame:frame,presentationEpoch:1},arrival);}
    if(!actor)continue;const current=poses.sample(actor,time).x;
    if(time>.3&&previous!==undefined)speeds.push((current-previous)*120);previous=current;
  }
  expect(Math.min(...speeds)).toBeGreaterThan(3);expect(Math.max(...speeds)).toBeLessThan(4);
  const returning={...actor,x:12};poses.accept({actors:[returning],presentationFrame:200000,presentationEpoch:2},3);
  expect(poses.sample(returning,3).x).toBe(12);
});

test('ragdoll joints use the same delayed Meep timeline and expire from the key table',()=>{
  const poses=new PresentationPoses(),a={key:'enemy:18',joints:[{position:[0,2,0],rotation:[0,0,0,1]}]};
  poses.accept({actors:[],ragdolls:[a]},0);
  const b={...a,joints:[{position:[.2,1.8,0],rotation:[0,0,Math.sin(.1),Math.cos(.1)]}]};poses.accept({actors:[],ragdolls:[b]},1/30);
  const p=poses.corpse(b,.05).joints[0];expect(p.position[0]).toBeCloseTo(.1);expect(p.position[1]).toBeCloseTo(1.9);expect(p.rotation[2]).toBeCloseTo(Math.sin(.05));
  for(let i=0;i<18;i++)poses.accept({actors:[]},(i+2)/30);expect(poses.keys.size).toBe(0);
});
