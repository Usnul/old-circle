import {expect,test} from 'vitest';
import {Characters} from './characters.mjs';
import {BOSSES} from '@old-circle/game/content/catalog.mjs';
import {rigs} from '@old-circle/game/simulation/animation.mjs';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {StandardShadeMaterial} from '@woosh/meep-engine/src/shade/renderer/material/StandardShadeMaterial.js';
import {TransparencyMode} from '@woosh/meep-engine/src/shade/renderer/material/TransparencyMode.js';

test('unadorned banner URLs and every keeper skin resolve to the correct shared rig, including newly received corpses',()=>{
  const requested=[],renderer=new Characters({models:{get(name){requested.push(name);return [];}},materials:{}});
  const banner=renderer.bundle('votiveBanner');expect(banner.skins[0].joints.length).toBe(rigs.votiveBanner.bones.length);expect(requested.at(-1)).toBe('votiveBanner');
  for(const archetype of Object.keys(BOSSES)){
    const corpse={kind:'enemy',archetype,weapon:'spear'},live={...corpse,boss:true};
    expect(renderer.appearance(corpse)).toBe(renderer.appearance(live));
    const bundle=renderer.bundle(renderer.appearance(live));expect(requested.at(-1)).toBe('boss_'+archetype);expect(bundle.skins[0].joints.length).toBe(rigs.pilgrim.bones.length);
  }
});

test('wall contact fades only the local skin and equipment, reuses materials and restores them before reuse',()=>{
  const ecd=new EntityComponentDataset();ecd.setComponentTypeMap([ShadedGeometry]);
  const shared=new StandardShadeMaterial(),other={material:shared},body={material:shared,updateMatrices(){}};
  const weapon=new Entity().add(ShadedGeometry.from({},shared)).build(ecd),lantern=new Entity().add(ShadedGeometry.from({},shared)).build(ecd);
  const originalWeapon=ecd.getComponent(weapon,ShadedGeometry),originalLantern=ecd.getComponent(lantern,ShadedGeometry);
  let ready=false;
  const renderer=new Characters({ecd,meshSystem:{instance_of:()=>ready?{}:null,traverse_meshes:(id,visit)=>visit(body)}});
  const rig={id:0,weapon:[{id:weapon}],lantern:{parts:[{id:lantern}]}};
  renderer.viewAlpha(rig,0);expect(rig.viewMaterials).toBeUndefined();ready=true;
  renderer.viewAlpha(rig,.25);
  const faded=body.material,fadedWeapon=ecd.getComponent(weapon,ShadedGeometry);
  for(const material of [faded,fadedWeapon.material,ecd.getComponent(lantern,ShadedGeometry).material]){
    expect(material).not.toBe(shared);expect(material.transparency_mode).toBe(TransparencyMode.Transparent);expect(material.diffuse_color.a).toBe(.25);
  }
  expect(other.material.diffuse_color.a).toBe(1);expect(shared.transparency_mode).toBe(TransparencyMode.Opaque);
  renderer.viewAlpha(rig,0);expect(body.material).toBe(faded);expect(faded.diffuse_color.a).toBe(0);expect(ecd.getComponent(weapon,ShadedGeometry)).toBe(fadedWeapon);
  renderer.viewAlpha(rig,1);expect(body.material).toBe(shared);expect(ecd.getComponent(weapon,ShadedGeometry)).toBe(originalWeapon);expect(ecd.getComponent(lantern,ShadedGeometry)).toBe(originalLantern);
  renderer.viewAlpha(rig,.5);expect(body.material).toBe(faded);
  renderer.clearViewAlpha(rig);expect(body.material).toBe(shared);expect(rig.viewMaterials).toBeNull();expect(ecd.getComponent(weapon,ShadedGeometry)).toBe(originalWeapon);
  rig.dead=true;renderer.viewAlpha(rig,0);expect(body.material).toBe(shared);
});
