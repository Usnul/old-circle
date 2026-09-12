import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import ConcurrentExecutor from '@woosh/meep-engine/src/core/process/executor/ConcurrentExecutor.js';
import {countTask} from '@woosh/meep-engine/src/core/process/task/util/countTask.js';
import BinaryBufferDeSerializer from '@woosh/meep-engine/src/engine/ecs/storage/BinaryBufferDeSerializer.js';
import {BinarySerializationRegistry} from '@woosh/meep-engine/src/engine/ecs/storage/binary/BinarySerializationRegistry.js';
import {Transform64SerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64SerializationAdapter.js';
import {RigidBodySerializationAdapter} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBodySerializationAdapter.js';
import {ColliderSerializationAdapter} from '@woosh/meep-engine/src/engine/physics/ecs/ColliderSerializationAdapter.js';
import {NameSerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/name/NameSerializationAdapter.js';
import {Name} from '@woosh/meep-engine/src/engine/ecs/name/Name.js';
import {EntityObserver} from '@woosh/meep-engine/src/engine/ecs/EntityObserver.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {RigidBody} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {BodyKind} from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import {HeightMapShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/HeightMapShape3D.js';
import {ConvexHullShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/ConvexHullShape3D.js';
import {loadTerrain} from './terrain-data.mjs';
import {WORLD_VERSION,WORLD_BOUNDS} from './world-definition.mjs';

export function staticSceneRegistry(){
  const registry=new BinarySerializationRegistry();
  registry.registerAdapters([new Transform64SerializationAdapter(),new RigidBodySerializationAdapter(),new ColliderSerializationAdapter(),new NameSerializationAdapter()]);
  return registry;
}

async function run(task){
  const done=task.promise();new ConcurrentExecutor(0,8).run(task);await done;
}

export async function decodeStaticScene(bytes,dataset,assets,{startSystems}={}){
  if(dataset.entityCount!==0)throw new Error('Static scene requires an empty dataset');
  const buffer=new BinaryBuffer();buffer.fromArrayBuffer(bytes);
  if(buffer.readUint32()!==1||buffer.readUint32()!==WORLD_VERSION||assets.worldVersion!==WORLD_VERSION)throw new Error('Static scene needs rebuilding for this world version');
  const count=buffer.readUint32();
  if(count!==assets.bindings.length)throw new Error('Static scene collider asset mismatch');
  if(!dataset.isComponentTypeRegistered(Collider))dataset.registerComponentType(Collider);
  // Register before the physics observers, so each collider has its asset by
  // the time the native systems link it. Deserialization then spreads physics
  // insertion over the same small task slices as component loading.
  const bindShapes=new EntityObserver([Collider],(collider,entity)=>{
    const binding=assets.bindings[entity],shape=assets.shapes[binding?.shape];
    if(!shape)throw new Error('Missing static collider asset');
    collider.shape=shape;
  },()=>{});
  dataset.addObserver(bindShapes,false);
  const deserializer=new BinaryBufferDeSerializer();deserializer.registry=staticSceneRegistry();
  try{
    if(startSystems)await startSystems();
    await run(deserializer.process(buffer,{},dataset));
  }finally{dataset.removeObserver(bindShapes,false);}
  if(buffer.position!==bytes.byteLength||dataset.entityCount!==count)throw new Error('Malformed static scene');
  const solids=[],contactSurfaces=new Map();let terrainEntity;
  await run(countTask(0,count,entity=>{
    const transform=dataset.getComponent(entity,Transform64),body=dataset.getComponent(entity,RigidBody),collider=dataset.getComponent(entity,Collider),name=dataset.getComponent(entity,Name);
    const binding=assets.bindings[entity],shape=assets.shapes[binding.shape];
    if(!transform||!body||!collider||!name||!shape||body.kind!==BodyKind.Static)throw new Error('Malformed static entity');
    const model=name.getValue();
    if(model==='terrain'){if(terrainEntity!==undefined)throw new Error('Duplicate terrain entity');terrainEntity=entity;return;}
    contactSurfaces.set(entity,/trunk|tree|wood|plank/i.test(model)?'wood':model.startsWith('frostRock')?'snow':'stone');
    solids.push({position:[transform.translation_x,transform.translation_y,transform.translation_z],size:[...binding.size]});
  }));
  if(terrainEntity===undefined)throw new Error('Missing terrain entity');
  return {solids,contactSurfaces,terrainEntity};
}

// Shape assets are immutable and shared within a realm. Each live physics world
// owns its mutable components; the presentation bake already contains its entities.
async function readStaticAsset(url) {
  if (url.protocol === 'file:') {
    const {readFile} = await import('node:fs/promises');
    const data = await readFile(url);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load static world');
  return response.arrayBuffer();
}

let prepared;
export async function loadStaticSceneAssets() {
  return prepared ??= (async () => {
    const [shapeBytes, terrain] = await Promise.all([
      readStaticAsset(new URL('../content/static-shapes.json', import.meta.url)),
      loadTerrain()
    ]);
    const assets = JSON.parse(new TextDecoder().decode(shapeBytes));
    if (assets.worldVersion !== WORLD_VERSION || !Array.isArray(assets.shapes) || !Array.isArray(assets.bindings)) {
      throw new Error('Static collider assets need rebuilding');
    }
    const shapes = [];
    await run(countTask(0, assets.shapes.length, index => {
      const asset = assets.shapes[index];
      shapes[index] = asset.terrain
        ? HeightMapShape3D.from(terrain.sampler, WORLD_BOUNDS.width, asset.height, WORLD_BOUNDS.depth)
        : ConvexHullShape3D.from(new Float32Array(asset.vertices), new Uint32Array(asset.indices));
    }));
    return {worldVersion: assets.worldVersion, bindings: assets.bindings, shapes};
  })().catch(error => { prepared = undefined; throw error; });
}

let entityBytes;
export async function loadStaticScene(dataset, options) {
  entityBytes ??= readStaticAsset(new URL('../content/static-scene.bin', import.meta.url))
    .catch(error => { entityBytes = undefined; throw error; });
  const [assets, bytes] = await Promise.all([loadStaticSceneAssets(), entityBytes]);
  return decodeStaticScene(bytes, dataset, assets, options);
}
