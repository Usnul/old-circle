import {AcousticSimulator} from '@woosh/meep-engine/src/engine/sound/simulation/AcousticSimulator.js';
import {AcousticMaterial} from '@woosh/meep-engine/src/engine/sound/simulation/definition/AcousticMaterial.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {loadStaticSceneGeometry} from './static-scene-data.mjs';
import {HeightMapShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/HeightMapShape3D.js';
import {loadAcousticTerrainSurface} from './acoustic-terrain-data.mjs';
import ConcurrentExecutor from '@woosh/meep-engine/src/core/process/executor/ConcurrentExecutor.js';
import {countTask} from '@woosh/meep-engine/src/core/process/task/util/countTask.js';

const terrainShapes=new WeakMap();

// Keep native heightfield distance/volume queries and use a baked native mesh
// BVH for rays. Long reflection rays must not resample thousands of grid cells.
export class AcousticTerrain extends HeightMapShape3D {
  constructor(heightmap,surface){
    super();this.sampler=heightmap.sampler;this.size.copy(heightmap.size);this.orientation.copy(heightmap.orientation);this.tessellation=heightmap.tessellation;
    this.surface=surface;
  }
  raycast(hit,ray){return this.surface.raycast(hit,ray);}
}

export const ACOUSTIC_MATERIALS={
  ground:AcousticMaterial.from({absorption:[.24,.48,.78],scattering:.85,transmission:[.01,.002,0]}),
  stone:AcousticMaterial.from({absorption:[.14,.20,.32],scattering:.65,transmission:[.10,.025,.006]}),
  wood:AcousticMaterial.from({absorption:[.22,.36,.52],scattering:.7,transmission:[.25,.10,.035]}),
  snow:AcousticMaterial.from({absorption:[.34,.68,.9],scattering:.85,transmission:[.035,.01,.002]}),
};
export async function createWorldAcoustics(){
  const simulator=new AcousticSimulator();simulator.pathing=false;simulator.rayCount=8;simulator.smoothing=.55;simulator.random_seed=4171;
  const [geometry,surface]=await Promise.all([loadStaticSceneGeometry(),loadAcousticTerrainSurface()]),transform=new Transform64();
  const task=countTask(0,geometry.length,index=>{
    const body=geometry[index];
    const material=body.model==='terrain'?ACOUSTIC_MATERIALS.ground:/trunk|tree|wood|plank/i.test(body.model)?ACOUSTIC_MATERIALS.wood:body.model.startsWith('frostRock')?ACOUSTIC_MATERIALS.snow:ACOUSTIC_MATERIALS.stone;
    let shape=body.shape;
    if(body.model==='terrain'){
      if(!terrainShapes.has(shape))terrainShapes.set(shape,new AcousticTerrain(shape,surface));
      shape=terrainShapes.get(shape);
    }
    transform.setTranslation(...body.position);transform.updateMatrix();simulator.addOccluder(shape,material,transform.matrix);
  });
  const done=task.promise();new ConcurrentExecutor(0,8).run(task);await done;
  return {simulator,bodies:geometry.length};
}
