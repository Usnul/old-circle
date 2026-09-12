import {AcousticSimulator} from '@woosh/meep-engine/src/engine/sound/simulation/AcousticSimulator.js';
import {AcousticMaterial} from '@woosh/meep-engine/src/engine/sound/simulation/definition/AcousticMaterial.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Name} from '@woosh/meep-engine/src/engine/ecs/name/Name.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {AcousticBody} from '@woosh/meep-engine/src/engine/sound/simulation/ecs/AcousticBody.js';
import {AcousticSimulationSystem} from '@woosh/meep-engine/src/engine/sound/simulation/ecs/AcousticSimulationSystem.js';
import {loadStaticScene} from './static-scene-data.mjs';
import {HeightMapShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/HeightMapShape3D.js';
import {loadAcousticTerrainSurface} from './acoustic-terrain-data.mjs';

const terrainShapes=new WeakMap();

// Keep native heightfield distance/volume queries and use a baked native mesh
// BVH for rays. Long reflection rays must not resample thousands of grid cells.
export class AcousticTerrain extends HeightMapShape3D {
  constructor(heightmap, surface) {
    super();
    this.sampler = heightmap.sampler;
    this.size.copy(heightmap.size);
    this.orientation.copy(heightmap.orientation);
    this.tessellation = heightmap.tessellation;
    this.surface = surface;
  }

  raycast(hit, ray) {
    return this.surface.raycast(hit, ray);
  }
}

export const ACOUSTIC_MATERIALS={
  ground:AcousticMaterial.from({absorption:[.24,.48,.78],scattering:.85,transmission:[.01,.002,0]}),
  stone:AcousticMaterial.from({absorption:[.14,.20,.32],scattering:.65,transmission:[.10,.025,.006]}),
  wood:AcousticMaterial.from({absorption:[.22,.36,.52],scattering:.7,transmission:[.25,.10,.035]}),
  snow:AcousticMaterial.from({absorption:[.34,.68,.9],scattering:.85,transmission:[.035,.01,.002]}),
};
function materialForModel(model) {
  if (model === 'terrain') return ACOUSTIC_MATERIALS.ground;
  if (/trunk|tree|wood|plank/i.test(model)) return ACOUSTIC_MATERIALS.wood;
  if (model.startsWith('frostRock')) return ACOUSTIC_MATERIALS.snow;
  return ACOUSTIC_MATERIALS.stone;
}

// The client supplies its presentation manager. Offline probe baking owns a
// manager with the same live static entities, without registering physics.
export async function createWorldAcoustics(entityManager) {
  if (entityManager === undefined) {
    entityManager = new EntityManager();
    entityManager.attachDataset(new EntityComponentDataset());
    await loadStaticScene(entityManager.dataset);
  }

  const dataset = entityManager.dataset;
  if (dataset === null) throw new Error('World acoustics requires an attached dataset');

  const simulator = new AcousticSimulator();
  simulator.pathing = false;
  simulator.rayCount = 8;
  simulator.smoothing = .55;
  simulator.random_seed = 4171;

  const surface = await loadAcousticTerrainSurface();
  dataset.registerComponentType(AcousticBody);
  let bodies = 0;
  dataset.traverseEntities([Transform64, Collider, Name], (transform, collider, name, entity) => {
    const model = name.getValue();
    if (model === 'terrain' && !(collider.shape instanceof AcousticTerrain)) {
      const shape = collider.shape;
      if (!terrainShapes.has(shape)) {
        terrainShapes.set(shape, new AcousticTerrain(shape, surface));
      }
      collider.shape = terrainShapes.get(shape);
    }

    dataset.addComponentToEntity(entity, AcousticBody.from(materialForModel(model)));
    bodies++;
  });

  await entityManager.addSystem(new AcousticSimulationSystem(simulator));
  await new Promise((resolve, reject) => entityManager.startup(resolve, reject));
  return {simulator, bodies, entityManager};
}
