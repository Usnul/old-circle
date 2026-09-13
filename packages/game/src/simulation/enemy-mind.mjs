import {BranchBehavior} from '@woosh/meep-engine/src/engine/intelligence/behavior/util/BranchBehavior.js';
import {ConditionBehavior} from '@woosh/meep-engine/src/engine/intelligence/behavior/util/ConditionBehavior.js';
import {ActionBehavior} from '@woosh/meep-engine/src/engine/intelligence/behavior/primitive/ActionBehavior.js';
import {BehaviorStatus} from '@woosh/meep-engine/src/engine/intelligence/behavior/BehaviorStatus.js';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';
import {computeStringHash} from '@woosh/meep-engine/src/core/primitives/strings/computeStringHash.js';
import {v3_distance} from '@woosh/meep-engine/src/core/geom/vec3/v3_distance.js';
import {heightAt} from '../world/regions.mjs';
import {WEAPONS,BOSSES} from '../content/catalog.mjs';
import {armorFor} from '../content/equipment.mjs';
import {BOSS_MOVES,nextBossMove} from '../content/boss-moves.mjs';
import {castBossMove} from './boss-attacks.mjs';
import {weaponPose} from './weapon-pose.mjs';
import {rangedVelocity} from './aim.mjs';

export const enemySeed=computeStringHash;
const turn=(a,b,dt)=>a+clamp(Math.atan2(Math.sin(b-a),Math.cos(b-a)),-dt*2.6,dt*2.6);
export const BOSS_ARENA_RADIUS=29;

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
      if(Math.hypot(p.x-a.home[0],p.z-a.home[2])>=(a.boss?BOSS_ARENA_RADIUS:38))continue;
      const dx=p.x-a.x,dz=p.z-a.z,d=Math.hypot(dx,p.y-a.y,dz),horizontal=Math.max(.01,Math.hypot(dx,dz));
      const hearing=(p.crouch?1.6:a.archetype==='hound'?10:Math.hypot(p.vx,p.vz)>4?9:4)*armorFor(p).noise;
      const facing=(-Math.sin(a.yaw)*dx-Math.cos(a.yaw)*dz)/horizontal;
      const detect=a.boss?23:p.crouch?7:19;
      if(d<distance&&((a.boss&&a.active)||((a.boss||d<hearing||facing>.09)&&d<detect&&w.lineOfSight([a.x,a.y+.4,a.z],[p.x,p.y+.3,p.z],w.actors.get(a.id),w.actors.get(p.id))))){target=p;distance=d;}
    }
    if(target){a.targetId=target.id;a.memory=6;}
    else if(a.memory>0){a.memory-=this.dt;const p=w.actor(a.targetId);if(p?.hp>0&&Math.hypot(p.x-a.home[0],p.z-a.home[2])<(a.boss?BOSS_ARENA_RADIUS:38)){target=p;distance=Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z);}}
    this.target=target;this.distance=distance;return target!==null;
  }
  steer(goal,speed,dt){
    const w=this.world,a=this.actor,dx=goal[0]-a.x,dz=goal[2]-a.z,d=Math.hypot(dx,dz);let next=goal;
    const halfHeight=a.boss?1.2675:.845,from=[a.x,a.y-halfHeight,a.z],to=[goal[0],goal[1]-(this.target&&goal[0]===this.target.x&&goal[2]===this.target.z?(this.target.boss?1.2675:.845):halfHeight),goal[2]];
    if((d>.1||Math.abs(from[1]-to[1])>.65)&&(w.navigation?.inDungeon(from)||w.navigation?.inDungeon(to)||!w.lineOfSight([a.x,a.y,a.z],[goal[0],goal[1],goal[2]],w.actors.get(a.id),this.target&&w.actors.get(this.target.id)))){
      if(!a.path||w.tick-(a.pathTick??0)>60){
        const result=w.navigation?.tile(a.home).path(from,to);
        a.path=result?.reachable?result.points:[];a.pathTick=w.tick;
      }
      while(a.path?.length&&v3_distance(...a.path[0],...from)<.65)a.path.shift();
      next=a.path?.[0];
      if(!next){a.intent={x:0,z:0,yaw:a.yaw,buttons:0};return false;}
    }
    const x=next[0]-a.x,z=next[2]-a.z,length=Math.max(.01,Math.hypot(x,z));
    a.intent={x:x/length*speed,z:z/length*speed,yaw:turn(a.yaw,Math.atan2(-x,-z),dt),buttons:0};return true;
  }
  patrol(dt){
    const w=this.world,a=this.actor,seed=enemySeed(a.id),homeDistance=Math.hypot(a.x-a.home[0],a.z-a.home[2]);
    a.windup=0;
    if(a.returning){
      a.phase='return';
      if(homeDistance<.65){
        if(a.hp>=a.healthMax){a.returning=false;a.active=false;}
        a.intent={x:0,z:0,yaw:a.yaw,buttons:0};
      }else this.steer(a.home,1,dt);
      return;
    }
    if(homeDistance>(a.boss?8:14)){a.phase='return';this.steer(a.home,.7,dt);return;}
    if(a.patrolWaitUntil===undefined)a.patrolWaitUntil=w.tick+seed%180;
    if(w.tick<a.patrolWaitUntil){
      a.phase='watch';const facing=(seed%628)/100+Math.sin(a.animationTime*.35)*.45;
      a.intent={x:0,z:0,yaw:turn(a.yaw,facing,dt),buttons:0};return;
    }
    if(!a.patrolGoal){
      a.patrolIndex=(a.patrolIndex??0)+1;const angle=(seed%628)/100+a.patrolIndex*2.399963,radius=a.boss?2.5:3+(seed+a.patrolIndex)%5;
      const patrolRadius=a.dungeon?2:radius,x=a.home[0]+Math.cos(angle)*patrolRadius,z=a.home[2]+Math.sin(angle)*patrolRadius;
      a.patrolGoal=[x,a.dungeon?a.home[1]:heightAt(x,z)+(a.boss?1.2675:.845),z];a.path=null;a.patrolDeadline=w.tick+900;
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
    const dx=target.x-a.x,dz=target.z-a.z,ranged=WEAPONS[a.weapon].style!=='melee',moveId=a.boss?nextBossMove(a):null;
    const aim=()=>{
      if(!ranged)return;
      const velocity=rangedVelocity(weaponPose(a).origin,[target.x,target.y+.3,target.z],WEAPONS[a.weapon].speed,a.weapon==='bow'?9.81:0);
      a.intent.pitch=-Math.atan2(velocity[1],Math.hypot(velocity[0],velocity[2]));
    };
    const range=a.boss&&moveId!=='weapon'?BOSS_MOVES[moveId].range:ranged?12:a.boss?3.3:a.weapon==='spear'?2:1.65;
    a.phase=distance>range?'pursue':'windup';
    if(a.windup>0){
      a.windup-=dt;a.intent={x:0,z:0,yaw:turn(a.yaw,Math.atan2(-dx,-dz),dt),buttons:0};
      if(a.windup<=0){
        if(a.boss&&BOSS_MOVES[a.bossMove]?.clip){castBossMove(w,a,a.bossMove);a.cooldown=BOSS_MOVES[a.bossMove].recovery+.85;}
        else{if(a.attackKind==='nova')w.nova(a,8,BOSSES[a.archetype].damage,'shockwave');else w.attack(a);a.cooldown=a.boss?2.6:1.7;}
      }aim();return;
    }
    if(a.attackAge>=0){a.phase='attack';a.intent={x:0,z:0,yaw:ranged&&!a.projectileReleased?turn(a.yaw,Math.atan2(-dx,-dz),dt):a.yaw,pitch:a.intent.pitch??0,buttons:0};if(!a.projectileReleased)aim();return;}
    if(distance>range)this.steer([target.x,target.y,target.z],1,dt);
    else if(ranged&&distance<5){a.phase='retreat';this.steer([a.x-dx,a.y,a.z-dz],.65,dt);a.intent.yaw=turn(a.yaw,Math.atan2(-dx,-dz),dt);}
    else a.intent={x:0,z:0,yaw:turn(a.yaw,Math.atan2(-dx,-dz),dt),buttons:0};
    aim();
    if(distance<=range&&a.cooldown===0){a.bossMove=moveId??'';a.windup=a.boss?BOSS_MOVES[moveId].windup:.65;a.attackKind=a.boss&&moveId!=='weapon'?'ritual':'weapon';w.event('telegraph',a,{effect:a.attackKind,move:a.bossMove,radius:range});}
  }
}
