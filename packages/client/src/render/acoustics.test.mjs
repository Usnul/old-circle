import {expect,test} from 'vitest';
import {MockAudioContext} from '@woosh/meep-engine/src/engine/sound/sopra/util/MockAudioContext.js';
import {SopraEngine} from '@woosh/meep-engine/src/engine/sound/sopra/SopraEngine.js';
import {EventDescription} from '@woosh/meep-engine/src/engine/sound/sopra/definition/EventDescription.js';
import {SampleAudioClip} from '@woosh/meep-engine/src/engine/sound/sopra/definition/clip/SampleAudioClip.js';
import {AcousticBody} from '@woosh/meep-engine/src/engine/sound/simulation/ecs/AcousticBody.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {ParentEntity} from '@woosh/meep-engine/src/engine/ecs/parent/ParentEntity.js';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {ACOUSTIC_MATERIALS} from '@old-circle/game/world/acoustics.mjs';
import {buildLayout} from '@old-circle/game/world/layout.mjs';
import {Scenery} from './scenery.mjs';
import {WorldAudio} from './audio.mjs';
import {WorldAcoustics} from './acoustics.mjs';

async function startManager(){
  const entityManager=new EntityManager(),dataset=new EntityComponentDataset();
  dataset.registerManyComponentTypes([Scenery,ShadedGeometry,ParentEntity]);
  entityManager.attachDataset(dataset);
  await new Promise((resolve,reject)=>entityManager.startup(resolve,reject));
  return {entityManager,dataset};
}
const stopManager=entityManager=>new Promise((resolve,reject)=>entityManager.shutdown(resolve,reject));

function sopraWithMock(){
  const context=new MockAudioContext();
  const buffer=context.createBuffer(1,context.sampleRate,context.sampleRate),provider={get:async()=>buffer,tryGet:()=>buffer};
  return new SopraEngine(context,context.destination,provider);
}

test('drawn scenery primitives carry the acoustic material of their authored model',async({onTestFinished})=>{
  const {entityManager,dataset}=await startManager();onTestFinished(()=>stopManager(entityManager));
  const acoustics=await WorldAcoustics.create(sopraWithMock(),entityManager);
  const primitive=(model)=>{
    const root=dataset.createEntity();
    if(model){const scenery=new Scenery();scenery.model=model;dataset.addComponentToEntity(root,scenery);}
    const child=dataset.createEntity();
    dataset.addComponentToEntity(child,ParentEntity.from(root));dataset.addComponentToEntity(child,new ShadedGeometry());
    return child;
  };
  const terrain=primitive('terrain_0_0'),wall=primitive('arch'),plank=primitive('fallenTrunk'),fern=primitive('fern'),frost=primitive('frostRock1'),character=primitive(null);
  acoustics.surfaces.update();
  const material=entity=>dataset.getComponent(entity,AcousticBody)?.material;
  expect(material(terrain)).toBe(ACOUSTIC_MATERIALS.ground);
  expect(material(wall)).toBe(ACOUSTIC_MATERIALS.stone);
  expect(material(plank)).toBe(ACOUSTIC_MATERIALS.wood);
  expect(material(fern)).toBe(ACOUSTIC_MATERIALS.foliage);
  expect(material(frost)).toBe(ACOUSTIC_MATERIALS.snow);
  // Actors keep Meep's default material; only authored scenery is named.
  expect(material(character)).toBeUndefined();
  expect(acoustics.surfaces.bodies).toBe(5);
  dataset.removeEntity(wall);
  expect(acoustics.surfaces.bodies).toBe(4);
});

test('the GPU acoustic system becomes the simulator propagation when graphics are supplied',async({onTestFinished})=>{
  const {entityManager}=await startManager();onTestFinished(()=>stopManager(entityManager));
  const extensions=[],graphics={scene_context:()=>null,add_extension:e=>{extensions.push(e);return e;},remove_extension:e=>extensions.splice(extensions.indexOf(e),1)};
  const acoustics=await WorldAcoustics.create(sopraWithMock(),entityManager,{graphics,scene:{isScene:true}});
  expect(acoustics.simulator.propagation).toBe(acoustics.gpu.propagation);
  expect(extensions).toHaveLength(1);
});

test('acoustic voices reverberate through the effects bus while wind stays dry, within a bounded voice budget',async({onTestFinished})=>{
  const {entityManager}=await startManager();onTestFinished(()=>stopManager(entityManager));
  const sopra=sopraWithMock(),layout=buildLayout(),audio=new WorldAudio({},layout);
  audio.sopra=sopra;audio.acoustics=await WorldAcoustics.create(sopra,entityManager);
  expect(sopra.busGraph.getAcousticReverb('effects')).not.toBeNull();
  expect(sopra.busGraph.getAcousticReverb('ambient')).toBeNull();
  const description=new EventDescription();description.is3D=true;description.distanceMax=45;description.maxInstances=64;description.busId='effects';description.rootClip=SampleAudioClip.from('test.wav');
  const listener=new Vector3(35,5.8,-53);sopra.listenerPosition=listener;
  const voice=audio.spatial(description,[28,5.8,-53]);expect(voice.acoustic).toBe(true);
  audio.acoustics.update(listener,audio.voices);expect(audio.acoustics.stats.voices).toBe(1);
  expect(audio.spatial(description,[200,10,150])).toBeNull();
  for(let i=0;i<40;i++)audio.spatial(description,[35+i*.05,5.8,-54]);expect(audio.voices.size).toBe(24);
  for(const v of [...audio.voices])v.stop();expect(audio.voices.size).toBe(0);audio.acoustics.update(listener,audio.voices);expect(audio.acoustics.stats.voices).toBe(0);
});
