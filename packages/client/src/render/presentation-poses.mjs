import { InterpolationLog } from '@woosh/meep-engine/src/engine/interpolation/InterpolationLog.js';
import { PoseInterpolationAdapter } from '@woosh/meep-engine/src/engine/interpolation/PoseInterpolationAdapter.js';
import { TransformPoseSerializationAdapter } from '@woosh/meep-engine/src/engine/interpolation/TransformPoseSerializationAdapter.js';
import { Transform64 } from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import { BinaryBuffer } from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';

/** One Meep pose timeline drives bodies, weapons and the camera together. */
export class PresentationPoses {
  constructor(){
    this.log=new InterpolationLog({buffer_capacity_bytes:262144,records_capacity:4096});
    this.codec=new TransformPoseSerializationAdapter();this.blend=new PoseInterpolationAdapter();
    this.buffer=new BinaryBuffer();this.transform=new Transform64();this.keys=new Map();this.frames=[];this.sequence=0;
  }
  accept(snapshot,time){
    const tick=++this.sequence;this.log.begin_tick(tick);
    for(const a of snapshot.actors){
      if(!this.keys.has(a.id))this.keys.set(a.id,this.keys.size+1);
      this.transform.setTranslation(a.x,a.y,a.z);this.transform.setRotation(0,Math.sin(a.yaw/2),0,Math.cos(a.yaw/2));
      this.codec.serialize(this.log.begin_record(this.keys.get(a.id),0),this.transform);this.log.end_record();
    }
    this.log.end_tick();this.frames.push({tick,time});if(this.frames.length>16)this.frames.shift();
  }
  sample(actor,time){
    if(!this.frames.length)return actor;
    const target=time-1/30;let first=this.frames[0],second=first;
    for(const f of this.frames){second=f;if(f.time>=target)break;first=f;}
    const alpha=first===second?0:Math.max(0,Math.min(1,(target-first.time)/(second.time-first.time)));
    this.buffer.position=0;
    if(!this.log.interpolate(this.buffer,this.keys.get(actor.id),0,first.tick,second.tick,alpha,this.blend))return actor;
    this.buffer.position=0;this.codec.deserialize(this.buffer,this.transform);const t=this.transform;
    // Respawns, workshop visits and authority changes must not fly through scenery.
    if(Math.hypot(t.translation_x-actor.x,t.translation_y-actor.y,t.translation_z-actor.z)>8)return actor;
    return {...actor,x:t.translation_x,y:t.translation_y,z:t.translation_z,yaw:2*Math.atan2(t.rotation[1],t.rotation[3])};
  }
}
