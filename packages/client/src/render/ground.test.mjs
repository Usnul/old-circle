import {expect,test,vi} from 'vitest';
import {WorldGround} from './ground.mjs';
import {Sampler2D} from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import {WORLD_BOUNDS} from '@old-circle/game/world/regions.mjs';
import {TerrainShadeMaterial} from '@woosh/meep-engine/src/engine/graphics3/terrain/TerrainShadeMaterial.js';
import {buildLayout} from '@old-circle/game/world/layout.mjs';

function ground(layers,width=1,height=1){
  const result=new WorldGround();result.manifest={layers:Object.keys(layers),width,height};
  result.weightSamplers=Object.values(layers).map(values=>new Sampler2D(Float64Array.from(Array.isArray(values)?values:[values]),1,width,height));
  return result;
}
const point=(u=.5,v=.5)=>[WORLD_BOUNDS.minX+u*WORLD_BOUNDS.width,WORLD_BOUNDS.minZ+v*WORLD_BOUNDS.depth];
const sample=g=>g.surfaceMixAt(...point());

test('terrain material packs authored layers and shares the gameplay weight map origin',async()=>{
  const manifest={layers:['meadow','desert','magic','road'],width:1,height:1,layerSize:1,tileMetres:[2,4,8,16]};
  const images=new Map(manifest.layers.map((name,i)=>[name,Uint8ClampedArray.from([10+i,20+i,30+i,255])]));
  images.set('weights-0',Uint8ClampedArray.from([40,30,20,255]));images.set('weights-1',Uint8ClampedArray.from([10,0,0,255]));images.set('weights-2',new Uint8ClampedArray(4));
  vi.stubGlobal('fetch',async url=>({ok:true,json:async()=>manifest,blob:async()=>({width:1,height:1,data:images.get(url.split('/').at(-1).replace('.png','')),close(){}})}));
  vi.stubGlobal('createImageBitmap',async image=>image);
  vi.stubGlobal('OffscreenCanvas',class{getContext(){let image;return {drawImage(value){image=value;},getImageData(){return image;}};}});
  try{
    const g=new WorldGround(),material=g.material;await g.start();
    expect(g.material).toBe(material);expect(material).toBeInstanceOf(TerrainShadeMaterial);
    expect(Array.from(material.weights.data)).toEqual([40,30,20,10]);
    expect(Array.from(material.layers.data)).toEqual(manifest.layers.flatMap(name=>Array.from(images.get(name))));
    expect(material.layer_count).toBe(4);expect(material.layer_scales_version).toBeGreaterThan(0);expect(material.version).toBeGreaterThan(0);
    const uniform=material.template.uniform_value(material),{minX,minZ,width,depth}=WORLD_BOUNDS;
    for(const [x,z,u,v] of [[minX,minZ,0,0],[minX+width/2,minZ+depth/2,.5,.5],[minX+width,minZ+depth,1,1]]){
      expect((x-uniform.grid_transform[2])*uniform.inv_world_size[0]).toBeCloseTo(u,6);
      expect((z-uniform.grid_transform[3])*uniform.inv_world_size[1]).toBeCloseTo(v,6);
    }
    expect(Array.from(material.layer_scales)).toEqual(manifest.tileMetres.flatMap(size=>[width/size,depth/size]));
    expect(sample(g)).toEqual([{surface:'grass',weight:4/7},{surface:'sand',weight:3/7}]);
  }finally{vi.unstubAllGlobals();}
});

test('authored terrain placements preserve the material geometry-space mapping',()=>{
  const tiles=buildLayout().props.filter(p=>p.model.startsWith('terrain_'));expect(tiles.length).toBeGreaterThan(0);
  for(const tile of tiles){expect(tile.position).toEqual([0,0,0]);expect(tile.scale).toEqual([1,1,1]);expect(tile.yaw).toBe(0);}
});

test('terrain binds the authored normal map alongside native splat textures',async()=>{
  const [{SoftwareGPUDevice},{TextureManager},{GPUSamplerManager},{ShadeImage},{ShadeTexture},{ColorSpace},{sampler_descriptor_from_shade_texture}]=await Promise.all([
    import('@woosh/meep-engine/src/shade/device/mock/SoftwareGPUDevice.js'),
    import('@woosh/meep-engine/src/shade/renderer/texture/TextureManager.js'),
    import('@woosh/meep-engine/src/shade/renderer/GPUSamplerManager.js'),
    import('@woosh/meep-engine/src/shade/renderer/texture/source/ShadeImage.js'),
    import('@woosh/meep-engine/src/shade/renderer/texture/ShadeTexture.js'),
    import('@woosh/meep-engine/src/shade/renderer/texture/ColorSpace.js'),
    import('@woosh/meep-engine/src/shade/renderer/texture/sampler_descriptor_from_shade_texture.js'),
  ]);
  vi.stubGlobal('GPUBufferUsage',{MAP_READ:1,MAP_WRITE:2,COPY_SRC:4,COPY_DST:8,INDEX:16,VERTEX:32,UNIFORM:64,STORAGE:128,INDIRECT:256,QUERY_RESOLVE:512});
  vi.stubGlobal('GPUTextureUsage',{COPY_SRC:1,COPY_DST:2,TEXTURE_BINDING:4,STORAGE_BINDING:8,RENDER_ATTACHMENT:16});
  const device=new SoftwareGPUDevice(),textures=new TextureManager(device),samplers=new GPUSamplerManager(device),material=new WorldGround().material;
  const pixels=Sampler2D.uint8(4,1,1);pixels.data.set([160,128,251,255]);
  const image=ShadeImage.fromSampler2D(pixels);image.color_space=ColorSpace.None;material.texture_normal=ShadeTexture.from(image);
  const template=material.template,ctx={source:material,textures:new Map(),state:null,uniform_buffer:device.createBuffer({size:template.uniform_type.size,usage:GPUBufferUsage.UNIFORM})};
  const services={device,textures,samplers};
  try{
    template.build(ctx,services);
    const layout=device.createBindGroupLayout(template.resources.generateBindGroupLayoutDescriptor());
    const group=template.create_bind_group(ctx,layout,services);expect(group.isValid).toBe(true);
    const binding=name=>group.entries.find(entry=>entry.binding===template.resources.resources.find(resource=>resource.name===name).binding_index).resource;
    const normal=textures.obtain(material.texture_normal);
    expect(normal.descriptor.format).toBe('rgba8unorm');expect(binding('texture_normal')).toBe(normal.obtainView());
    expect(binding('texture_normal_sampler')).toBe(samplers.obtain(sampler_descriptor_from_shade_texture(material.texture_normal)));
    expect(binding('splat_weights').texture).toBe(ctx.state.weights.texture.gpu_texture);
    expect(binding('layer_diffuse').texture).toBe(ctx.state.layers.texture.gpu_texture);
    expect(template.update(ctx,services)).toBe(false);
  }finally{template.destroy(ctx,services);ctx.uniform_buffer.destroy();textures.destroy();vi.unstubAllGlobals();}
});

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
