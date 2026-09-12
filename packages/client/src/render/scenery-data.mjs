import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import ConcurrentExecutor from '@woosh/meep-engine/src/core/process/executor/ConcurrentExecutor.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import BinaryBufferDeSerializer from '@woosh/meep-engine/src/engine/ecs/storage/BinaryBufferDeSerializer.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {SGMeshSerializationAdapter} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/serialization/SGMeshSerializationAdapter.js';
import {staticSceneRegistry,loadStaticSceneAssets} from '@old-circle/game/world/static-scene-data.mjs';
import {WORLD_VERSION} from '@old-circle/game/world/world-definition.mjs';
import {Scenery,ScenerySerializationAdapter} from './scenery.mjs';

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
  const count = buffer.readUint32();
  const staticCount = buffer.readUint32();
  if (count > 100000 || staticCount > count) throw new Error('Malformed scenery entity count');
  if (staticCount && (assets?.worldVersion !== WORLD_VERSION || assets.bindings.length !== staticCount)) {
    throw new Error('Scenery collider asset mismatch');
  }
  const reader = new BinaryBufferDeSerializer();
  reader.registry = sceneryRegistry();
  await runSceneryTask(reader.process(buffer, {}, dataset));
  if (dataset.entityCount !== count || buffer.position !== bytes.byteLength) throw new Error('Malformed scenery dataset');

  let colliders = 0;
  dataset.traverseEntities([Collider], (collider, entity) => {
    const shape = assets?.shapes[assets.bindings[entity]?.shape];
    if (entity >= staticCount || !shape) throw new Error('Missing scenery collider asset');
    collider.shape = shape;
    colliders++;
  });
  let props = 0;
  dataset.traverseEntities([Scenery, Transform64, SGMesh], (scenery, transform, mesh, entity) => {
    const bounds = scenery.bounds;
    if (entity < staticCount || !Object.hasOwn(manifest.models, scenery.model) || mesh.url !== scenery.model) {
      throw new Error('Malformed scenery model');
    }
    if (![...bounds, ...transform].every(Number.isFinite) || bounds.x0 > bounds.x1 || bounds.y0 > bounds.y1 || bounds.z0 > bounds.z1) {
      throw new Error('Malformed scenery transform or bounds');
    }
    props++;
  });
  if (colliders !== staticCount || props !== count - staticCount) throw new Error('Incomplete scenery entities');
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
