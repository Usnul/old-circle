import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {AABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/AABB3.js';
import {aabb3_transform_oriented} from '@woosh/meep-engine/src/core/geom/3d/aabb/aabb3_transform_oriented.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import BinaryBufferSerializer from '@woosh/meep-engine/src/engine/ecs/storage/BinaryBufferSerializer.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {RigidBody} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {WORLD_VERSION} from '@old-circle/game/world/world-definition.mjs';
import {propTransform,bakedPropTransform} from '@old-circle/game/world/prop-transform.mjs';
import {sceneryRegistry} from './scenery-data.mjs';
import {Scenery} from './scenery.mjs';

export {propTransform};

export function propBounds(prop,manifest,transform=propTransform(prop)) {
  const bounds=manifest.bounds[prop.model];if(!bounds)throw new Error(`Missing bounds for ${prop.model}`);
  const scaled=bounds.map((v,i)=>v*transform.scale[i%3]),result=new AABB3();
  const min=scaled.slice(0,3).map((v,i)=>Math.min(v,scaled[i+3])),max=scaled.slice(0,3).map((v,i)=>Math.max(v,scaled[i+3]));
  aabb3_transform_oriented(result,0,...min,...max,...transform.translation,...transform.rotation);return result;
}

/** Bake one presentation dataset containing both mesh placements and colliders. */
export function encodeScenery(layout, manifest, dataset = new EntityComponentDataset()) {
  const staticCount = dataset.entityCount;
  // Sound consumes collider geometry; presentation does not simulate these bodies.
  if (dataset.isComponentTypeRegistered(RigidBody)) {
    dataset.traverseEntities([RigidBody], (_body, entity) => dataset.removeComponentFromEntity(entity, RigidBody));
  }
  dataset.registerManyComponentTypes([Transform64, SGMesh, Scenery]);
  for (const prop of layout.props) {
    const transform = propTransform(prop);
    const mesh = SGMesh.fromURL(prop.model);
    const scenery = new Scenery();
    scenery.model = prop.model;
    scenery.relic = prop.relic ?? null;
    scenery.bounds = propBounds(prop, manifest, bakedPropTransform(prop));
    const entity = dataset.createEntity();
    for (const component of [transform, mesh, scenery]) dataset.addComponentToEntity(entity, component);
  }
  const buffer = new BinaryBuffer();
  buffer.writeUint32(2);
  buffer.writeUint32(WORLD_VERSION);
  buffer.writeUTF8String(manifest.revision);
  buffer.writeUint32(dataset.entityCount);
  buffer.writeUint32(staticCount);
  const writer = new BinaryBufferSerializer();
  writer.registry = sceneryRegistry();
  writer.process(buffer, dataset);
  return new Uint8Array(buffer.data, 0, buffer.position);
}
