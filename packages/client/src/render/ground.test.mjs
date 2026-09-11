import {expect,test,vi} from 'vitest';
import {WorldGround} from './ground.mjs';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {WORLD_BOUNDS} from '@old-circle/game/world/regions.mjs';

// These CPU sampling checks do not create terrain render passes or a GPU device.
vi.mock('@woosh/meep-engine/src/engine/graphics3/TerrainSystem.js',()=>({TerrainExtension:class{}}));
vi.mock('@woosh/meep-engine/src/engine/graphics3/terrain/GPUTerrainSplatRenderer.js',()=>({GPUTerrainSplatRenderer:class{}}));

function ground(layers,width=1,height=1){
  const result=new WorldGround();result.manifest={layers:Object.keys(layers),width,height};
  result.weightSamplers=Object.values(layers).map(values=>new Sampler2D(Float64Array.from(Array.isArray(values)?values:[values]),1,width,height));
  return result;
}
const point=(u=.5,v=.5)=>[WORLD_BOUNDS.minX+u*WORLD_BOUNDS.width,WORLD_BOUNDS.minZ+v*WORLD_BOUNDS.depth];
const sample=g=>g.surfaceMixAt(...point());

test('bilinear splat sampling blends both axes at texel centres',()=>{
  const g=ground({meadow:[100,0,20,80],desert:[0,100,80,20]},2,2);
  expect(g.surfaceMixAt(...point(.25,.25))).toEqual([{surface:'grass',weight:1}]);
  expect(g.surfaceMixAt(...point(.75,.25))).toEqual([{surface:'sand',weight:1}]);
  // Pixel coordinates (.25, .5) interpolate the four corners to 55/45.
  const mix=g.surfaceMixAt(...point(.375,.5));
  expect(mix.map(entry=>entry.surface)).toEqual(['grass','sand']);
  expect(mix[0].weight).toBeCloseTo(.55,10);expect(mix[1].weight).toBeCloseTo(.45,10);
});

test('world edges and coordinates beyond them clamp to the edge texels',()=>{
  const g=ground({meadow:[100,0,0,100],desert:[0,100,100,0]},2,2);
  for(const [u,v,surface] of [[0,0,'grass'],[1,0,'sand'],[0,1,'sand'],[1,1,'grass'],[-2,-3,'grass'],[2,-1,'sand'],[-1,2,'sand'],[3,2,'grass']]){
    expect(g.surfaceMixAt(...point(u,v))).toEqual([{surface,weight:1}]);
  }
});

test.each([['meadow','grass'],['wood','grass'],['desert','sand'],['magic','stone'],['tundra','snow'],['crown','stone'],['road','gravel']])('%s is a normalized single %s material', (layer,surface)=>{
  const g=ground({[layer]:17});
  expect(sample(g)).toEqual([{surface,weight:1}]);expect(g.surfaceAt(...point())).toBe(surface);
});

test('biome aliases combine before selecting the dominant material',()=>{
  expect(sample(ground({meadow:35,wood:35,desert:30}))).toEqual([{surface:'grass',weight:1}]);
  expect(sample(ground({magic:35,crown:35,tundra:30}))).toEqual([{surface:'stone',weight:1}]);
  const mix=sample(ground({meadow:25,wood:25,desert:45,tundra:5}));
  expect(mix.map(entry=>entry.surface)).toEqual(['grass','sand']);
  expect(mix[0].weight).toBeCloseTo(50/95,10);expect(mix[1].weight).toBeCloseTo(45/95,10);
});

test('a third material contributes to dominance before the selected pair is normalized',()=>{
  const mix=sample(ground({meadow:60,desert:25,tundra:15}));
  expect(mix.map(entry=>entry.surface)).toEqual(['grass','sand']);
  expect(mix[0].weight).toBeCloseTo(60/85,10);expect(mix[1].weight).toBeCloseTo(25/85,10);
  expect(mix.reduce((sum,entry)=>sum+entry.weight,0)).toBeCloseTo(1,10);
});

test('exactly 66 percent blends, while a share just above 66 percent stands alone',()=>{
  const mix=sample(ground({meadow:66,desert:20,tundra:14}));
  expect(mix.map(entry=>entry.surface)).toEqual(['grass','sand']);
  expect(mix[0].weight).toBeCloseTo(66/86,10);expect(mix[1].weight).toBeCloseTo(20/86,10);
  expect(sample(ground({meadow:66.0001,desert:20,tundra:13.9999}))).toEqual([{surface:'grass',weight:1}]);
});

test('ties use the same material order regardless of biome layer order',()=>{
  const expected=[{surface:'grass',weight:.5},{surface:'sand',weight:.5}];
  expect(sample(ground({tundra:1,desert:1,meadow:1}))).toEqual(expected);
  expect(sample(ground({meadow:1,desert:1,tundra:1}))).toEqual(expected);
  expect(sample(ground({wood:.5,desert:1,meadow:.5,tundra:1}))).toEqual(expected);
});

test('invalid, zero and unrecognized layer weights do not dilute valid materials',()=>{
  expect(sample(ground({meadow:0,wood:NaN,desert:-1,magic:Infinity,tundra:12,crown:-Infinity,unknown:200}))).toEqual([{surface:'snow',weight:1}]);
});

test('no usable material weights fall back to stone',()=>{
  expect(sample(ground({meadow:0,wood:NaN,desert:-1,magic:Infinity,unknown:200}))).toEqual([{surface:'stone',weight:1}]);
  expect(sample(ground({}))).toEqual([{surface:'stone',weight:1}]);
});
