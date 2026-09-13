import {expect,test} from 'vitest';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Light} from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import {updateWeaponLight,removeWeaponLight} from './weapon-lights.mjs';

test('staff gem light tracks a rotated scaled weapon and retires on switching or despawning',()=>{
  const ecd=new EntityComponentDataset();ecd.registerComponentType(Transform64);ecd.registerComponentType(Light);
  const view={ecd,light(position,color,intensity,type,shadow,distance,radius){
    const t=new Transform64();t.setTranslation(...position);const l=new Light();l.intensity.set(intensity);l.distance.set(distance);l.radius.set(radius);l.color.set(...color);
    return {id:new Entity().add(t).add(l).build(ecd),t,l};
  }};
  const t=new Transform64();t.setTranslation(3,4,5);t.setRotation(0,0,Math.sin(Math.PI/4),Math.cos(Math.PI/4));t.setScale(2,2,2);t.updateMatrix();
  const rig={weaponName:'staff',weapon:[{t}]};updateWeaponLight(view,rig);const light=rig.weaponLight;
  expect(light.t.translation_x).toBeCloseTo(.5);expect(light.t.translation_y).toBeCloseTo(4);expect(light.t.translation_z).toBeCloseTo(5);
  expect(light.l.radius.getValue()).toBe(.13);expect(light.l.distance.getValue()).toBe(2.6);expect(light.l.intensity.getValue()).toBe(.32);
  t.setTranslation(5,6,7);t.updateMatrix();updateWeaponLight(view,rig,.5);expect(rig.weaponLight).toBe(light);expect(light.t.translation_x).toBeCloseTo(2.5);expect(light.l.intensity.getValue()).toBe(.16);
  rig.weaponName='sword';updateWeaponLight(view,rig);expect(ecd.entityExists(light.id)).toBe(false);expect(rig.weaponLight).toBeUndefined();
  rig.weaponName='staff';updateWeaponLight(view,rig);const next=rig.weaponLight;removeWeaponLight(view,rig);expect(ecd.entityExists(next.id)).toBe(false);
});
