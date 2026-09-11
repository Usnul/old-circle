import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {HashMap} from '@woosh/meep-engine/src/core/collection/map/HashMap.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import BinaryBufferSerializer from '@woosh/meep-engine/src/engine/ecs/storage/BinaryBufferSerializer.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {RigidBody} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {BodyKind} from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import {Name} from '@woosh/meep-engine/src/engine/ecs/name/Name.js';
import {staticSceneRegistry} from './static-scene-data.mjs';
import {staticGeometry} from './static-geometry.mjs';
import {buildLayout} from './layout.mjs';
import {WORLD_VERSION} from './world-definition.mjs';

export function encodeStaticScene(layout=buildLayout()){
  const dataset=new EntityComponentDataset(),shapes=[],bindings=[],indices=new HashMap();
  for(const type of [Transform64,RigidBody,Collider,Name])dataset.registerComponentType(type);
  for(const body of staticGeometry(layout)){
    const entity=dataset.createEntity(),transform=new Transform64(),rigidBody=new RigidBody(),collider=new Collider();
    transform.setTranslation(...body.position);rigidBody.kind=BodyKind.Static;rigidBody.mass=75;rigidBody.linearDamping=.05;collider.shape=body.shape;collider.friction=.8;
    for(const component of [transform,rigidBody,collider,new Name(body.model)])dataset.addComponentToEntity(entity,component);
    let shape=indices.get(body.shape);
    if(shape===undefined){
      shape=shapes.length;indices.set(body.shape,shape);
      shapes.push(body.model==='terrain'?{terrain:true,height:body.shape.size.y}:{vertices:Array.from(body.shape.vertices),indices:Array.from(body.shape.indices)});
    }
    bindings.push({shape,size:body.size});
  }
  const buffer=new BinaryBuffer();buffer.writeUint32(1);buffer.writeUint32(WORLD_VERSION);buffer.writeUint32(dataset.entityCount);
  const serializer=new BinaryBufferSerializer();serializer.registry=staticSceneRegistry();serializer.process(buffer,dataset);
  return {entities:new Uint8Array(buffer.data,0,buffer.position),shapes:{worldVersion:WORLD_VERSION,shapes,bindings}};
}
