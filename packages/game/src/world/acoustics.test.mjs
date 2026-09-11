import {expect,test} from 'vitest';
import {AcousticSourceState} from '@woosh/meep-engine/src/engine/sound/simulation/core/AcousticSourceState.js';
import {AcousticSolution} from '@woosh/meep-engine/src/engine/sound/simulation/core/AcousticSolution.js';
import {AcousticProbeField} from '@woosh/meep-engine/src/engine/sound/simulation/probe/AcousticProbeField.js';
import {RayHit} from '@woosh/meep-engine/src/engine/sound/simulation/core/RayHit.js';
import {Ray3} from '@woosh/meep-engine/src/core/geom/3d/ray/Ray3.js';
import {createWorldAcoustics} from './acoustics.mjs';
import {heightAt,WORLD_VERSION} from './regions.mjs';
import baked from '../content/acoustic-probes.json' with {type:'json'};

test('native acoustics distinguish an open doorway, stone partition, stacked floor and canonical terrain',()=>{
  const {simulator,bodies}=createWorldAcoustics();expect(bodies).toBe(baked.bodies);expect(simulator.pathing).toBe(false);
  const solve=(listener,source)=>{const out=new AcousticSolution(),state=new AcousticSourceState();for(let i=0;i<12;i++)simulator.solveFor(listener,source,.05,state,out);return out;};
  const open=solve([35,5.8,-55],[28,5.8,-55]);expect(open.occlusion).toBeLessThan(.05);
  const wall=solve([35,5.8,-53],[28,5.8,-53]);expect(wall.occlusion).toBeGreaterThan(.95);expect(wall.transmission[0]).toBeGreaterThan(wall.transmission[2]);expect(wall.transmission[2]).toBeLessThan(.01);
  const floor=solve([38,10.6,-66],[38,5.8,-66]);expect(floor.occlusion).toBeGreaterThan(.95);expect(floor.hasPath).toBe(false);
  for(const [x,z] of [[-201.3,122.6],[140.2,44.9],[-29.4,-196.3]]){
    const y=heightAt(x,z),hit=new RayHit(),ray=new Ray3();ray.set([x,y+.5,z,0,-1,0,1]);expect(simulator.occluderIndex.closestHit(ray,hit)).toBe(true);expect(hit.position[1]).toBeCloseTo(y,4);
  }
});

test('baked reverb selects visible probes on the correct dungeon storey without a pathing graph',()=>{
  const {simulator}=createWorldAcoustics(),field=new AcousticProbeField();field.fromJSON(baked.field);
  expect(baked.worldVersion).toBe(WORLD_VERSION);expect(field.hasVisibility).toBe(false);expect(field.size).toBeGreaterThan(500);
  const lower=field.nearestVisibleIndex(38,5.8,-66,simulator.occluderIndex),upper=field.nearestVisibleIndex(38,10.6,-72,simulator.occluderIndex);
  expect(field.probeY(lower)).toBeLessThan(8);expect(field.probeY(upper)).toBeGreaterThan(10);
  expect(field.reverbBand(lower,0)).toBeGreaterThan(field.reverbBand(lower,2));expect(field.reverbDecay(upper)).toBeGreaterThan(.3);
  for(const probe of baked.field.probes)for(const value of [...probe.reverbDecay,...probe.reverbDirection])expect(Number.isFinite(value)).toBe(true);
});
