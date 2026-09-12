import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import ConcurrentExecutor from '@woosh/meep-engine/src/core/process/executor/ConcurrentExecutor.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import BinaryBufferDeSerializer from '@woosh/meep-engine/src/engine/ecs/storage/BinaryBufferDeSerializer.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {SGMeshSerializationAdapter} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/serialization/SGMeshSerializationAdapter.js';
import {staticSceneRegistry,loadStaticSceneAssets} from '@old-circle/game/world/static-scene-data.mjs';
import {WORLD_VERSION} from '@old-circle/game/world/world-definition.mjs';
import {ScenerySerializationAdapter} from './scenery.mjs';

export function sceneryRegistry() {
  const registry = staticSceneRegistry();
  registry.registerAdapters([new SGMeshSerializationAdapter(), new ScenerySerializationAdapter()]);
  return registry;
}

export async function runSceneryTask(task) {
  const executor = new ConcurrentExecutor(0, 4);
  const completed = task.promise();
  executor.run(task);
  await completed;
}

/** Populate the presentation engine's own dataset before attaching consumers. */
export async function decodeScenery(bytes, manifest, dataset = new EntityComponentDataset(), assets) {
  if (dataset.entityCount !== 0) throw new Error('Scenery requires an empty dataset');
  const buffer = new BinaryBuffer();
  buffer.fromArrayBuffer(bytes);
  if (buffer.readUint32() !== 2 || buffer.readUint32() !== WORLD_VERSION || buffer.readUTF8String() !== manifest.revision) {
    throw new Error('Scenery needs rebuilding for this world and geometry revision');
  }
  // Skip the envelope's counts; the native stream describes its own entities.
  buffer.position += 8;
  const reader = new BinaryBufferDeSerializer();
  reader.registry = sceneryRegistry();
  await runSceneryTask(reader.process(buffer, {}, dataset));
  dataset.traverseEntities([Collider], (collider, entity) => {
    collider.shape = assets.shapes[assets.bindings[entity].shape];
  });
  return dataset;
}

export async function loadScenery(manifest, dataset) {
  const [response, assets] = await Promise.all([
    fetch('/assets/geometry/scenery.bin'),
    loadStaticSceneAssets()
  ]);
  if (!response.ok) throw new Error('Could not load scenery entities');
  return decodeScenery(await response.arrayBuffer(), manifest, dataset, assets);
}
