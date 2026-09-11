import {actorRig,actorScale,actorSocket,rigs} from './animation.mjs';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';

const socket=new Transform64(),point=new Vector3(),toe=new Vector3();
/** Sample the same Blender clips, blend weights and presented pose as the skin. */
export function presentedFeet(a){
  const hound=a.archetype==='hound',scale=actorScale(a),data=rigs[actorRig(a)];
  return (hound?['lowerFL','lowerFR','lowerBL','lowerBR']:['footL','footR']).map(name=>{
    actorSocket(socket,a,name);const length=data.bones.find(b=>b.name===name).length;
    point.set(0,hound?length:length*.5,0).applyMatrix4(socket);
    toe.set(0,length,0).applyMatrix4(socket);
    const heading=hound?[-Math.sin(a.yaw),0,-Math.cos(a.yaw)]:[toe.x-socket.translation_x,toe.y-socket.translation_y,toe.z-socket.translation_z];
    return {name,position:[point.x,point.y-(hound?.055:.08)*scale,point.z],heading,scale,hound};
  });
}

/** Contact hysteresis is spatial. Time only suppresses duplicates after replay. */
export class FootContacts {
  constructor(){this.feet=new Map();this.epoch=null;}
  reset(epoch){this.epoch=epoch;this.feet.clear();}
  sample(a,foot,hit,now){
    const key=`${a.id}:${foot.name}`,gait=a.gaitPhase??0,scale=foot.scale;
    let state=this.feet.get(key);
    const valid=a.hp>0&&a.grounded&&!a.mantle,normal=hit?.normal;
    const gap=hit?(foot.position[1]-hit.position[1])*normal[1]:Infinity;
    const close=valid&&normal?.[1]>.65&&gap>=-.12*scale&&gap<.035*scale;
    if(!state){this.feet.set(key,{down:close,high:gait,lastGait:gait,lastTime:now,seen:now,air:!a.grounded});return false;}
    state.seen=now;
    // A correction can revisit a footfall. Wait until its travel catches up.
    if(gait<state.high-.025){state.down=close;return false;}state.high=Math.max(state.high,gait);
    if(!valid){state.down=false;state.air=!a.grounded;return false;}
    if(!close){if(gap>.07*scale||!normal||normal[1]<=.65)state.down=false;return false;}
    if(state.down)return false;state.down=true;
    const landed=state.air;state.air=false;
    if(now-state.lastTime<.12||(!landed&&gait-state.lastGait<(foot.hound?.22:.36)*scale))return false;
    state.lastTime=now;state.lastGait=gait;return true;
  }
  prune(now){for(const [key,state] of this.feet)if(now-state.seen>2)this.feet.delete(key);}
}
