import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {Quaternion} from '@woosh/meep-engine/src/core/geom/Quaternion.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Transform64SerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64SerializationAdapter.js';

const quaternion=new Quaternion(),adapter=new Transform64SerializationAdapter(),packed=new BinaryBuffer();

/** Author the same placed transform for native render entities and collision hulls. */
export function propTransform(prop){
  const {position,scale,yaw,up}=prop,transform=new Transform64();
  const rotation=up?quaternion._lookRotation(Math.sin(yaw),-(up[0]*Math.sin(yaw)+up[2]*Math.cos(yaw))/up[1],Math.cos(yaw),...up):[0,Math.sin(yaw/2),0,Math.cos(yaw/2)];
  transform.setTranslation(...position);transform.setScale(...scale);transform.setRotation(...rotation);transform.updateMatrix();return transform;
}

/** Native serialization packs rotation and scale. Bake geometry from that pose. */
export function bakedPropTransform(prop){
  const transform=propTransform(prop);
  packed.position=0;adapter.serialize(packed,transform);packed.position=0;adapter.deserialize(packed,transform);return transform;
}
