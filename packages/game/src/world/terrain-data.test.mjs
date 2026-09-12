import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {encodeTerrain,decodeTerrain,loadTerrain} from './terrain-data.mjs';
import {generateTerrain} from './terrain-authoring.mjs';
import {heightAt,terrainSurface,WORLD_BOUNDS} from './regions.mjs';
import {buildLayout} from './layout.mjs';
import {generateLayout} from './layout-authoring.mjs';
import {CAVES} from './interiors.mjs';

test('shipped terrain and layout match the deterministic native authoring bake',async()=>{
  const bytes=await readFile(new URL('../content/terrain.bin',import.meta.url));
  expect(bytes.equals(Buffer.from(encodeTerrain(generateTerrain())))).toBe(true);
  expect(buildLayout()).toEqual(generateLayout());
});

test('terrain loads once and independent worlds cannot mutate the layout template',async()=>{
  expect(loadTerrain()).toBe(loadTerrain());
  expect(await loadTerrain()).toBe(terrainSurface());
  const first=buildLayout(),second=buildLayout();
  first.props[0].position[0]=999;first.solids.length=0;
  expect(second.props[0].position[0]).toBe(0);
  expect(buildLayout()).toEqual(second);
});

test('baked mesh vertices retain the native Catmull-Rom sampler and triangle split',()=>{
  const {sampler,vertices}=terrainSurface(),{minX,minZ}=WORLD_BOUNDS;
  let worst=0;
  for(let z=0;z<321;z++)for(let x=0;x<241;x++){
    const native=Math.fround(sampler.sampleChannelCatmullRomUV(x/240,z/320,0)-15);
    worst=Math.max(worst,Math.abs(native-vertices[z*241+x]));
  }
  expect(worst).toBe(0);
  for(const [x,z] of [[0,0],[100,175],[239,319]]){
    const k=z*241+x,a=vertices[k],b=vertices[k+1],c=vertices[k+241],d=vertices[k+242];
    expect(heightAt(minX+(x+.2)*2,minZ+(z+.3)*2)).toBeCloseTo(a+(b-a)*.2+(c-a)*.3,10);
    expect(heightAt(minX+(x+.8)*2,minZ+(z+.7)*2)).toBeCloseTo(d+(c-d)*.2+(b-d)*.3,10);
  }
  expect(heightAt(-999,-999)).toBe(vertices[0]);
  expect(heightAt(999,999)).toBe(vertices.at(-1));
});

test('bad bakes fail explicitly instead of generating terrain during loading',()=>{
  const bytes=encodeTerrain(terrainSurface()).slice().buffer;
  expect(()=>decodeTerrain(bytes.slice(0,-4))).toThrow('Malformed terrain');
  new DataView(bytes).setUint32(4,0,true);
  expect(()=>decodeTerrain(bytes)).toThrow('world version');
  const invalid=encodeTerrain(terrainSurface()).slice().buffer;
  new DataView(invalid).setFloat32(18,NaN,true);
  expect(()=>decodeTerrain(invalid)).toThrow('Invalid terrain heights');
});

test('native texture serialization preserves float32 subviews',()=>{
  const {sampler,vertices}=terrainSurface(),padded=new Float32Array(vertices.length+5);
  padded.set(vertices,5);
  const bytes=encodeTerrain({sampler,vertices:padded.subarray(5)}).slice().buffer;
  expect(decodeTerrain(bytes).vertices).toEqual(vertices);
});

test('arrival paving and abbey walls stand on level native terrain terraces',()=>{
  const {sampler}=generateTerrain();
  const sample=(x,z)=>sampler.sampleChannelCatmullRomUV((x+240)/480,(z+480)/640,0)-15;
  for(const x of [-6,0,8])for(const z of [12,20,28])expect(sample(x,z)).toBeCloseTo(8,3);
  for(const x of [-20,0,18])for(const z of [-34,-40])expect(sample(x,z)).toBeCloseTo(.65,2);
  // The gate's graded departure must remain a walkable approach, not a cliff.
  for(let z=-8;z<8;z+=2)expect(Math.abs(sample(2,z+2)-sample(2,z))/2).toBeLessThan(.8);
});

test('the burial passage has level cross-sections beneath the authored rock vault',()=>{
  const {sampler}=generateTerrain();
  const sample=(x,z)=>sampler.sampleChannelCatmullRomUV((x+240)/480,(z+480)/640,0)-15;
  for(const cave of CAVES)for(const [x,z,width] of cave.sections.slice(1,-1)){
    const ys=[-.6,0,.6].map(t=>sample(x+t*width,z));
    expect(Math.max(...ys)-Math.min(...ys)).toBeLessThan(.06);
  }
});
