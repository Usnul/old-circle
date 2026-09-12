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
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
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

export async function decodeStaticScene(bytes, dataset, assets, {startSystems} = {}) {
  if (dataset.entityCount !== 0) throw new Error('Static scene requires an empty dataset');
  const buffer = new BinaryBuffer();
  buffer.fromArrayBuffer(bytes);
  if (buffer.readUint32() !== 1 || buffer.readUint32() !== WORLD_VERSION) {
    throw new Error('Static scene needs rebuilding for this world version');
  }
  const count = buffer.readUint32();
  if (!dataset.isComponentTypeRegistered(Collider)) dataset.registerComponentType(Collider);
  // Resolve shape assets before the physics observers link each collider.
  const bindShapes = new EntityObserver([Collider], (collider, entity) => {
    collider.shape = assets.shapes[assets.bindings[entity].shape];
  }, () => {});
  dataset.addObserver(bindShapes, false);
  const deserializer = new BinaryBufferDeSerializer();
  deserializer.registry = staticSceneRegistry();
  try {
    if (startSystems) await startSystems();
    await run(deserializer.process(buffer, {}, dataset));
  } finally {
    dataset.removeObserver(bindShapes, false);
  }

  const solids = [];
  const contactSurfaces = new Map();
  let terrainEntity;
  await run(countTask(0, count, entity => {
    const transform = dataset.getComponent(entity, Transform64);
    const model = dataset.getComponent(entity, Name).getValue();
    if (model === 'terrain') {
      terrainEntity = entity;
      return;
    }
    contactSurfaces.set(entity, /trunk|tree|wood|plank/i.test(model) ? 'wood' : model.startsWith('frostRock') ? 'snow' : 'stone');
    solids.push({position: Array.from(transform.translation), size: [...assets.bindings[entity].size]});
  }));
  return {solids, contactSurfaces, terrainEntity};
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
    if (assets.worldVersion !== WORLD_VERSION) {
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
