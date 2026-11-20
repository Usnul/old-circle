import {AcousticSimulator} from '@woosh/meep-engine/src/engine/sound/simulation/AcousticSimulator.js';
import {AcousticBody} from '@woosh/meep-engine/src/engine/sound/simulation/ecs/AcousticBody.js';
import {GPUAcousticSystem} from '@woosh/meep-engine/src/engine/graphics3/GPUAcousticSystem.js';
import {AcousticReverbEffect} from '@woosh/meep-engine/src/engine/sound/sopra/definition/effect/AcousticReverbEffect.js';
import {SopraEngine,SopraDefaultBus} from '@woosh/meep-engine/src/engine/sound/sopra/SopraEngine.js';
import {EventInstanceState} from '@woosh/meep-engine/src/engine/sound/sopra/runtime/EventInstance.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {ParentEntity} from '@woosh/meep-engine/src/engine/ecs/parent/ParentEntity.js';
import {System} from '@woosh/meep-engine/src/engine/ecs/System.js';
import {v3_distance} from '@woosh/meep-engine/src/core/geom/vec3/v3_distance.js';
import {materialForModel} from '@old-circle/game/world/acoustics.mjs';
import {Scenery} from './scenery.mjs';

export const ACOUSTIC_VOICE_LIMIT=24;

/**
 * Names the acoustic material of every drawn primitive of authored scenery.
 * MeshSystem spawns one entity per primitive under the Scenery root; Meep's
 * GPU acoustics read the AcousticBody on that row of the scene database.
 * Bodies are attached on the next update rather than inside the observer.
 */
export class SceneryAcousticSystem extends System {
  dependencies=[ShadedGeometry,ParentEntity];
  pending=new Set();
  bodies=0;

  async startup(entityManager){
    this.entityManager=entityManager;
    const dataset=entityManager.dataset;
    if(dataset&&!dataset.isComponentTypeRegistered(AcousticBody))dataset.registerComponentType(AcousticBody);
  }
  link(geometry,parent,entity){this.pending.add(entity);}
  unlink(geometry,parent,entity){
    if(this.pending.delete(entity))return;
    const dataset=this.entityManager?.dataset;
    if(dataset?.getComponent(entity,AcousticBody))this.bodies--;
  }
  update(){
    if(this.pending.size===0)return;
    const dataset=this.entityManager.dataset;
    for(const entity of this.pending){
      if(!dataset.entityExists(entity)||dataset.getComponent(entity,AcousticBody))continue;
      const parent=dataset.getComponent(entity,ParentEntity),scenery=parent&&dataset.getComponent(parent.entity,Scenery);
      if(!scenery)continue;
      dataset.addComponentToEntity(entity,AcousticBody.from(materialForModel(scenery.model)));
      this.bodies++;
    }
    this.pending.clear();
  }
}

/** Effects carry the acoustic reverb; broad ambient wind stays dry. */
export function acousticBuses(){
  return SopraEngine.defaultBuses().map(bus=>{
    if(bus.id===SopraDefaultBus.Effects)bus.effects=[...bus.effects,new AcousticReverbEffect()];
    return bus;
  });
}

export class WorldAcoustics {
  /**
   * @param {SopraEngine} sopra
   * @param {EntityManager} entityManager the presentation manager whose dataset the scene draws
   * @param {{graphics?:object,scene?:object}} [gpu] without these every source stays dry
   */
  static async create(sopra,entityManager,{graphics,scene}={}){
    sopra.setBuses(acousticBuses(),{keepVolumes:true});
    const simulator=new AcousticSimulator(),surfaces=new SceneryAcousticSystem();
    await entityManager.addSystem(surfaces);
    let gpu=null;
    if(graphics&&scene){gpu=new GPUAcousticSystem(graphics,scene,simulator);await entityManager.addSystem(gpu);}
    return new WorldAcoustics(sopra,simulator,surfaces,gpu);
  }
  constructor(sopra,simulator,surfaces,gpu){
    this.sopra=sopra;this.simulator=simulator;this.surfaces=surfaces;this.gpu=gpu;
    this.stats={bodies:0,voices:0,sources:0,ms:0};
  }
  /** Solve a voice as it starts, so its first audible frame is already propagated. */
  start(voice){
    const listener=this.sopra.listenerPosition;
    if(listener)this.simulator.solve(voice,listener);
  }
  forget(voice){this.simulator.forget(voice);}
  update(listener,voices){
    const started=performance.now();
    const live=[...voices].filter(v=>v.acoustic&&v.position&&v.state===EventInstanceState.Playing&&v3_distance(...v.position,...listener)<v.description.distanceMax);
    live.sort((a,b)=>v3_distance(...a.position,...listener)-v3_distance(...b.position,...listener));
    live.length=Math.min(live.length,ACOUSTIC_VOICE_LIMIT);
    // GPU results land between frames and are re-applied by the simulator itself.
    this.simulator.apply(live,listener);
    this.stats.voices=live.length;this.stats.bodies=this.surfaces.bodies;this.stats.sources=this.gpu?.propagation.source_count??0;
    this.stats.ms=performance.now()-started;
  }
}
