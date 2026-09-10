import {BranchBehavior} from '@woosh/meep-engine/src/engine/intelligence/behavior/util/BranchBehavior.js';
import {ConditionBehavior} from '@woosh/meep-engine/src/engine/intelligence/behavior/util/ConditionBehavior.js';
import {ActionBehavior} from '@woosh/meep-engine/src/engine/intelligence/behavior/primitive/ActionBehavior.js';
import {BehaviorStatus} from '@woosh/meep-engine/src/engine/intelligence/behavior/BehaviorStatus.js';
import {SpatialAtlas} from '../world/spatial-atlas.mjs';
import {heightAt} from '../world/regions.mjs';
import {WEAPONS,BOSSES} from '../content/catalog.mjs';

export const enemySeed=id=>Array.from(id).reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,4171);
const turn=(a,b,dt)=>a+Math.max(-dt*2.6,Math.min(dt*2.6,Math.atan2(Math.sin(b-a),Math.cos(b-a))));

/** Meep behaviour tree, with replayable memory stored on the Actor component. */
export class EnemyMind {
  constructor(world){
    this.world=world;
    this.tree=BranchBehavior.from(new ConditionBehavior(()=>this.detect()),ActionBehavior.from(dt=>this.combat(dt)),ActionBehavior.from(dt=>this.patrol(dt)));
  }
  tick(actor,dt){
    this.actor=actor;this.dt=dt;this.tree.initialize({actor,world:this.world});
    const status=this.tree.tick(dt);this.tree.finalize();if(status===BehaviorStatus.Failed)throw new Error(`Enemy behaviour failed: ${actor.id}`);
  }
  detect(){
    const w=this.world,a=this.actor;let target=null,distance=Infinity;
    for(const id of w.actors.keys()){
      const p=w.actor(id);if(p.kind!=='player'||p.hp<=0)continue;
      if(Math.hypot(p.x-a.home[0],p.z-a.home[2])>(a.boss?29:38))continue;
      const dx=p.x-a.x,dz=p.z-a.z,d=Math.hypot(dx,p.y-a.y,dz),horizontal=Math.max(.01,Math.hypot(dx,dz));
      const hearing=p.crouch?1.6:a.archetype==='hound'?10:Math.hypot(p.vx,p.vz)>4?9:4;
      const facing=(-Math.sin(a.yaw)*dx-Math.cos(a.yaw)*dz)/horizontal;
      const detect=a.boss?23:p.crouch?7:19;
      if(d<distance&&(a.boss||d<hearing||facing>.09)&&d<detect&&w.lineOfSight([a.x,a.y+.4,a.z],[p.x,p.y+.3,p.z],w.actors.get(a.id),w.actors.get(p.id))){target=p;distance=d;}
    }
    if(target){a.targetId=target.id;a.memory=6;}
    else if(a.memory>0){a.memory-=this.dt;const p=w.actor(a.targetId);if(p?.hp>0&&Math.hypot(p.x-a.home[0],p.z-a.home[2])<(a.boss?29:38)){target=p;distance=Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z);}}
    this.target=target;this.distance=distance;return target!==null;
  }
  steer(goal,speed,dt){
    const w=this.world,a=this.actor,dx=goal[0]-a.x,dz=goal[2]-a.z,d=Math.hypot(dx,dz);let next=goal;
    if(d>.1&&!w.lineOfSight([a.x,a.y,a.z],[goal[0],goal[1],goal[2]],w.actors.get(a.id),this.target&&w.actors.get(this.target.id))){
      const key=`${Math.floor(a.home[0]/40)},${Math.floor(a.home[2]/40)}`;
      let atlas=w.navigation.get(key);if(!atlas){const [x,z]=key.split(',').map(v=>Number(v)*40);atlas=new SpatialAtlas(w,{bounds:[x-32,z-32,x+72,z+72],spacing:2}).build();w.navigation.set(key,atlas);}
      if(!a.path||w.tick-(a.pathTick??0)>60){a.path=atlas.path([a.x,a.y-.845,a.z],[goal[0],goal[1]-.845,goal[2]]).points;a.pathTick=w.tick;}
      while(a.path?.length&&Math.hypot(a.path[0][0]-a.x,a.path[0][2]-a.z)<.8)a.path.shift();
      next=a.path?.[0];
      if(!next){a.intent={x:0,z:0,yaw:a.yaw,buttons:0};return false;}
    }
    const x=next[0]-a.x,z=next[2]-a.z,length=Math.max(.01,Math.hypot(x,z));
    a.intent={x:x/length*speed,z:z/length*speed,yaw:turn(a.yaw,Math.atan2(-x,-z),dt),buttons:0};return true;
  }
  patrol(dt){
    const w=this.world,a=this.actor,seed=enemySeed(a.id),homeDistance=Math.hypot(a.x-a.home[0],a.z-a.home[2]);
    a.windup=0;
    if(homeDistance>(a.boss?8:14)){a.phase='return';this.steer(a.home,.7,dt);return;}
    if(a.patrolWaitUntil===undefined)a.patrolWaitUntil=w.tick+seed%180;
    if(w.tick<a.patrolWaitUntil){
      a.phase='watch';const facing=(seed%628)/100+Math.sin(a.animationTime*.35)*.45;
      a.intent={x:0,z:0,yaw:turn(a.yaw,facing,dt),buttons:0};return;
    }
    if(!a.patrolGoal){
      a.patrolIndex=(a.patrolIndex??0)+1;const angle=(seed%628)/100+a.patrolIndex*2.399963,radius=a.boss?2.5:3+(seed+a.patrolIndex)%5;
      const x=a.home[0]+Math.cos(angle)*radius,z=a.home[2]+Math.sin(angle)*radius;
      a.patrolGoal=[x,heightAt(x,z)+(a.boss?1.2675:.845),z];a.path=null;a.patrolDeadline=w.tick+900;
    }
    a.phase='patrol';
    if(Math.hypot(a.patrolGoal[0]-a.x,a.patrolGoal[2]-a.z)<.65||w.tick>a.patrolDeadline||!this.steer(a.patrolGoal,a.archetype==='hound'?.28:.4,dt)){
      a.patrolGoal=null;a.path=null;a.patrolWaitUntil=w.tick+120+(seed+(a.patrolIndex??0)*73)%240;
      a.intent={x:0,z:0,yaw:a.yaw,buttons:0};
    }
  }
  combat(dt){
    const w=this.world,a=this.actor,target=this.target,distance=this.distance;
    a.active=true;a.patrolGoal=null;
    const dx=target.x-a.x,dz=target.z-a.z,ranged=WEAPONS[a.weapon].style!=='melee',range=ranged?12:a.boss?3.3:a.weapon==='spear'?2:1.65;
    a.phase=distance>range?'pursue':'windup';
    if(a.windup>0){
      a.windup-=dt;a.intent={x:0,z:0,yaw:turn(a.yaw,Math.atan2(-dx,-dz),dt),buttons:0};
      if(a.windup<=0){if(a.attackKind==='nova')w.nova(a,8,BOSSES[a.archetype].damage,'shockwave');else w.attack(a);a.cooldown=a.boss?2.6:1.7;}return;
    }
    if(a.attackAge>=0){a.phase='attack';a.intent={x:0,z:0,yaw:a.yaw,buttons:0};return;}
    if(distance>range)this.steer([target.x,target.y,target.z],1,dt);
    else if(ranged&&distance<5){a.phase='retreat';this.steer([a.x-dx,a.y,a.z-dz],.65,dt);a.intent.yaw=turn(a.yaw,Math.atan2(-dx,-dz),dt);}
    else a.intent={x:0,z:0,yaw:turn(a.yaw,Math.atan2(-dx,-dz),dt),buttons:0};
    if(distance<=range&&a.cooldown===0){a.windup=a.boss?1.15:.65;a.attackKind=a.boss&&a.attackId%3===2?'nova':'weapon';w.event('telegraph',a,{effect:a.attackKind,radius:a.attackKind==='nova'?8:range});}
  }
}
