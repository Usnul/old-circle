import { InterpolationLog } from '@woosh/meep-engine/src/engine/interpolation/InterpolationLog.js';
import { PoseInterpolationAdapter } from '@woosh/meep-engine/src/engine/interpolation/PoseInterpolationAdapter.js';
import { TransformPoseSerializationAdapter } from '@woosh/meep-engine/src/engine/interpolation/TransformPoseSerializationAdapter.js';
import { Transform64 } from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import { BinaryBuffer } from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {RenderPlayout} from '@woosh/meep-engine/src/engine/network/time/RenderPlayout.js';
import {AdaptiveRenderDelay} from '@woosh/meep-engine/src/engine/network/time/AdaptiveRenderDelay.js';

/** One Meep pose timeline drives bodies, weapons and the camera together. */
export class PresentationPoses {
  constructor(){
    this.log=new InterpolationLog({buffer_capacity_bytes:262144,records_capacity:4096});
    this.codec=new TransformPoseSerializationAdapter();this.blend=new PoseInterpolationAdapter();
    this.buffer=new BinaryBuffer();this.transform=new Transform64();this.keys=new Map();this.frames=[];this.sequence=0;this.nextKey=1;
    this.playout=new RenderPlayout({tick_period_ms:1000/60,delay:new AdaptiveRenderDelay({tick_period_ms:1000/60,min_delay_frames:2,max_delay_frames:4,initial_delay_frames:2,safety_multiplier:1.25})});
  }
  record(key,position,rotation){
    let entry=this.keys.get(key);if(!entry){entry={id:this.nextKey++};this.keys.set(key,entry);}entry.seen=this.sequence;
    this.transform.setTranslation(...position);this.transform.setRotation(...rotation);
    this.codec.serialize(this.log.begin_record(entry.id,0),this.transform);this.log.end_record();
  }
  accept(snapshot,time){
    const sourceFrame=snapshot.presentationFrame;
    if(Number.isFinite(sourceFrame)){
      if(this.epoch!==snapshot.presentationEpoch){this.epoch=snapshot.presentationEpoch;this.frames.length=0;this.playout.reset();}
      if(!this.playout.record_arrival(time*1000,sourceFrame))return;
    }
    const tick=++this.sequence;this.log.begin_tick(tick);
    for(const a of snapshot.actors){
      this.record(a.id,[a.x,a.y,a.z],[0,Math.sin(a.yaw/2),0,Math.cos(a.yaw/2)]);
    }
    for(const corpse of snapshot.ragdolls??[])for(let i=0;i<corpse.joints.length;i++)this.record(`corpse:${corpse.key}:${i}`,corpse.joints[i].position,corpse.joints[i].rotation);
    this.log.end_tick();this.frames.push({tick,time,sourceFrame,actors:new Map(snapshot.actors.map(a=>[a.id,a]))});if(this.frames.length>16)this.frames.shift();
    for(const [key,entry] of this.keys)if(entry.seen<tick-16)this.keys.delete(key);
  }
  interval(time){
    const fixed=this.playout.has_frames;let target=time-1/30;
    if(fixed){this.playout.window(time*1000);target=this.playout.playhead;}
    const stamp=f=>fixed?f.sourceFrame:f.time;let first=this.frames[0],second=first;
    for(const f of this.frames){second=f;if(stamp(f)>=target)break;first=f;}
    const alpha=first===second?0:Math.max(0,Math.min(1,(target-stamp(first))/(stamp(second)-stamp(first))));
    return {first,second,alpha};
  }
  pose(key,{first,second,alpha}){
    const entry=this.keys.get(key);if(!entry||!first)return null;
    this.buffer.position=0;
    if(!this.log.interpolate(this.buffer,entry.id,0,first.tick,second.tick,alpha,this.blend))return null;
    this.buffer.position=0;this.codec.deserialize(this.buffer,this.transform);return this.transform;
  }
  corpse(state,time){
    const interval=this.interval(time);
    return {...state,joints:state.joints.map((joint,i)=>{
      const t=this.pose(`corpse:${state.key}:${i}`,interval);
      return t?{position:Array.from(t.translation),rotation:Array.from(t.rotation)}:joint;
    })};
  }
  sample(actor,time){
    if(!this.frames.length)return actor;
    const interval=this.interval(time),{first,second,alpha}=interval,t=this.pose(actor.id,interval);if(!t)return actor;
    // Respawns, workshop visits and authority changes must not fly through scenery.
    if(Math.hypot(t.translation_x-actor.x,t.translation_y-actor.y,t.translation_z-actor.z)>8)return actor;
    const result={...actor,x:t.translation_x,y:t.translation_y,z:t.translation_z,yaw:2*Math.atan2(t.rotation[1],t.rotation[3])};
    const a=first.actors.get(actor.id),b=second.actors.get(actor.id);
    if(a&&b){
      const state=alpha<1?a:b;
      for(const key of ['grounded','crouch','airTime','landingAge','landingStrength'])result[key]=state[key];
      for(const key of ['animationTime','gaitPhase','vx','vy','vz'])if(Number.isFinite(a[key])&&Number.isFinite(b[key]))result[key]=a[key]+(b[key]-a[key])*alpha;
      if(!a.grounded&&!b.grounded&&Number.isFinite(a.airTime)&&Number.isFinite(b.airTime))result.airTime=a.airTime+(b.airTime-a.airTime)*alpha;
      if(a.landingAge>=0&&b.landingAge>=a.landingAge)result.landingAge=a.landingAge+(b.landingAge-a.landingAge)*alpha;
      if(a.attackId===b.attackId&&a.attackAge>=0&&b.attackAge>=0)result.attackAge=a.attackAge+(b.attackAge-a.attackAge)*alpha;
    }
    return result;
  }
}
