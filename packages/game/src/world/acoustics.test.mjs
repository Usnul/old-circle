import {expect,test,vi} from 'vitest';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {HeightMapShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/HeightMapShape3D.js';
import {Ray3} from '@woosh/meep-engine/src/core/geom/3d/ray/Ray3.js';
import {ACOUSTIC_MATERIALS,materialForModel} from './acoustics.mjs';
import {buildLayout} from './layout.mjs';

test('every authored scenery model maps to a three-band acoustic material',()=>{
  const models=new Set(buildLayout().props.map(prop=>prop.model));
  expect(models.size).toBeGreaterThan(20);
  const known=new Set(Object.values(ACOUSTIC_MATERIALS));
  for(const model of models)expect(known.has(materialForModel(model))).toBe(true);
  for(const material of known){
    for(const band of [0,1,2]){
      expect(material.absorption[band]).toBeGreaterThanOrEqual(0);expect(material.absorption[band]).toBeLessThanOrEqual(1);
      expect(material.transmission[band]).toBeGreaterThanOrEqual(0);expect(material.transmission[band]).toBeLessThanOrEqual(1);
    }
    // Walls and plants pass more bass than treble.
    expect(material.transmission[0]).toBeGreaterThanOrEqual(material.transmission[2]);
  }
});

test('terrain, masonry, timber, snow and plants are distinguished',()=>{
  expect(materialForModel('terrain')).toBe(ACOUSTIC_MATERIALS.ground);
  expect(materialForModel('terrain_-2_1')).toBe(ACOUSTIC_MATERIALS.ground);
  expect(materialForModel('abbeyWall')).toBe(ACOUSTIC_MATERIALS.stone);
  expect(materialForModel('fallenTrunk')).toBe(ACOUSTIC_MATERIALS.wood);
  expect(materialForModel('pine')).toBe(ACOUSTIC_MATERIALS.wood);
  expect(materialForModel('frostRock2')).toBe(ACOUSTIC_MATERIALS.snow);
  expect(materialForModel('bracken')).toBe(ACOUSTIC_MATERIALS.foliage);
  // Foliage lets most sound through; masonry does not.
  expect(ACOUSTIC_MATERIALS.foliage.transmission[1]).toBeGreaterThan(ACOUSTIC_MATERIALS.stone.transmission[1]*10);
});

test('native terrain rays cross only a linear number of cells across the world',()=>{
  const sampler=new Sampler2D(new Float32Array(241*321).fill(40),1,241,321);
  const terrain=HeightMapShape3D.from(sampler,480,101,640);
  const sample=vi.spyOn(sampler,'sampleChannelCatmullRomUV');
  const length=Math.hypot(478,100,638),ray=new Ray3(),hit=new Float32Array(6);
  for(const sign of [-1,1]){
    sample.mockClear();
    ray.set([-239*sign,100,-319*sign,478*sign/length,-100/length,638*sign/length,length]);
    expect(terrain.raycast(hit,ray)).toBe(true);expect(hit[0]).toBeCloseTo(47.8*sign,3);expect(hit[1]).toBeCloseTo(40,4);expect(hit[2]).toBeCloseTo(63.8*sign,3);
    expect(hit[4]).toBeCloseTo(1,6);
    // Four corner samples per visited cell, bounded by crossed rows + columns.
    expect(sample.mock.calls.length).toBeGreaterThan(0);
    expect(sample.mock.calls.length).toBeLessThanOrEqual(4*(240+320));
  }
  ray.set([-400,50,-500,-1,0,0,Infinity]);expect(terrain.raycast(hit,ray)).toBe(false);
});
