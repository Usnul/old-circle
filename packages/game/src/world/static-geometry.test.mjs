import {expect,test} from 'vitest';
import {staticGeometry} from './static-geometry.mjs';
import {CAVES} from './interiors.mjs';
import {heightAt} from './regions.mjs';

test('arch collision stones contain their interiors and leave the doorway open',()=>{
  const layout={props:[{model:'arch',position:[0,0,0],scale:[1,1,1],yaw:0}]};
  const stones=[...staticGeometry(layout)].filter(body=>body.model==='arch');
  expect(stones.length).toBeGreaterThanOrEqual(27);
  for(const {position,shape} of stones){
    // Each convex body is centred inside its own bounds. Inward face planes
    // reject this point even though the visible solid surrounds it.
    expect(shape.contains_point([0,0,0]),`stone at ${position}`).toBe(true);
    expect(shape.contains_point(position.map((v,i)=>[0,2,0][i]-v))).toBe(false);
  }
});

test('hillside burial chambers leave a continuous person-sized passage through both mouths',()=>{
  for(const cave of CAVES){
    const bodies=[...staticGeometry({props:[{model:cave.model,position:[0,0,0],scale:[1,1,1],yaw:0}]})];
    expect(bodies.length).toBeGreaterThan(0);
    for(let i=1;i<cave.sections.length;i++){
      const a=cave.sections[i-1],b=cave.sections[i];
      for(let step=0;step<=10;step++){
        const t=step/10,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
        // Foot clearance matters too: a proud threshold can seal the sampled
        // navigation surface while leaving the torso and head unobstructed.
        for(const offset of [-.6,0,.6])for(const rise of [.08,.85,1.8]){
          const point=[x+offset,heightAt(x+offset,z)+rise,z];
          for(const {position,shape} of bodies){
            expect(shape.contains_point(point.map((v,k)=>v-position[k])),`Rock obstructs passage at ${point}`).toBe(false);
          }
        }
      }
    }
  }
});
