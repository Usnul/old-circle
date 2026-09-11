import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {AABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/AABB3.js';
import {aabb3_transform_oriented} from '@woosh/meep-engine/src/core/geom/3d/aabb/aabb3_transform_oriented.js';
import {serializeAABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/serializeAABB3.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Tag} from '@woosh/meep-engine/src/engine/ecs/components/Tag.js';
import BinaryBufferSerializer from '@woosh/meep-engine/src/engine/ecs/storage/BinaryBufferSerializer.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {WORLD_VERSION} from '@old-circle/game/world/world-definition.mjs';
import {propTransform,bakedPropTransform} from '@old-circle/game/world/prop-transform.mjs';
import {sceneryRegistry} from './scenery-data.mjs';

export {propTransform};

export function propBounds(prop,manifest,transform=propTransform(prop)){
  const bounds=manifest.bounds[prop.model];if(!bounds)throw new Error(`Missing bounds for ${prop.model}`);
  const scaled=bounds.map((v,i)=>v*transform.scale[i%3]),result=new AABB3();
  const min=scaled.slice(0,3).map((v,i)=>Math.min(v,scaled[i+3])),max=scaled.slice(0,3).map((v,i)=>Math.max(v,scaled[i+3]));
  aabb3_transform_oriented(result,0,...min,...max,...transform.translation,...transform.rotation);return result;
}

/** Ship Meep entities and native AABBs, never rebuild authored placements in play. */
export function encodeScenery(layout,manifest){
  const dataset=new EntityComponentDataset();dataset.setComponentTypeMap([Transform64,SGMesh,Tag]);
  const bounds=[];
  for(const prop of layout.props){
    const transform=propTransform(prop),mesh=new SGMesh();mesh.url=prop.model;
    // The entity serializer performs the first and only packing pass. Bounds
    // and collision authoring use its decoded pose, not a second packed pose.
    bounds.push(propBounds(prop,manifest,bakedPropTransform(prop)));
    const entity=dataset.createEntity();dataset.addComponentToEntity(entity,transform);dataset.addComponentToEntity(entity,mesh);
    if(prop.relic)dataset.addComponentToEntity(entity,Tag.fromOne(prop.relic));
  }
  const buffer=new BinaryBuffer();buffer.writeUint32(1);buffer.writeUint32(WORLD_VERSION);buffer.writeUTF8String(manifest.revision);buffer.writeUint32(layout.props.length);
  const writer=new BinaryBufferSerializer();writer.registry=sceneryRegistry();writer.process(buffer,dataset);
  for(const box of bounds)serializeAABB3(buffer,box);
  return new Uint8Array(buffer.data,0,buffer.position);
}
