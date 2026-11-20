import {AcousticMaterial} from '@woosh/meep-engine/src/engine/sound/simulation/definition/AcousticMaterial.js';

// Meep traces sound through the renderer's brick clipmap: every drawn surface
// occludes, and its AcousticBody names what it is made of. Three bands: low
// (< 250 Hz), mid, high (> 2.5 kHz).
export const ACOUSTIC_MATERIALS={
  ground:AcousticMaterial.from({absorption:[.24,.48,.78],scattering:.85,transmission:[.01,.002,0]}),
  stone:AcousticMaterial.from({absorption:[.14,.20,.32],scattering:.65,transmission:[.10,.025,.006]}),
  wood:AcousticMaterial.from({absorption:[.22,.36,.52],scattering:.7,transmission:[.25,.10,.035]}),
  snow:AcousticMaterial.from({absorption:[.34,.68,.9],scattering:.85,transmission:[.035,.01,.002]}),
  // Plants draw into the same world as masonry; their sparse leaves must not
  // shut sound out the way a wall does.
  foliage:AcousticMaterial.from({absorption:[.05,.12,.25],scattering:.9,transmission:[.95,.85,.7]}),
};

const FOLIAGE=new Set(['groundcover','groundcover1','dryGrass','moorGrass','fern','bracken','grass','flowers']);

/** The acoustic material of an authored scenery model. */
export function materialForModel(model) {
  if (model === 'terrain' || model.startsWith('terrain_')) return ACOUSTIC_MATERIALS.ground;
  if (FOLIAGE.has(model)) return ACOUSTIC_MATERIALS.foliage;
  if (/trunk|tree|wood|plank|pine/i.test(model)) return ACOUSTIC_MATERIALS.wood;
  if (model.startsWith('frostRock')) return ACOUSTIC_MATERIALS.snow;
  return ACOUSTIC_MATERIALS.stone;
}
