import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {encodeTerrain,decodeTerrain,loadTerrain,TERRAIN_GRID} from './terrain-data.mjs';
import {generateTerrain} from './terrain-authoring.mjs';
import {heightAt,terrainSurface,WORLD_BOUNDS,pathDistance,landmarkPosition,SPIRE_COURT} from './regions.mjs';
import {buildLayout} from './layout.mjs';
import {generateLayout} from './layout-authoring.mjs';
import {CAVES} from './interiors.mjs';
import colliders from '../content/colliders.json' with {type:'json'};

test('shipped terrain and layout match the deterministic native authoring bake',async()=>{
  const bytes=await readFile(new URL('../content/terrain.bin',import.meta.url));
  expect(bytes.equals(Buffer.from(encodeTerrain(generateTerrain())))).toBe(true);
  const {sampler, vertices} = await loadTerrain();
  const count = TERRAIN_GRID.cols * TERRAIN_GRID.rows;
  expect(sampler.width).toBe(TERRAIN_GRID.cols);
  expect(sampler.height).toBe(TERRAIN_GRID.rows);
  expect(sampler.itemSize).toBe(1);
  expect(sampler.data).toBeInstanceOf(Float32Array);
  expect(vertices).toBeInstanceOf(Float32Array);
  expect(sampler.data).toHaveLength(count);
  expect(vertices).toHaveLength(count);
  expect(sampler.data.every(Number.isFinite)).toBe(true);
  expect(vertices.every(Number.isFinite)).toBe(true);
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

test('terrain from another world or serialization format requires rebuilding',()=>{
  const bytes=encodeTerrain(terrainSurface()).slice().buffer;
  new DataView(bytes).setUint32(4,0,true);
  expect(()=>decodeTerrain(bytes)).toThrow('world version');
  const incompatible=encodeTerrain(terrainSurface()).slice().buffer;
  new DataView(incompatible).setUint32(0,0,true);
  expect(()=>decodeTerrain(incompatible)).toThrow('needs rebuilding');
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

test('the circular abbey arcade has no detached straight wall strips or buttresses',()=>{
  const abbey=generateLayout().props.filter(({position:[x,,z]})=>Math.hypot(x,z+48)<25);
  expect(abbey.filter(({model})=>model==='abbeyWall'||model==='buttress')).toEqual([]);
  expect(abbey.some(({model})=>model==='bellTower')).toBe(true);
  expect(abbey.filter(({model})=>model==='arch')).toHaveLength(17);
});

test('the spire stands beside the road fork on continuous broad stone footings',()=>{
  const {props}=buildLayout(),[x,z]=SPIRE_COURT.monument,junction=landmarkPosition('spire');
  const columns=props.filter(p=>p.model==='column'&&p.position[0]===x&&p.position[2]===z).sort((a,b)=>a.position[1]-b.position[1]);
  expect(columns).toHaveLength(5);
  const base=columns[0];
  expect(Math.hypot(base.position[0]-junction[0],base.position[2]-junction[2])).toBeGreaterThan(12);
  expect(pathDistance(base.position[0],base.position[2])).toBeGreaterThan(8);
  const footings=props.filter(p=>p.model==='block'&&p.position[0]===x&&p.position[2]===z&&p.scale[0]>=base.scale[0]*2&&p.scale[2]>=base.scale[2]*2).sort((a,b)=>a.position[1]-b.position[1]);
  expect(footings.length).toBeGreaterThanOrEqual(2);
  expect(footings[0].position[1]).toBeLessThan(heightAt(x,z));
  for(let i=1;i<footings.length;i++){
    const lower=footings[i-1],upper=footings[i];
    expect(lower.position[1]+lower.scale[1]).toBeCloseTo(upper.position[1],5);
    expect(lower.scale[0]).toBeGreaterThanOrEqual(upper.scale[0]);
    expect(lower.scale[2]).toBeGreaterThanOrEqual(upper.scale[2]);
  }
  expect(footings.at(-1).position[1]+footings.at(-1).scale[1]).toBeCloseTo(base.position[1],5);
});

test('the spire paving and monument foundation rest on a flat terrain terrace',()=>{
  const {props}=buildLayout(),[cx,cz]=SPIRE_COURT.center,[mx,mz]=SPIRE_COURT.monument;
  const paving=props.find(p=>p.model==='abbeyFloor'&&p.position[0]===cx&&p.position[2]===cz);
  const foundation=props.filter(p=>p.model==='block'&&p.position[0]===mx&&p.position[2]===mz).sort((a,b)=>b.scale[0]-a.scale[0])[0];
  expect(paving).toBeDefined();expect(foundation).toBeDefined();
  for(const prop of [paving,foundation]){
    const vertices=colliders[prop.model].flatMap(part=>part.vertices),xs=vertices.filter((_,i)=>i%3===0),zs=vertices.filter((_,i)=>i%3===2);
    const x0=Math.min(...xs)*prop.scale[0],x1=Math.max(...xs)*prop.scale[0],z0=Math.min(...zs)*prop.scale[2],z1=Math.max(...zs)*prop.scale[2];
    for(const u of [0,.25,.5,.75,1])for(const v of [0,.25,.5,.75,1]){
      const x=prop.position[0]+x0+(x1-x0)*u,z=prop.position[2]+z0+(z1-z0)*v;
      expect(heightAt(x,z),`${prop.model} support at ${x},${z}`).toBeCloseTo(SPIRE_COURT.elevation,2);
    }
  }
});

test('the burial passage has level cross-sections beneath the authored rock vault',()=>{
  const {sampler}=generateTerrain();
  const sample=(x,z)=>sampler.sampleChannelCatmullRomUV((x+240)/480,(z+480)/640,0)-15;
  for(const cave of CAVES)for(const [x,z,width] of cave.sections.slice(1,-1)){
    const ys=[-.6,0,.6].map(t=>sample(x+t*width,z));
    expect(Math.max(...ys)-Math.min(...ys)).toBeLessThan(.06);
  }
});
