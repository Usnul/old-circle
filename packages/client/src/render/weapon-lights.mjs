import {Light} from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';

/** The gem's local centre follows the same transform as the visible staff. */
export function updateWeaponLight(view,rig,alpha=1){
  if(rig.weaponName!=='staff'||!rig.weapon?.length){removeWeaponLight(view,rig);return;}
  const position=new Vector3(0,1.25,0).applyMatrix4(rig.weapon[0].t);
  // A faint blue source with a 13 cm emitting radius, not a 13 cm reach.
  rig.weaponLight??=view.light(Array.from(position),[.20,.57,1],.32,Light.Type.POINT,false,2.6,.13);
  const {id,t,l}=rig.weaponLight;t.setTranslation(...position);t.updateMatrix();t64_announce_change(view.ecd,id);l.intensity.set(.32*alpha);
}

export function removeWeaponLight(view,rig){if(rig.weaponLight){view.ecd.removeEntity(rig.weaponLight.id);delete rig.weaponLight;}}
