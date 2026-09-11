import {expect,test} from 'vitest';
import {AcousticSourceState} from '@woosh/meep-engine/src/engine/sound/simulation/core/AcousticSourceState.js';
import {AcousticSolution} from '@woosh/meep-engine/src/engine/sound/simulation/core/AcousticSolution.js';
import {AcousticProbeField} from '@woosh/meep-engine/src/engine/sound/simulation/probe/AcousticProbeField.js';
import {RayHit} from '@woosh/meep-engine/src/engine/sound/simulation/core/RayHit.js';
import {Ray3} from '@woosh/meep-engine/src/core/geom/3d/ray/Ray3.js';
import {createWorldAcoustics,AcousticTerrain} from './acoustics.mjs';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {HeightMapShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/HeightMapShape3D.js';
import {buildAcousticTerrainSurface} from './acoustic-terrain-authoring.mjs';
import {encodeAcousticTerrainSurface,decodeAcousticTerrainSurface} from './acoustic-terrain-data.mjs';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {heightAt,WORLD_VERSION} from './regions.mjs';
import baked from '../content/acoustic-probes.json' with {type:'json'};

test('baked native terrain BVH handles world-spanning rays without rebuilding or resampling the heightfield',()=>{
  const sampler=new Sampler2D(new Float32Array(241*321).fill(40),1,241,321);
  const authored=buildAcousticTerrainSurface({vertices:sampler.data,cols:241,rows:321,width:480,depth:640,offset:0});
  const bytes=encodeAcousticTerrainSurface(authored),surface=decodeAcousticTerrainSurface(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const tree=surface.__raycast_blas,terrain=new AcousticTerrain(HeightMapShape3D.from(sampler,480,101,640),surface);
  sampler.sampleChannelCatmullRomUV=()=>{throw new Error('Ray query resampled terrain');};
  const length=Math.hypot(478,100,638),ray=new Ray3(),hit=new Float32Array(6);
  for(const sign of [-1,1]){
    ray.set([-239*sign,100,-319*sign,478*sign/length,-100/length,638*sign/length,length]);
    expect(terrain.raycast(hit,ray)).toBe(true);expect(hit[0]).toBeCloseTo(47.8*sign,3);expect(hit[1]).toBeCloseTo(40,4);expect(hit[2]).toBeCloseTo(63.8*sign,3);
    expect(hit[4]).toBeCloseTo(1,6);
  }
  ray.set([-400,50,-500,-1,0,0,Infinity]);expect(terrain.raycast(hit,ray)).toBe(false);
  expect(surface.__raycast_blas).toBe(tree);expect(tree.size).toBe(authored.__raycast_blas.size);expect(surface.surface_area).toBe(authored.surface_area);
  const stale=bytes.slice(),buffer=new BinaryBuffer();buffer.fromArrayBuffer(stale.buffer);buffer.writeUint32(WORLD_VERSION-1);
  expect(()=>decodeAcousticTerrainSurface(stale.buffer)).toThrow('needs rebuilding');
  expect(()=>decodeAcousticTerrainSurface(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength-10))).toThrow('Malformed');
});

test('native acoustics distinguish an open doorway, stone partition, stacked floor and canonical terrain',async()=>{
  const {simulator,bodies}=await createWorldAcoustics();expect(bodies).toBe(baked.bodies);expect(simulator.pathing).toBe(false);
  const solve=(listener,source)=>{const out=new AcousticSolution(),state=new AcousticSourceState();for(let i=0;i<12;i++)simulator.solveFor(listener,source,.05,state,out);return out;};
  const open=solve([35,5.8,-55],[28,5.8,-55]);expect(open.occlusion).toBeLessThan(.05);
  const wall=solve([35,5.8,-53],[28,5.8,-53]);expect(wall.occlusion).toBeGreaterThan(.95);expect(wall.transmission[0]).toBeGreaterThan(wall.transmission[2]);expect(wall.transmission[2]).toBeLessThan(.01);
  const floor=solve([38,10.6,-66],[38,5.8,-66]);expect(floor.occlusion).toBeGreaterThan(.95);expect(floor.hasPath).toBe(false);
  for(const [x,z] of [[-201.3,122.6],[140.2,44.9],[-29.4,-196.3]]){
    const y=heightAt(x,z),hit=new RayHit(),ray=new Ray3();ray.set([x,y+.5,z,0,-1,0,1]);expect(simulator.occluderIndex.closestHit(ray,hit)).toBe(true);expect(hit.position[1]).toBeCloseTo(y,4);
  }
});

test('baked reverb selects visible probes on the correct dungeon storey without a pathing graph',async()=>{
  const {simulator}=await createWorldAcoustics(),field=new AcousticProbeField();field.fromJSON(baked.field);
  expect(baked.worldVersion).toBe(WORLD_VERSION);expect(field.hasVisibility).toBe(false);expect(field.size).toBeGreaterThan(500);
  const lower=field.nearestVisibleIndex(38,5.8,-66,simulator.occluderIndex),upper=field.nearestVisibleIndex(38,10.6,-72,simulator.occluderIndex);
  expect(field.probeY(lower)).toBeLessThan(8);expect(field.probeY(upper)).toBeGreaterThan(10);
  expect(field.reverbBand(lower,0)).toBeGreaterThan(field.reverbBand(lower,2));expect(field.reverbDecay(upper)).toBeGreaterThan(.3);
  for(const probe of baked.field.probes)for(const value of [...probe.reverbDecay,...probe.reverbDirection])expect(Number.isFinite(value)).toBe(true);
});
