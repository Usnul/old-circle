import {expect,test} from 'vitest';
import {LanternChain,hangingRotation} from './lantern-chain.mjs';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';

test.each([30,60,120])('short lantern links stay attached, sway and settle at %s fps',fps=>{
  const chain=new LanternChain(),dt=1/fps,distances=[.038,.038,.22];let excursion=0;
  for(let i=0;i<fps*3;i++){
    const anchor=[Math.sin(i*dt*6)*.05,1+Math.cos(i*dt*12)*.025,0];
    const points=chain.update(anchor,1,dt);for(let axis=0;axis<3;axis++)expect(points[0][axis]).toBeCloseTo(anchor[axis],12);
    excursion=Math.max(excursion,Math.abs(points[3][0]-anchor[0]));
    for(let j=1;j<4;j++)expect(Math.hypot(...points[j].map((v,k)=>v-points[j-1][k]))).toBeCloseTo(distances[j-1],6);
  }
  expect(excursion).toBeGreaterThan(.02);expect(excursion).toBeLessThan(.18);
  for(let i=0;i<fps*5;i++)chain.update([0,1,0],1,dt);
  expect(Math.abs(chain.points[3][0])).toBeLessThan(.008);
  const pose=chain.update([100,10,-50],1,dt);
  expect(pose[3][0]).toBeCloseTo(100);expect(pose[3][1]).toBeCloseTo(10-.296);
});

test('link orientations join the suspension endpoints in alternating planes',()=>{
  const from=[1,2,3],to=[1.01,1.96,3.012],distance=Math.hypot(...to.map((v,i)=>v-from[i]));
  for(const twist of [0,Math.PI/2]){
    const t=new Transform64();t.setRotation(...hangingRotation(from,to,twist));t.setTranslation(...from);t.updateMatrix();
    const end=new Vector3(0,-distance,0).applyMatrix4(t);
    expect(end.distanceTo(new Vector3(...to))).toBeLessThan(.000001);
  }
});
