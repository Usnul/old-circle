import {AcousticSimulator} from '@woosh/meep-engine/src/engine/sound/simulation/AcousticSimulator.js';
import {AcousticMaterial} from '@woosh/meep-engine/src/engine/sound/simulation/definition/AcousticMaterial.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {staticGeometry} from './static-geometry.mjs';
import {buildLayout} from './layout.mjs';
import {terrainSurface,WORLD_BOUNDS} from './regions.mjs';
import {HeightMapShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/HeightMapShape3D.js';
import {MeshShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/MeshShape3D.js';

// MEEP-013: HeightMapShape3D has a native SDF but inherits an unimplemented
// raycast. Compose its distance/volume queries with native mesh ray queries.
// This open surface needs no tetrahedral interior: it is used only for rays.
export class AcousticTerrain extends HeightMapShape3D {
  constructor(heightmap){
    super();this.sampler=heightmap.sampler;this.size.copy(heightmap.size);this.orientation.copy(heightmap.orientation);
    const heights=terrainSurface().vertices,{width,depth}=WORLD_BOUNDS,cols=width/2+1,rows=depth/2+1,mesh=new MeshShape3D();
    mesh.positions=new Float32Array(cols*rows*3);mesh.indices=new Uint32Array((cols-1)*(rows-1)*6);let k=0;
    for(let z=0;z<rows;z++)for(let x=0;x<cols;x++){
      const i=z*cols+x;mesh.positions.set([x*2-width/2,heights[i]+15,z*2-depth/2],i*3);
      if(x<cols-1&&z<rows-1){mesh.indices.set([i,i+cols,i+1,i+1,i+cols,i+cols+1],k);k+=6;}
    }
    mesh.recompute_cached();this.surface=mesh;
  }
  raycast(hit,ray){return this.surface.raycast(hit,ray);}
}

export const ACOUSTIC_MATERIALS={
  ground:AcousticMaterial.from({absorption:[.24,.48,.78],scattering:.85,transmission:[.01,.002,0]}),
  stone:AcousticMaterial.from({absorption:[.14,.20,.32],scattering:.65,transmission:[.10,.025,.006]}),
  wood:AcousticMaterial.from({absorption:[.22,.36,.52],scattering:.7,transmission:[.25,.10,.035]}),
  snow:AcousticMaterial.from({absorption:[.34,.68,.9],scattering:.85,transmission:[.035,.01,.002]}),
};
export function createWorldAcoustics(layout=buildLayout()){
  const simulator=new AcousticSimulator();simulator.pathing=false;simulator.rayCount=8;simulator.smoothing=.55;simulator.random_seed=4171;
  const transform=new Transform64();let bodies=0;
  for(const body of staticGeometry(layout)){
    const material=body.model==='terrain'?ACOUSTIC_MATERIALS.ground:/trunk|tree|wood|plank/i.test(body.model)?ACOUSTIC_MATERIALS.wood:body.model.startsWith('frostRock')?ACOUSTIC_MATERIALS.snow:ACOUSTIC_MATERIALS.stone;
    transform.setTranslation(...body.position);transform.updateMatrix();simulator.addOccluder(body.model==='terrain'?new AcousticTerrain(body.shape):body.shape,material,transform.matrix);bodies++;
  }
  return {simulator,bodies};
}
