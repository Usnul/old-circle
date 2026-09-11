import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {AABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/AABB3.js';
import {deserializeAABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/deserializeAABB3.js';
import ConcurrentExecutor from '@woosh/meep-engine/src/core/process/executor/ConcurrentExecutor.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Tag} from '@woosh/meep-engine/src/engine/ecs/components/Tag.js';
import {TagSerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/components/TagSerializationAdapter.js';
import BinaryBufferDeSerializer from '@woosh/meep-engine/src/engine/ecs/storage/BinaryBufferDeSerializer.js';
import {BinarySerializationRegistry} from '@woosh/meep-engine/src/engine/ecs/storage/binary/BinarySerializationRegistry.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Transform64SerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64SerializationAdapter.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {SGMeshSerializationAdapter} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/serialization/SGMeshSerializationAdapter.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {WORLD_VERSION} from '@old-circle/game/world/world-definition.mjs';

export function sceneryRegistry(){
  const registry=new BinarySerializationRegistry();
  registry.registerAdapters([new Transform64SerializationAdapter(),new SGMeshSerializationAdapter(),new TagSerializationAdapter()]);
  return registry;
}

/** Native task slices keep entity decoding and initial scene attachment responsive. */
export async function runSceneryTask(task){
  const executor=new ConcurrentExecutor(0,4),completed=task.promise();executor.run(task);await completed;
}

/** Decode into a standalone dataset: baked IDs must never overwrite live cameras,
 * actors or effects. Static native transforms are shared by their immutable draw parts. */
export async function decodeScenery(bytes,manifest){
  const buffer=new BinaryBuffer();buffer.fromArrayBuffer(bytes);
  if(buffer.readUint32()!==1||buffer.readUint32()!==WORLD_VERSION||buffer.readUTF8String()!==manifest.revision)throw new Error('Scenery needs rebuilding for this world and geometry revision');
  const count=buffer.readUint32();if(count>100000)throw new Error('Malformed scenery entity count');
  const dataset=new EntityComponentDataset(),reader=new BinaryBufferDeSerializer();reader.registry=sceneryRegistry();
  await runSceneryTask(reader.process(buffer,{},dataset));
  if(dataset.entityCount!==count||buffer.position+count*48!==bytes.byteLength)throw new Error('Malformed scenery dataset');
  const records=[];
  dataset.traverseEntities([Transform64,SGMesh],(transform,mesh,entity)=>{
    if(entity!==records.length||!Object.hasOwn(manifest.models,mesh.url))throw new Error('Malformed scenery model');
    const bounds=new AABB3();deserializeAABB3(buffer,bounds);
    if(![...bounds,...transform].every(Number.isFinite)||bounds.x0>bounds.x1||bounds.y0>bounds.y1||bounds.z0>bounds.z1)throw new Error('Malformed scenery transform or bounds');
    records.push({transform,mesh,bounds,prop:{model:mesh.url,scale:transform.scale,relic:dataset.getComponent(entity,Tag)?.getFirst()}});
  });
  if(records.length!==count)throw new Error('Incomplete scenery entities');
  return {dataset,records};
}

export async function loadScenery(manifest){
  const response=await fetch('/assets/geometry/scenery.bin');if(!response.ok)throw new Error('Could not load scenery entities');
  return decodeScenery(await response.arrayBuffer(),manifest);
}

export function attachScenery(dataset,chunks,transform){
  // Each draw chunk uses the immutable native transform decoded from the level;
  // fresh live IDs are allocated independently of the baked entity IDs.
  return chunks.map(chunk=>({id:new Entity().add(transform).add(ShadedGeometry.from(chunk.geometry,chunk.material)).build(dataset),t:transform}));
}
