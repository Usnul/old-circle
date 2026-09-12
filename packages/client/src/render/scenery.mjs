import {AABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/AABB3.js';
import {serializeAABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/serializeAABB3.js';
import {deserializeAABB3} from '@woosh/meep-engine/src/core/geom/3d/aabb/deserializeAABB3.js';
import {BinaryClassSerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/storage/binary/BinaryClassSerializationAdapter.js';

/** Authored placement information; SGMesh holds the currently displayed LOD. */
export class Scenery {
  static typeName = 'OldCircleScenery';
  model = '';
  bounds = new AABB3();
  relic = null;
}

export class ScenerySerializationAdapter extends BinaryClassSerializationAdapter {
  klass = Scenery;
  version = 0;

  serialize(buffer, scenery) {
    buffer.writeUTF8String(scenery.model);
    serializeAABB3(buffer, scenery.bounds);
    buffer.writeUTF8String(scenery.relic);
  }

  deserialize(buffer, scenery) {
    scenery.model = buffer.readUTF8String();
    deserializeAABB3(buffer, scenery.bounds);
    scenery.relic = buffer.readUTF8String();
  }
}
