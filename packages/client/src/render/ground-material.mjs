import {TerrainShadeMaterial} from '@woosh/meep-engine/src/engine/graphics3/terrain/TerrainShadeMaterial.js';
import {TERRAIN_MATERIAL_TEMPLATE} from '@woosh/meep-engine/src/engine/graphics3/terrain/TERRAIN_MATERIAL_TEMPLATE.js';
import {chunk_terrain_splat_mix} from '@woosh/meep-engine/src/engine/graphics3/terrain/chunk_terrain_splat_mix.js';
import {chunk_terrain_grid_overlay} from '@woosh/meep-engine/src/engine/graphics3/terrain/chunk_terrain_grid_overlay.js';
import {chunk_material_surface_contract} from '@woosh/meep-engine/src/shade/renderer/material/template/chunk_material_surface.js';
import {ShadeMaterialTemplate} from '@woosh/meep-engine/src/shade/renderer/material/template/ShadeMaterialTemplate.js';
import {CodeChunk} from '@woosh/meep-engine/src/shade/renderer/shader/compiler/CodeChunk.js';
import {ShaderResourceGroupDescriptor} from '@woosh/meep-engine/src/shade/renderer/shader/resource/ShaderResourceGroupDescriptor.js';
import {WebGPUArray} from '@woosh/meep-engine/src/shade/renderer/shader/type/WebGPUArray.js';
import {GPUShaderStage} from '@woosh/meep-engine/src/shade/descriptor/GPUShaderStage.js';
import {SamplerDescriptor} from '@woosh/meep-engine/src/shade/descriptor/texture/SamplerDescriptor.js';
import {TextureViewDescriptor} from '@woosh/meep-engine/src/shade/descriptor/texture/TextureViewDescriptor.js';
import {sampler_descriptor_from_shade_texture} from '@woosh/meep-engine/src/shade/renderer/texture/sampler_descriptor_from_shade_texture.js';
import {chunk_textureSampleBarycentric} from '@woosh/meep-engine/src/shade/renderer/shader/chunk/texture/sample/chunk_texture_sample_barycentric.js';
import {chunk_decode_tangent_normal} from '@woosh/meep-engine/src/shade/renderer/shader/chunk/geometry/normal/chunk_decode_tangent_normal.js';

// Authored terrain vertices use world coordinates with identity placements.
// Native terrain starts at zero; our weights start at the world bounds corner.
const surface=CodeChunk.from(`
fn material_surface(s: MaterialSurfaceInput) -> MaterialSurfaceOutput {
    let local = s.position_os.xz - terrain.grid_transform.zw;
    let uv = local * terrain.inv_world_size;
    let dx = s.position_os_ddx.xz * terrain.inv_world_size;
    let dy = s.position_os_ddy.xz * terrain.inv_world_size;
    var ground = terrain_splat_mix(
        layer_diffuse, layer_sampler, splat_weights, splat_sampler,
        &layer_scales, terrain.layer_count, uv, dx, dy
    );
    ground.a = 1.0;
    let overlay = terrain_grid_overlay(
        overlay_map, overlay_sprite, sprite_sampler,
        local / terrain.grid_transform.xy, vec2<i32>(terrain.grid_resolution)
    );
    var out = material_surface_default();
    out.albedo = terrain_overlay_blend(ground, overlay).rgb;
    out.normal = decode_tangent_normal(textureSampleBarycentric(texture_normal, texture_normal_sampler, s.uv));
    return out;
}
`,[chunk_material_surface_contract,chunk_terrain_splat_mix,chunk_terrain_grid_overlay,chunk_textureSampleBarycentric,chunk_decode_tangent_normal]);

// Keep the native terrain bindings and sampling modes, adding the authored
// tangent normal map on its original mesh UVs independently of the weight map.
const resources=new ShaderResourceGroupDescriptor();
resources.addUniform('terrain',TERRAIN_MATERIAL_TEMPLATE.uniform_type)
  .addStorageBuffer('layer_scales',WebGPUArray.f32)
  .addTexture('splat_weights','float','2d-array').addSampler('splat_sampler')
  .addTexture('layer_diffuse','float','2d-array').addSampler('layer_sampler')
  .addTexture('overlay_map').addTexture('overlay_sprite','float').addSampler('sprite_sampler')
  .addTexture('texture_normal','float').addSampler('texture_normal_sampler');
resources.addVisibility(GPUShaderStage.FRAGMENT);
const arrayView=TextureViewDescriptor.from({dimension:'2d-array'});
const splatSampler=SamplerDescriptor.from({magFilter:'linear',minFilter:'nearest',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
const layerSampler=SamplerDescriptor.from({magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',addressModeU:'repeat',addressModeV:'repeat',maxAnisotropy:8});
const spriteSampler=SamplerDescriptor.from({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});

// Share the native texture uploads, mip generation and resource lifetime.
class WorldTerrainTemplate extends ShadeMaterialTemplate {
  build(ctx,services){
    TERRAIN_MATERIAL_TEMPLATE.build(ctx,services);
    const normal=ctx.source.texture_normal;
    if(normal!==undefined)ctx.textures.set(normal,services.textures.obtain(normal));
  }
  uniform_value(material){return TERRAIN_MATERIAL_TEMPLATE.uniform_value(material);}
  create_bind_group(ctx,layout,services){
    const state=ctx.state,normal=ctx.source.texture_normal;
    return services.device.createBindGroup({label:'Old Circle terrain',layout,entries:resources.generateGPUBindGroupEntryArray({
      terrain:{buffer:ctx.uniform_buffer},layer_scales:{buffer:state.scales},
      splat_weights:state.weights.texture.obtainView(arrayView),splat_sampler:services.samplers.obtain(splatSampler),
      layer_diffuse:state.layers.texture.obtainView(arrayView),layer_sampler:services.samplers.obtain(layerSampler),
      overlay_map:state.overlay.texture.obtainView(),overlay_sprite:state.sprite.texture.obtainView(),sprite_sampler:services.samplers.obtain(spriteSampler),
      texture_normal:(normal===undefined?services.defaults.texture_pixel_normal:ctx.textures.get(normal)).obtainView(),
      texture_normal_sampler:normal===undefined?services.defaults.sampler:services.samplers.obtain(sampler_descriptor_from_shade_texture(normal)),
    })});
  }
  update(ctx,services){return TERRAIN_MATERIAL_TEMPLATE.update(ctx,services);}
  destroy(ctx,services){return TERRAIN_MATERIAL_TEMPLATE.destroy(ctx,services);}
}
const template=new WorldTerrainTemplate({name:'Old Circle terrain',surface,
  resources,uniform_type:TERRAIN_MATERIAL_TEMPLATE.uniform_type,dynamic:true});

export class WorldGroundMaterial extends TerrainShadeMaterial {
  template=template;
  texture_normal;
}
