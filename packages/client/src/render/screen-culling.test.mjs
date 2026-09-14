import {expect,test} from 'vitest';
import {PerspectiveCamera} from '@woosh/meep-engine/src/shade/renderer/camera/PerspectiveCamera.js';
import {t64_look_rotation} from '@woosh/meep-engine/src/engine/ecs/transform/t64_look_rotation.js';
import {actorScreenSphere,sphereScreenArea,ScreenCullState,CHARACTER_CULL,CLOTH_CULL} from './screen-culling.mjs';

function lens(){
  const camera=new PerspectiveCamera();camera.fov=Math.PI/2;camera.aspect=2;camera.near=.12;camera.far=500;
  t64_look_rotation(camera.transform,0,0,-1,0,1,0);camera.update();return camera;
}

test('sphere projection measures viewport fraction and responds to distance, lens and aspect',()=>{
  const camera=lens(),sphere=[0,0,-10,1],area=sphereScreenArea(sphere,camera);
  // On axis the projected circle has squared radius r²/(depth²-r²).
  expect(area).toBeCloseTo(Math.PI/(99*8),10);
  expect(sphereScreenArea([0,0,-20,2],camera)).toBeCloseTo(area,10);
  expect(sphereScreenArea([0,0,-20,1],camera)).toBeLessThan(area/3.9);
  camera.aspect=1;camera.update();expect(sphereScreenArea(sphere,camera)).toBeCloseTo(area*2,10);
  camera.fov=Math.PI/3;camera.update();expect(sphereScreenArea(sphere,camera)).toBeCloseTo(area*6,10);
  expect(sphereScreenArea(sphere,null)).toBe(1);
});

test('frustum culling rejects side, rear and far spheres while retaining intersecting bounds',()=>{
  const camera=lens();
  for(const sphere of [[100,0,-10,1],[0,100,-10,1],[0,0,10,1]])expect(sphereScreenArea(sphere,camera)).toBe(0);
  expect(sphereScreenArea([20.5,0,-10,1],camera)).toBeGreaterThan(0);
  expect(sphereScreenArea([100,0,-10,1],camera,{frustum:false})).toBeGreaterThan(0);
  expect(sphereScreenArea([0,0,10,1],camera,{frustum:false})).toBeCloseTo(sphereScreenArea([0,0,-10,1],camera),10);
  expect(sphereScreenArea([0,0,0,.1],camera,{frustum:false})).toBe(1);
  // Meep perspective has an infinite far plane; finite supplied planes work too.
  camera.frustum.set([0,0,1,500],20);
  expect(sphereScreenArea([0,0,-510,1],camera)).toBe(0);
});

test('near and eye plane intersections cannot collapse to zero or NaN',()=>{
  const camera=lens();
  for(const sphere of [[0,0,-1,1],[0,0,0,1],[0,0,-.15,.1]]){
    const area=sphereScreenArea(sphere,camera);expect(Number.isFinite(area)).toBe(true);expect(area).toBeGreaterThan(0);
  }
  expect(sphereScreenArea([0,0,-1,1],camera)).toBe(1);
  expect(sphereScreenArea([0,0,0,.1],camera)).toBe(0);
});

test('actor spheres follow feet, archetype and keeper scale without weapon reach',()=>{
  const actor={x:3,y:.845,z:-20};
  expect(actorScreenSphere(actor)).toEqual([3,.95,-20,.95]);
  expect(actorScreenSphere({...actor,archetype:'hound'})).toEqual([3,.75,-20,.75]);
  expect(actorScreenSphere({...actor,boss:true,y:1.2675})).toEqual([3,.95*1.85,-20,.95*1.85]);
  expect(actorScreenSphere({...actor,crouch:true,y:.495})).toEqual([3,.95,-20,.95]);
});

test.each([CHARACTER_CULL,CLOTH_CULL])('thresholds retain state in the deadband and activate immediately above enter (%o)',policy=>{
  const state=new ScreenCullState(),middle=(policy.exit+policy.enter)/2;
  expect(state.update(middle,.1,policy)).toBe(false);
  expect(state.update(policy.enter,0,policy)).toBe(true);
  for(let i=0;i<20;i++)expect(state.update(middle,.1,policy)).toBe(true);
  for(let i=0;i<Math.ceil(policy.delay/.1)-1;i++)expect(state.update(0,.1,policy)).toBe(true);
  expect(state.update(0,.1,policy)).toBe(false);
  expect(state.update(middle,.1,policy)).toBe(false);
  expect(state.update(policy.enter,0,policy)).toBe(true);
});

test('dwell must be uninterrupted and invalid time or a single stall cannot retire an active object',()=>{
  const state=new ScreenCullState(),policy=CLOTH_CULL;
  state.update(1,0,policy);
  for(const dt of [0,-1,NaN,Infinity])expect(state.update(0,dt,policy)).toBe(true);
  expect(state.update(0,100,policy)).toBe(true);
  expect(state.update(0,.1,policy)).toBe(true);
  expect(state.update(policy.exit,.1,policy)).toBe(true);
  expect(state.update(0,.1,policy)).toBe(true);
  expect(state.update(0,.1,policy)).toBe(true);
  expect(state.update(0,.1,policy)).toBe(false);
});
