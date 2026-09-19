import { EntityComponentDataset } from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import { EntityManager } from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import { Transform64 } from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import { PhysicsSystem } from '@woosh/meep-engine/src/engine/physics/ecs/PhysicsSystem.js';
import { ColliderObserverSystem } from '@woosh/meep-engine/src/engine/physics/ecs/ColliderObserverSystem.js';
import { RigidBody } from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import { BodyKind } from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import { Collider } from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import { CapsuleShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/CapsuleShape3D.js';
import { SphereShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/SphereShape3D.js';
import { Ray3 } from '@woosh/meep-engine/src/core/geom/3d/ray/Ray3.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import { PhysicsSurfacePoint } from '@woosh/meep-engine/src/engine/physics/queries/PhysicsSurfacePoint.js';
import { Actor, Projectile } from './components.mjs';
import { sphereSweep } from './sphere-sweep.mjs';
import { weaponPose } from './weapon-pose.mjs';
import {selectMeleeAttack} from './melee-selection.mjs';
import {MELEE_ATTACKS} from '../content/melee-attacks.mjs';
import {rangedSightOrigin,rangedVelocity} from './aim.mjs';
import {loadStaticScene} from '../world/static-scene-data.mjs';
import {EnemyMind,enemySeed,BOSS_ARENA_RADIUS} from './enemy-mind.mjs';
import { heightAt, landmarkPosition, REGIONS, SPAWN,WORLD_VERSION,WORLD_KILL_VOLUME,HEARTHS } from '../world/regions.mjs';
import {restStatus,hearthArrival} from './resting.mjs';
import { buildLayout } from '../world/layout.mjs';
import {CAVES} from '../world/interiors.mjs';
import {DUNGEONS,dungeonPoint} from '../world/dungeons.mjs';
import {loadNavigation} from '../world/navigation-data.mjs';
import { WEAPONS, BOSSES, ENEMIES, ORIGINS, canDamage, maxHealth, maxStamina, maxMana, levelCost, enemyDamage } from '../content/catalog.mjs';
import {ARMOR,armorFor,migrateInventory,weaponDamage,reinforcementLimit,reinforcementCost,hasAllSeals} from '../content/equipment.mjs';
import {updateStamina} from './stamina.mjs';
import {BOSS_MOVES} from '../content/boss-moves.mjs';
import {stepHazard,clearBossHazards} from './boss-attacks.mjs';
import {knownRelics,flaskCapacity,nearbyRelic} from '../content/relics.mjs';
import {CHARMS,ownsCharm,charmFor,focusCost,charmDamage} from '../content/charms.mjs';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';
import {smoothStep} from '@woosh/meep-engine/src/core/math/smoothStep.js';

export const DT=1/60;
export const BUTTON={SPRINT:1,CROUCH:2,JUMP:4,ATTACK:8,NOVA:16,HEAL:32,INTERACT:64};
const rotation=[0,0,0,1];
const kill=WORLD_KILL_VOLUME;
const q=[0,0,0,1];
const BOSS_RETURN_REGEN_RATE=0.05;
// Standing clearance is tested every tick that a body crouches or reaches for a
// ledge; the query capsule is reused rather than rebuilt for each test.
const standing=CapsuleShape3D.from(.32,1.05);
const motionFields=['yaw','vx','vy','vz','animationTime','gaitPhase','cooldown','hurtTime','attackAge','attackId','deadTime','deathTick','lastButtons'];
const optionalMotion={airTime:0,fallSpeed:0,landingAge:-1,landingStrength:0};

export class GameWorld {
  constructor(){
    this.em=new EntityManager();this.ecd=new EntityComponentDataset();this.physics=new PhysicsSystem();
    this.em.addSystem(this.physics);this.em.addSystem(new ColliderObserverSystem(this.physics));this.em.attachDataset(this.ecd);
    for(const c of [Transform64,RigidBody,Collider,Actor,Projectile])this.ecd.registerComponentType(c);
    this.actors=new Map();this.projectiles=new Set();this.events=[];this.tick=0;this.time=15.2;this.layout=buildLayout();
    this.ray=new Ray3();this.hit=new PhysicsSurfacePoint();this.overlaps=new Uint32Array(512);
    this.navigation=null;this.mind=new EnemyMind(this);this.predictionSleeping=new Set();this.contactSurfaces=new Map();
    this.authoredActors=new Map();this.dormantActors=new Map();this.scopedAuthority=false;
  }
  async start({populate=true,navigation=true}={}){
    const scene=await loadStaticScene(this.ecd,{startSystems:()=>new Promise((resolve,reject)=>this.em.startup(resolve,reject))});
    this.layout.solids=scene.solids;this.contactSurfaces=scene.contactSurfaces;this.terrainEntity=scene.terrainEntity;
    if(navigation)this.navigation=await loadNavigation();
    if(populate){this.populate();this.authoredActors=new Map([...this.actors.keys()].map(id=>this.actor(id)).filter(a=>a.kind==='enemy').map(a=>[a.id,structuredClone(a)]));}
    // Statics are linked; reshape the broadphase once so every later query walks fewer nodes.
    this.physics.optimize();return this;
  }
  footSurface(position,scale=1){
    this.ray.set([position[0],position[1]+.18*scale,position[2],0,-1,0,.45*scale]);
    if(!this.physics.raycast(this.ray,this.hit,e=>this.ecd.getComponent(e,RigidBody)?.kind===BodyKind.Static))return null;
    return {position:Array.from(this.hit.position),normal:Array.from(this.hit.normal),surface:this.hit.entity===this.terrainEntity?'terrain':this.contactSurfaces.get(this.hit.entity)??'stone'};
  }
  body(position,shape,kind=BodyKind.Dynamic,friction=.8){
    const e=this.ecd.createEntity(),t=new Transform64(),b=new RigidBody(),c=new Collider();
    t.setTranslation(...position);b.kind=kind;b.mass=75;b.linearDamping=.05;c.shape=shape;c.friction=friction;
    this.ecd.addComponentToEntity(e,t);this.ecd.addComponentToEntity(e,b);this.ecd.addComponentToEntity(e,c);return e;
  }
  populate(){
    let index=0;
    for(const region of REGIONS){
      for(let i=0;i<7;i++){
        const x=region.center[0]+Math.sin(i*2.3)*22,z=region.center[1]-16-i*5;
        const type=region.enemies[i%region.enemies.length],def=ENEMIES[type];
        this.spawnActor(`enemy-${index++}`,{kind:'enemy',archetype:type,name:def.name,level:region.level[0],weapon:def.weapon,hp:def.health+region.level[0]*3,healthMax:def.health+region.level[0]*3},[x,heightAt(x,z)+1,z]);
      }
      const boss=BOSSES[region.boss],p=landmarkPosition(boss.landmark);
      if(region.id==='magic')p[2]+=8;
      const weapon=region.id==='magic'?'staff':region.id==='desert'?'bow':region.id==='wood'?'sword':'spear';
      this.spawnActor(`boss-${region.boss}`,{kind:'enemy',archetype:region.boss,name:boss.name,boss:true,level:boss.level,hp:boss.health,healthMax:boss.health,weapon},[p[0],heightAt(p[0],p[2])+1.7,p[2]]);
    }
    const [kx,kz]=CAVES[0].keeper;
    this.spawnActor('cave-keeper',{kind:'enemy',archetype:'mage',name:'The Lost Bellkeeper',weapon:'staff',hp:100,healthMax:100},[kx,heightAt(kx,kz)+1,kz]);
    for(const dungeon of DUNGEONS)for(const enemy of dungeon.encounters){
      const p=dungeonPoint(dungeon,enemy.at);p[1]+=.85;
      this.spawnActor(`${dungeon.id}-${enemy.id}`,{kind:'enemy',archetype:enemy.type,name:enemy.name,level:dungeon.level??3,weapon:ENEMIES[enemy.type].weapon,hp:enemy.health,healthMax:enemy.health,dungeon:dungeon.id},p);
    }
  }
  spawnActor(id,values={},position){
    const a=Object.assign(new Actor(),values,{id});
    const p=position??[SPAWN[0],heightAt(SPAWN[0],SPAWN[2])+1,SPAWN[2]];
    a.x=p[0];a.y=p[1];a.z=p[2];a.home=[...p];
    if(a.kind==='enemy')this.navigation?.tile(a.home);
    if(a.kind==='enemy'){const seed=enemySeed(id);a.animationTime=(seed%1000)/73;a.gaitPhase=(seed%100)/31;a.yaw=(seed*2.399963)%6.283185;a.intent.yaw=a.yaw;}
    const scale=a.boss?1.5:1;
    const e=this.body(p,CapsuleShape3D.from(.32*scale,1.05*scale),BodyKind.Dynamic,0);
    this.ecd.addComponentToEntity(e,a);this.actors.set(id,e);return a;
  }
  addPlayer(id,origin='pilgrim',saved){
    const o=ORIGINS.find(x=>x.id===origin)??ORIGINS[0];
    const a=this.spawnActor(id,{kind:'player',name:o.name,origin:o.id,stats:{...o.stats},weapon:o.weapon});
    a.checkpoint=[a.x,a.y,a.z];
    a.inventory=migrateInventory({armor:origin==='wayfarer'?'wayfarer':origin==='ember'?'keeper':'mail'},o.weapon);
    a.healthMax=maxHealth(a.stats);a.hp=a.healthMax;a.staminaMax=maxStamina(a.stats);a.stamina=a.staminaMax;a.manaMax=maxMana(a.stats);a.mana=a.manaMax;
    if(saved)this.importCharacter(id,saved);
    return a;
  }
  actor(id){const e=this.actors.get(id);return e===undefined?undefined:this.ecd.getComponent(e,Actor);}
  input(id,intent){const a=this.actor(id);if(a)a.intent={x:clamp(Number(intent.x)||0,-1,1),z:clamp(Number(intent.z)||0,-1,1),yaw:Number.isFinite(Number(intent.yaw))?Number(intent.yaw):0,pitch:Number.isFinite(Number(intent.pitch))?clamp(Number(intent.pitch),-1.35,1.35):0,buttons:(intent.buttons|0)&127};}
  equip(id,weapon){const a=this.actor(id);if(a&&Object.hasOwn(WEAPONS,weapon)&&a.attackAge<0&&(a.kind!=='player'||a.inventory.weapons.includes(weapon)))a.weapon=weapon;}
  equipArmor(id,armor){
    const a=this.actor(id);
    if(!a||!Object.hasOwn(ARMOR,armor)||!a.inventory.armors.includes(armor)||restStatus(a,[...this.actors.keys()].map(id=>this.actor(id))).reason)return false;
    a.inventory.armor=armor;this.event('armor-equipped',a,{armor});return true;
  }
  equipCharm(id,charm){
    const a=this.actor(id);
    if(!a||a.kind!=='player'||!Object.hasOwn(CHARMS,charm)||!ownsCharm(a,charm)||restStatus(a,[...this.actors.keys()].map(id=>this.actor(id))).reason)return false;
    a.inventory.charm=charm;this.event('charm-equipped',a,{charm});return true;
  }
  reinforce(id,weapon){
    const a=this.actor(id);
    if(!a||!a.inventory.weapons.includes(weapon)||restStatus(a,[...this.actors.keys()].map(id=>this.actor(id))).reason)return false;
    const rank=a.inventory.reinforcements[weapon]??0,cost=reinforcementCost(a,weapon);
    if(rank>=reinforcementLimit(a)||a.embers<cost)return false;
    a.embers-=cost;a.inventory.reinforcements[weapon]=rank+1;
    this.event('weapon-reinforced',a,{weapon,rank:rank+1});return true;
  }
  event(type,actor,data={}){this.events.push({key:`${this.tick}:${actor.id}:${type}:${this.events.length}`,type,id:actor.id,position:[actor.x,actor.y,actor.z],tick:this.tick,...data});}
  step(dt=DT,{predictPlayer}={}){
    this.tick++;this.time=(this.time+dt/90)%24;this.events=[];
    const predicted=predictPlayer&&this.actor(predictPlayer);
    if(!predicted)this.checkEncounters();
    if(!predicted){for(const b of this.predictionSleeping)this.physics.wake(b);this.predictionSleeping.clear();}
    for(const [id,e] of this.actors){
      const a=this.actor(id),t=this.ecd.getComponent(e,Transform64),b=this.ecd.getComponent(e,RigidBody);
      // Prediction owns one character. Distant server actors cannot collide
      // with it during this short replay; keep their ECS/collider rows warm,
      // but suspend their physics through Meep until local authority resumes.
      if(predicted&&a.id!==predictPlayer&&Math.hypot(a.x-predicted.x,a.y-predicted.y,a.z-predicted.z)>24){this.physics.sleep(b);this.predictionSleeping.add(b);continue;}
      if(this.predictionSleeping.delete(b))this.physics.wake(b);
      if(a.hp<=0){
        this.syncActorCollider(a);b.gravityScale=0;
        a.deadTime+=dt;b.linearVelocity.fill(0);
        if(a.kind==='player'&&a.deadTime>4)this.respawn(a);
        if(a.kind==='enemy'&&a.deadTime>(a.boss?1200:180)&&![...this.actors.keys()].some(pid=>{const p=this.actor(pid);return p.kind==='player'&&p.hp>0&&Math.hypot(p.x-a.home[0],p.z-a.home[2])<30;})){
          a.hp=a.healthMax;a.deadTime=0;a.active=false;a.returning=false;a.attackAge=-1;a.windup=0;a.bossMove='';a.attackId=0;a.cooldown=1;a.memory=0;a.targetId=null;this.teleport(a,a.home);
        }
        continue;
      }
      a.hurtTime=Math.max(0,a.hurtTime-dt);a.cooldown=Math.max(0,a.cooldown-dt);
      if(!predicted&&a.kind==='enemy'&&a.boss&&a.returning&&a.hp<a.healthMax)a.hp=Math.min(a.healthMax,a.hp+a.healthMax*BOSS_RETURN_REGEN_RATE*dt);
      this.syncActorCollider(a);
      a.animationTime+=dt;a.gaitPhase+=Math.hypot(a.vx,a.vz)*dt;
      if(a.landingAge>=0){a.landingAge+=dt;if(a.landingAge>.22)a.landingAge=-1;}
      const armor=a.kind==='player'?armorFor(a):null,charm=charmFor(a);
      a.mana=Math.min(a.manaMax,a.mana+dt*(armor?.focus??3)*(charm.focus??1));
      if(a.kind==='enemy'&&!predicted)this.think(a,dt);
      const input=a.intent,buttons=input.buttons,pressed=buttons&~a.lastButtons;a.lastButtons=buttons;
      if(!!(buttons&BUTTON.CROUCH)!==a.crouch)this.setCrouch(a,!!(buttons&BUTTON.CROUCH));a.yaw=input.yaw;
      const halfHeight=a.boss?1.2675:a.crouch?.495:.845;
      this.ray.set([a.x,a.y,a.z,0,-1,0,halfHeight+.14]);
      // Support is lost by separating from the surface, not by moving uphill.
      a.grounded=this.physics.raycast(this.ray,this.hit,other=>other!==e)&&this.hit.normal[1]>.64&&b.linearVelocity.reduce((sum,v,i)=>sum+v*this.hit.normal[i],0)<.8;
      if(a.grounded){
        if(a.airTime>.12&&a.fallSpeed>1.6&&!a.mantle){a.landingAge=0;a.landingStrength=Math.min(1,.3+(a.fallSpeed-1.6)/7);}
        a.airTime=0;a.fallSpeed=0;
      }else{a.airTime+=dt;a.fallSpeed=Math.max(a.fallSpeed,-b.linearVelocity[1]);}
      const normal=a.grounded?Array.from(this.hit.normal):[0,1,0],radius=.32*(a.boss?1.5:1);
      const supportGap=a.grounded?this.hit.t-halfHeight-radius*(1/normal[1]-1):0;
      const len=Math.hypot(input.x,input.z),sprinting=updateStamina(a,dt,{held:!!(buttons&BUTTON.SPRINT),moving:len>0,regeneration:(armor?.stamina??22)*(charm.stamina??1)});
      const speed=a.kind==='enemy'?(a.boss?2.3:ENEMIES[a.archetype]?.speed??2.2):(a.crouch?1.65:sprinting?6.7:3.5)*armor.speed*(charm.speed??1);
      const blend=Math.min(1,dt*(a.grounded?15:4)),control=a.hurtTime>0?.18:1;
      if(len>0||supportGap>.025||(pressed&BUTTON.JUMP))this.physics.wake(b);
      b.linearVelocity[0]+=(input.x/Math.max(1,len)*speed-b.linearVelocity[0])*blend*control;
      b.linearVelocity[2]+=(input.z/Math.max(1,len)*speed-b.linearVelocity[2])*blend*control;
      // A supported motor cancels gravity, not collisions. Tangent velocity follows
      // the surface; airborne and hurt bodies retain ordinary dynamic gravity.
      b.gravityScale=a.grounded&&a.hurtTime===0?0:1;
      if(a.grounded&&a.hurtTime===0){
        if(len===0&&Math.hypot(b.linearVelocity[0],b.linearVelocity[2])<.03){b.linearVelocity[0]=0;b.linearVelocity[2]=0;}
        // The support probe extends below the capsule. Approach actual contact
        // through velocity; cancelling gravity at the probe margin leaves feet
        // suspended above the surface and prevents a sleeping body settling.
        const adhesion=Math.max(0,supportGap-.005)*18*normal[1]+(len>0?.12:0);
        b.linearVelocity[1]=-(normal[0]*b.linearVelocity[0]+normal[2]*b.linearVelocity[2])/normal[1];
        // Pull along the contact normal so the solver cancels only adhesion.
        // A vertical pull projects into downhill motion on a cross-slope.
        for(let i=0;i<3;i++)b.linearVelocity[i]-=normal[i]*adhesion;
      }
      if((pressed&BUTTON.JUMP)&&a.grounded&&a.stamina>=12){b.linearVelocity[1]=6.4;b.gravityScale=1;a.grounded=false;a.airTime=0;a.fallSpeed=0;a.landingAge=-1;a.stamina-=12;this.event('jump',a);}
      if((buttons&BUTTON.JUMP)&&!a.grounded&&!a.mantle)this.tryMantle(a,e);
      if(a.mantle){
        const mantle=a.mantle;mantle.t+=dt;
        if(mantle.phase==='hang'){
          if(buttons&BUTTON.CROUCH){a.mantle=null;b.linearVelocity[1]=-1;}
          else{
            this.physics.setPose(b,mantle.from,rotation);b.linearVelocity.fill(0);
            if((pressed&BUTTON.JUMP)||((buttons&BUTTON.JUMP)&&mantle.t>.22)){mantle.phase='climb';mantle.t=0;this.event('mantle',a);}
          }
        }else{
          const k=Math.min(1,mantle.t/.4),s=smoothStep(0,1,k),p=mantle.from.map((v,i)=>v+(mantle.to[i]-v)*s);
          this.physics.setPose(b,p,rotation);b.linearVelocity.fill(0);if(k===1)a.mantle=null;
        }
      }
      if((buttons&BUTTON.ATTACK)&&a.cooldown===0)this.attack(a);
      if((pressed&BUTTON.NOVA)&&a.kind==='player'&&a.cooldown===0&&a.mana>=focusCost(a,28)){a.mana-=focusCost(a,28);a.cooldown=1.2;this.nova(a,6.5,(30+a.stats.insight*.85)*charmDamage(a,'magic'),'frost');}
      if((pressed&BUTTON.HEAL)&&a.flasks>0&&a.hp<a.healthMax){a.flasks--;a.hp=Math.min(a.healthMax,a.hp+70);this.event('heal',a);}
      if((pressed&BUTTON.INTERACT)&&a.kind==='player')this.interact(a);
      if(a.attackAge>=0)this.advanceAttack(a,dt);
      t.setRotation(0,Math.sin(a.yaw/2),0,Math.cos(a.yaw/2));
    }
    this.physics.fixedUpdate(dt);
    for(const [id,e] of this.actors){
      const a=this.actor(id),t=this.ecd.getComponent(e,Transform64),b=this.ecd.getComponent(e,RigidBody);
      a.x=t.translation_x;a.y=t.translation_y;a.z=t.translation_z;
      a.vx=b.linearVelocity[0];a.vy=b.linearVelocity[1];a.vz=b.linearVelocity[2];
      if(a.hp>0&&(a.y<kill.floor||a.x<kill.minX||a.x>kill.maxX||a.z<kill.minZ||a.z>kill.maxZ)){a.hp=0;a.deathTick=this.tick;a.deathVelocity=Array.from(b.linearVelocity);this.syncActorCollider(a);this.event('death',a);}
    }
    this.stepProjectiles(dt);if(!predicted)this.checkEncounters();
  }
  think(a,dt){this.mind.tick(a,dt);}
  attack(a){
    const w=WEAPONS[a.weapon],mana=focusCost(a,w.mana??0);if(a.stamina<w.stamina||a.mana<mana)return;
    if(a.kind==='player'&&a.weapon==='bow'){if(a.inventory.arrows<=0)return;a.inventory.arrows--;}
    a.attackVariant=selectMeleeAttack(a,[...this.actors.keys()].map(id=>this.actor(id)),(target,center)=>this.lineOfSight([a.x,a.y+.15,a.z],center,this.actors.get(a.id),this.actors.get(target.id)));
    a.stamina-=w.stamina;a.mana-=mana;a.cooldown=w.cooldown;a.attackAge=0;a.attackId++;a.hitIds=[];a.attackKind='weapon';a.projectileReleased=false;
    this.event('attack',a,{weapon:a.weapon,attackVariant:a.attackVariant});
  }
  advanceAttack(a,dt){
    a.attackAge+=dt;const w=WEAPONS[a.weapon];
    if(a.attackKind!=='nova'&&a.attackKind!=='ritual'){
      this.melee(a);
      if(w.release!==undefined&&!a.projectileReleased&&a.attackAge>=w.release){this.spawnProjectile(a,w);a.projectileReleased=true;this.event('release',a,{weapon:a.weapon});}
    }
    if(a.attackAge>(a.attackKind==='ritual'?(BOSS_MOVES[a.bossMove]?.recovery??1):a.attackKind==='nova'?1:w.cooldown))a.attackAge=-1;
  }
  setCrouch(a,crouch){
    if(a.kind!=='player'||a.hp<=0)return;
    const e=this.actors.get(a.id),y=a.y+(crouch?-.35:.35);
    if(!crouch&&this.physics.overlap(standing,[a.x,y+.025,a.z],q,this.overlaps,0,id=>id!==e)>0)return;
    this.ecd.removeComponentFromEntity(e,Collider);const c=new Collider();c.shape=CapsuleShape3D.from(.32,crouch?.35:1.05);c.friction=0;
    this.ecd.addComponentToEntity(e,c);const b=this.ecd.getComponent(e,RigidBody);
    this.physics.setPose(b,[a.x,y,a.z],rotation);a.y=y;a.crouch=crouch;
  }
  syncActorCollider(a,rebuild=false){
    const e=this.actors.get(a.id);let collider=this.ecd.getComponent(e,Collider);
    if(rebuild&&collider){this.ecd.removeComponentFromEntity(e,Collider);collider=null;}
    if(a.hp<=0){if(collider)this.ecd.removeComponentFromEntity(e,Collider);return;}
    if(!collider){const c=new Collider(),scale=a.boss?1.5:1;c.shape=CapsuleShape3D.from(.32*scale,(a.crouch?.35:1.05)*scale);c.friction=0;this.ecd.addComponentToEntity(e,c);}
  }
  sweepContact(radius,direction){
    const normal=Array.from(this.hit.normal),convex=this.ecd.getComponent(this.hit.entity,Collider)?.shape.is_convex!==false;
    // Native convex sweeps report the moving sphere's centre at contact;
    // the concave fallback reports a surface ray hit already on the geometry.
    return {position:Array.from(this.hit.position,(value,i)=>value-(convex?normal[i]*radius:0)),normal,direction:Array.from(direction)};
  }
  melee(a){
    const w=WEAPONS[a.weapon];if(w.style!=='melee'||a.attackKind==='nova'||a.attackKind==='ritual')return;
    const age=a.attackAge;if(age<w.active[0]||age>w.active[1])return;
    const current=weaponPose(a),previous=weaponPose(a,Math.max(w.active[0],age-DT));
    const segments=[[current.start,current.end]];
    // Sample the blade's swept travel, including its tip, between physics ticks.
    for(let j=0;j<=5;j++)segments.push([previous.start.map((v,i)=>v+(previous.end[i]-v)*j/5),current.start.map((v,i)=>v+(current.end[i]-v)*j/5)]);
    for(const [from,to] of segments){
      const d=to.map((v,i)=>v-from[i]),length=Math.hypot(...d);if(length<.0001)continue;
      this.ray.set([...from,...d.map(v=>v/length),length]);
      if(sphereSweep(this.physics,this.ray,.11,this.hit,e=>e!==this.actors.get(a.id))){
        const v=this.ecd.getComponent(this.hit.entity,Actor);
        // Visibility uses the same query result; retain the blade's surface contact first.
        const contact=this.sweepContact(.11,d.map(v=>v/length));
        if(v&&!a.hitIds.includes(v.id)&&this.lineOfSight([a.x,a.y+.15,a.z],[v.x,v.y,v.z],this.actors.get(a.id),this.actors.get(v.id))){a.hitIds.push(v.id);this.damage(a,v,a.kind==='player'?weaponDamage(a):enemyDamage(a),w.impulse,'physical',contact);}
      }
    }
  }
  damage(a,v,amount,impulse,type='physical',contact={}){
    if(!canDamage(a,v))return false;
    const armor=v.kind==='player'?armorFor(v):null;
    amount*=(1-(armor?.[type]??0))*(charmFor(v).received??1);impulse*=1-(armor?.poise??0);
    v.hp=Math.max(0,v.hp-amount);v.hurtTime=.35*(1-(armor?.poise??0));
    if(v.kind==='enemy'){v.targetId=a.id;v.memory=8;}
    if(v.kind==='enemy'&&v.boss&&a.kind==='player'&&Math.hypot(a.x-v.home[0],a.z-v.home[2])<BOSS_ARENA_RADIUS)v.returning=false;
    const dx=v.x-a.x,dz=v.z-a.z,d=Math.max(.01,Math.hypot(dx,dz)),b=this.ecd.getComponent(this.actors.get(v.id),RigidBody);
    this.physics.applyImpulse(b,new Vector3(dx/d*impulse,impulse*.16,dz/d*impulse));
    // Area damage has no sweep contact. Place its reaction on the capsule face
    // toward the source instead of hiding it inside the character's centre.
    const distance=Math.hypot(dx,dz),direction=contact.direction??(distance>.0001?[dx/distance,0,dz/distance]:[-Math.sin(a.yaw),0,-Math.cos(a.yaw)]);
    const normal=contact.normal??direction.map(value=>-value),radius=.32*(v.boss?1.5:1);
    const position=contact.position??[v.x+normal[0]*radius,v.y,v.z+normal[2]*radius];
    this.event('hit',v,{damage:Math.round(amount),source:a.id,weapon:contact.weapon??a.weapon,damageType:type,targetMaterial:v.archetype==='hound'?'flesh':'armor',position:Array.from(position),normal:Array.from(normal),direction:Array.from(direction),...(contact.effect?{effect:contact.effect}:{})});
    if(v.hp===0){
      if(v.boss)clearBossHazards(this,v.id);
      v.deathTick=this.tick;v.deathVelocity=Array.from(b.linearVelocity);this.syncActorCollider(v);
      this.event('death',v);v.deadTime=0;
      if(a.kind==='player'&&v.kind==='enemy'){
        const reward=v.boss?BOSSES[v.archetype].reward:(ENEMIES[v.archetype]?.reward??45);
        // Everyone alive in the encounter earns boss progress, including late joiners.
        for(const id of this.actors.keys()){
          const p=this.actor(id);if(p.kind!=='player'||p.hp<=0||(p.id!==a.id&&(!v.boss||Math.hypot(p.x-v.x,p.z-v.z)>30)))continue;
          const completed=hasAllSeals(p);
          p.embers+=reward;if(v.boss&&!p.seals.includes(BOSSES[v.archetype].seal))p.seals.push(BOSSES[v.archetype].seal);
          for(const [armor,def] of Object.entries(ARMOR))if(p.seals.includes(def.seal)&&!p.inventory.armors.includes(armor)){p.inventory.armors.push(armor);this.event('armor-found',p,{armor});}
          if(!completed&&hasAllSeals(p))this.event('circle-completed',p);
          if(!p.inventory.weapons.includes(v.weapon)){p.inventory.weapons.push(v.weapon);this.event('equipment-found',p,{weapon:v.weapon});}
          p.inventory.arrows+=v.weapon==='bow'?12:2;
          this.event(v.boss?'boss-defeated':'reward',p,{name:v.name,reward});
        }
      }
    }
    return true;
  }
  nova(a,radius,damage,effect){
    a.attackKind='nova';a.attackAge=0;
    a.attackId++;this.event('nova',a,{key:`${a.id}:nova:${a.attackId}`,radius,effect});
    const n=this.physics.overlap(SphereShape3D.from(radius),[a.x,a.y,a.z],q,this.overlaps,0);
    const hit=new Set();
    for(let i=0;i<n;i++){
      // Meep resolves its own packed body handles back to entities.
      const e=this.physics.entityOf(this.overlaps[i]);if(e<0)continue;
      const v=this.ecd.getComponent(e,Actor);
      if(v===undefined||hit.has(v.id))continue;hit.add(v.id);
      if(this.lineOfSight([a.x,a.y+.2,a.z],[v.x,v.y+.2,v.z],this.actors.get(a.id),e))this.damage(a,v,damage,420,effect==='shockwave'?'physical':'magic',{effect});
    }
  }
  spawnProjectile(a,w){
    const t=new Transform64(),p=new Projectile(),e=this.ecd.createEntity();
    p.owner=a.id;p.weapon=a.weapon;p.damage=a.kind==='player'?weaponDamage(a):enemyDamage(a);
    const origin=weaponPose(a).origin;
    const pitch=a.intent.pitch??0;
    p.velocity=[-Math.sin(a.yaw)*Math.cos(pitch)*w.speed,-Math.sin(pitch)*w.speed,-Math.cos(a.yaw)*Math.cos(pitch)*w.speed];p.radius=a.weapon==='staff'?.17:.05;
    if(a.kind==='player'){
      const pitch=a.intent.pitch??0,direction=[-Math.sin(a.yaw)*Math.cos(pitch),-Math.sin(pitch),-Math.cos(a.yaw)*Math.cos(pitch)];
      // The camera looks over the player's shoulder. Converge the weapon socket
      // on that sight line's first obstruction so close targets match the reticle.
      const eye=rangedSightOrigin(a);this.ray.set([...eye,...direction,80]);
      const distance=this.physics.raycast(this.ray,this.hit,id=>id!==this.actors.get(a.id))?this.hit.t:80;
      const delta=eye.map((v,i)=>v+direction[i]*Math.max(.5,distance)-origin[i]),length=Math.hypot(...delta);
      p.velocity=delta.map(v=>v/length*w.speed);
    }else{
      const target=this.actor(a.targetId);
      if(target?.hp>0)p.velocity=rangedVelocity(origin,[target.x,target.y+.3,target.z],w.speed,a.weapon==='bow'?9.81:0);
    }
    t.setTranslation(...origin);
    this.ecd.addComponentToEntity(e,t);this.ecd.addComponentToEntity(e,p);this.projectiles.add(e);
    return {p,t,e};
  }
  stepProjectiles(dt){
    for(const e of this.projectiles){
      const t=this.ecd.getComponent(e,Transform64),p=this.ecd.getComponent(e,Projectile);
      const travelTime=Math.min(dt,Math.max(0,p.life-p.age));p.age+=dt;
      const owner=this.actor(p.owner);if(owner?.boss&&owner.hp<=0){this.ecd.removeEntity(e);this.projectiles.delete(e);continue;}
      if(p.kind==='wave'||p.kind==='sigil'){stepHazard(this,e,p,t,dt);continue;}
      if(travelTime===0){this.ecd.removeEntity(e);this.projectiles.delete(e);continue;}
      if(p.weapon==='bow')p.velocity[1]-=9.81*travelTime;
      const v=p.velocity,speed=Math.hypot(...v);this.ray.set([t.translation_x,t.translation_y,t.translation_z,v[0]/speed,v[1]/speed,v[2]/speed,speed*travelTime]);
      const hit=sphereSweep(this.physics,this.ray,p.radius,this.hit,id=>id!==this.actors.get(p.owner));
      if(hit){
        const victim=this.ecd.getComponent(this.hit.entity,Actor),contact={...this.sweepContact(p.radius,v.map(value=>value/speed)),weapon:p.weapon,...(p.effect?{effect:p.effect}:{})};
        if(victim&&owner)this.damage(owner,victim,p.damage,WEAPONS[p.weapon].impulse,p.weapon==='staff'?'magic':'physical',contact);
        else if(!victim&&owner)this.event('impact',owner,{...contact,source:p.owner});
      }
      if(hit||p.age>=p.life){this.ecd.removeEntity(e);this.projectiles.delete(e);continue;}
      t.setTranslation(t.translation_x+v[0]*travelTime,t.translation_y+v[1]*travelTime,t.translation_z+v[2]*travelTime);
    }
  }
  tryMantle(a,e){
    if(a.stamina<14)return;const dx=-Math.sin(a.yaw),dz=-Math.cos(a.yaw);
    this.ray.set([a.x,a.y,a.z,dx,0,dz,1]);
    if(!this.physics.raycast(this.ray,this.hit,id=>id!==e))return;
    const x=a.x+dx*1.15,z=a.z+dz*1.15;
    this.ray.set([x,a.y+1.7,z,0,-1,0,1.8]);
    if(!this.physics.raycast(this.ray,this.hit,id=>id!==e)||this.hit.normal[1]<.7)return;
    const y=this.hit.position[1]+.9;
    if(this.physics.overlap(standing,[x,y+.08,z],q,this.overlaps,0,id=>id!==e)>0)return;
    a.mantle={phase:'hang',from:[a.x,y-1.65,a.z],to:[x,y,z],t:0};a.stamina-=14;this.event('ledge-grab',a);
  }
  lineOfSight(from,to,ignore=-1,target=-1,filter){
    const d=to.map((v,i)=>v-from[i]),length=Math.hypot(...d);if(length<.001)return true;
    this.ray.set([...from,d[0]/length,d[1]/length,d[2]/length,length]);
    return !this.physics.raycast(this.ray,this.hit,e=>e!==ignore&&e!==target&&(!filter||filter(e)));
  }
  rest(a){
    const {hearth,reason}=restStatus(a,[...this.actors.keys()].map(id=>this.actor(id)));if(reason)return false;
    a.hp=a.healthMax;a.stamina=a.staminaMax;a.mana=a.manaMax;a.flasks=flaskCapacity(a);a.checkpoint=hearthArrival(hearth);a.checkpointId=hearth.id;
    a.inventory.arrows=Math.max(30,a.inventory.arrows);a.sprintExhausted=false;
    if(!a.hearths.includes(hearth.id))a.hearths.push(hearth.id);
    this.event('rest',a,{hearth:hearth.id,name:hearth.name});return true;
  }
  interact(a){
    const relic=nearbyRelic(a);if(!relic)return this.rest(a);
    const [x,y,z]=relic.position;if(!this.lineOfSight([a.x,a.y+.3,a.z],[x,y+1.35,z],this.actors.get(a.id)))return false;
    a.relics=knownRelics([...(a.relics??[]),relic.id]);a.embers+=relic.embers;a.flasks=Math.min(flaskCapacity(a),a.flasks+(relic.flasks??0));
    this.event('relic-found',a,{relic:relic.id,name:relic.name,reward:relic.embers});return true;
  }
  levelUp(id,stat){
    const a=this.actor(id);if(!a||!Object.hasOwn(a.stats,stat)||a.embers<levelCost(a.level))return false;
    if(restStatus(a,[...this.actors.keys()].map(id=>this.actor(id))).reason)return false;
    a.embers-=levelCost(a.level);a.level++;a.stats[stat]++;
    a.healthMax=maxHealth(a.stats);a.staminaMax=maxStamina(a.stats);a.manaMax=maxMana(a.stats);this.rest(a);return true;
  }
  respawn(a){a.hp=a.healthMax;a.stamina=a.staminaMax;a.mana=a.manaMax;a.deadTime=0;a.flasks=flaskCapacity(a);a.crouch=false;a.attackAge=-1;a.hurtTime=0;a.mantle=null;Object.assign(a,optionalMotion,{sprintExhausted:false});a.embers=Math.floor(a.embers*.75);this.teleport(a,a.checkpoint);this.syncActorCollider(a,true);this.event('respawn',a);}
  teleport(a,p){const e=this.actors.get(a.id),b=this.ecd.getComponent(e,RigidBody);this.physics.setPose(b,p,rotation);b.linearVelocity.fill(0);[a.x,a.y,a.z]=p;}
  checkEncounters(){
    for(const id of this.actors.keys()){
      const a=this.actor(id);if(!a.boss||!a.active||a.hp<=0)continue;
      const alive=[...this.actors.keys()].some(pid=>{const p=this.actor(pid);return p.kind==='player'&&p.hp>0&&Math.hypot(p.x-a.home[0],p.z-a.home[2])<BOSS_ARENA_RADIUS;});
      if(!alive&&!a.returning){
        a.returning=true;
        a.phase='return';
        a.attackAge=-1;
        a.windup=0;
        a.memory=0;
        a.path=null;
        a.patrolGoal=null;
        a.targetId=null;
        a.attackKind='';
        clearBossHazards(this,a.id);
      }
      if(alive&&a.returning){a.returning=false;a.path=null;}
    }
  }
  exportCharacter(id){
    const a=this.actor(id);if(!a)return null;const {origin,weapon,stats,level,embers,flasks,pvp,seals,hp,stamina,mana,x,y,z,checkpoint,checkpointId,hearths,inventory}=a;
    const motion=Object.fromEntries(motionFields.map(key=>[key,a[key]]));
    for(const key of Object.keys(optionalMotion))motion[key]=a[key];
    Object.assign(motion,{crouch:a.crouch,grounded:a.grounded,sprintExhausted:a.sprintExhausted,attackKind:a.attackKind,attackVariant:a.attackVariant,hitIds:[...a.hitIds],projectileReleased:a.projectileReleased,mantle:structuredClone(a.mantle),deathVelocity:[...a.deathVelocity]});
    return {version:1,contentVersion:WORLD_VERSION,origin,weapon,stats:{...stats},level,embers,flasks,pvp,seals:[...seals],relics:[...a.relics],hp,stamina,mana,x,y,z,checkpoint:[...checkpoint],checkpointId,hearths:[...hearths],inventory:structuredClone(inventory),motion};
  }
  importCharacter(id,s){
    const a=this.actor(id);if(!a||s.version!==1)throw new Error('Unsupported character save version');
    const fields=['vigor','endurance','might','insight'];
    if(!fields.every(k=>Number.isFinite(s.stats?.[k])&&s.stats[k]>=1)||![s.x,s.y,s.z,s.hp,s.stamina,s.mana,s.level,s.embers].every(Number.isFinite))throw new Error('Malformed character state');
    if(!Object.hasOwn(WEAPONS,s.weapon)||!Array.isArray(s.seals)||!Array.isArray(s.checkpoint)||s.checkpoint.length!==3||!s.checkpoint.every(Number.isFinite))throw new Error('Malformed equipment or checkpoint');
    if(s.inventory&&!Array.isArray(s.inventory.weapons))throw new Error('Malformed inventory');
    if(s.motion){
      const m=s.motion;
      if(!motionFields.every(key=>Number.isFinite(m[key]))||!Array.isArray(m.hitIds)||!m.hitIds.every(id=>typeof id==='string')||!Array.isArray(m.deathVelocity)||m.deathVelocity.length!==3||!m.deathVelocity.every(Number.isFinite))throw new Error('Malformed character motion');
      if(!Object.keys(optionalMotion).every(key=>m[key]===undefined||Number.isFinite(m[key])))throw new Error('Malformed landing state');
      if(m.mantle&&(!['hang','climb'].includes(m.mantle.phase)||!Number.isFinite(m.mantle.t)||![m.mantle.from,m.mantle.to].every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))))throw new Error('Malformed mantle state');
    }
    const stats=Object.fromEntries(fields.map(key=>[key,s.stats[key]])),relics=knownRelics(s.relics);
    const inventory=migrateInventory(s.inventory,s.weapon,s.seals,relics);
    const character={kind:'player',stats,inventory,relics};
    // Progression is trusted, but finite inputs can still overflow resource
    // maxima or reinforced damage and poison physics/network serialization.
    if(![maxHealth(stats),maxStamina(stats),maxMana(stats),levelCost(s.level),...inventory.weapons.map(weapon=>weaponDamage(character,weapon))].every(Number.isFinite))throw new Error('Malformed character state');
    // Client progression is trusted at reconnect, per game policy. World state never comes from this payload.
    Object.assign(a,{origin:s.origin,weapon:s.weapon,stats,level:s.level,embers:s.embers,flasks:s.flasks,pvp:!!s.pvp,seals:[...s.seals],checkpoint:[...s.checkpoint]});
    a.checkpointId=HEARTHS.some(h=>h.id===s.checkpointId)?s.checkpointId:'hearth';
    a.hearths=[...new Set(['hearth',a.checkpointId,...(Array.isArray(s.hearths)?s.hearths.filter(id=>HEARTHS.some(h=>h.id===id)):[])])];
    a.inventory=inventory;
    a.relics=relics;a.flasks=clamp(Math.floor(Number(a.flasks)||0),0,flaskCapacity(a));
    a.healthMax=maxHealth(a.stats);a.staminaMax=maxStamina(a.stats);a.manaMax=maxMana(a.stats);
    a.hp=clamp(s.hp,0,a.healthMax);a.stamina=clamp(s.stamina,0,a.staminaMax);a.mana=clamp(s.mana,0,a.manaMax);this.teleport(a,[s.x,s.contentVersion===WORLD_VERSION?s.y:Math.max(s.y,heightAt(s.x,s.z)+1),s.z]);if(s.contentVersion!==WORLD_VERSION)a.checkpoint[1]=Math.max(a.checkpoint[1],heightAt(a.checkpoint[0],a.checkpoint[2])+1);this.syncActorCollider(a);
    Object.assign(a,optionalMotion);
    a.sprintExhausted=!!s.motion?.sprintExhausted;
    a.attackVariant=MELEE_ATTACKS[a.weapon]?.includes(s.motion?.attackVariant)?s.motion.attackVariant:'';
    if(s.motion){
      for(const key of motionFields)a[key]=s.motion[key];
      for(const [key,fallback] of Object.entries(optionalMotion))a[key]=s.motion[key]??fallback;
      Object.assign(a,{crouch:!!s.motion.crouch,grounded:!!s.motion.grounded,attackKind:s.motion.attackKind==='nova'?'nova':'weapon',hitIds:[...s.motion.hitIds],projectileReleased:!!s.motion.projectileReleased,mantle:structuredClone(s.motion.mantle??null),deathVelocity:[...s.motion.deathVelocity]});
      this.syncActorCollider(a,true);const b=this.ecd.getComponent(this.actors.get(id),RigidBody);b.linearVelocity.set([a.vx,a.vy,a.vz]);
    }
    if(s.contentVersion!==WORLD_VERSION){a.mantle=null;a.path=null;a.patrolGoal=null;}
  }
  snapshot(){return {version:1,contentVersion:WORLD_VERSION,tick:this.tick,time:this.time,actors:[...this.actors.keys()].map(id=>structuredClone(this.actor(id))),projectiles:[...this.projectiles].map(e=>{const p=this.ecd.getComponent(e,Projectile),t=this.ecd.getComponent(e,Transform64);return {...structuredClone(p),id:e,position:[t.translation_x,t.translation_y,t.translation_z]};}),events:structuredClone(this.events)};}
  restoreWorld(snapshot){
    const authored=new Map([...this.actors.keys()].map(id=>this.actor(id)).filter(a=>a.kind==='enemy').map(a=>[a.id,structuredClone(a)]));
    const ids=new Set(snapshot.actors.map(a=>a.id)),added=snapshot.contentVersion!==WORLD_VERSION?[...authored.values()].filter(a=>!ids.has(a.id)):[];
    this.replaceSnapshot({...snapshot,actors:[...snapshot.actors,...added]});
    // Content updates may raise terrain beneath a saved position. Preserve
    // progression while placing bodies and checkpoints back above that surface.
    for(const id of this.actors.keys()){
      const a=this.actor(id),definition=authored.get(id),home=definition?.home;
      a.inventory=migrateInventory(a.inventory,a.weapon,a.seals,knownRelics(a.relics));
      a.relics=knownRelics(a.relics);
      if(home){
        a.dungeon=definition.dungeon;
        const moved=home.some((v,i)=>v!==a.home[i]),outsideLeash=Math.hypot(a.x-a.home[0],a.z-a.home[2])>(a.boss?29:38);
        a.home=home;
        // Old motor/content versions could leave enemies permanently outside
        // their return tile. Restore only displaced living NPCs; encounter
        // health and dead timers still obey the ordinary persistent rules.
        if(a.hp>0&&(moved||outsideLeash)){this.teleport(a,home);a.path=null;a.patrolGoal=null;a.patrolWaitUntil=this.tick+120;a.intent={x:0,z:0,yaw:a.yaw,buttons:0};}
      }
      if(snapshot.contentVersion!==WORLD_VERSION){
        a.mantle=null;a.path=null;a.patrolGoal=null;
        if(!a.dungeon)this.teleport(a,[a.x,Math.max(a.y,heightAt(a.x,a.z)+(a.boss?1.4:1)),a.z]);
        if(!home)a.home[1]=heightAt(a.home[0],a.home[2])+(a.boss?1.4:1);
        a.checkpoint[1]=Math.max(a.checkpoint[1],heightAt(a.checkpoint[0],a.checkpoint[2])+1);
      }
    }
  }
  replaceSnapshot(snapshot,{preservePlayer}={}){
    const saved=preservePlayer?this.exportCharacter(preservePlayer):null;
    const ids=new Set(snapshot.actors.map(a=>a.id));
    const firstScope=snapshot.scope==='nearby'&&!this.scopedAuthority;
    if(firstScope){this.scopedAuthority=true;this.dormantActors=new Map([...this.authoredActors].map(([id,actor])=>[id,{actor:structuredClone(actor),tick:snapshot.tick}]));}
    if(snapshot.scope==='nearby'){
      // Cache only states received in this authority epoch. An earlier offline
      // branch must not reappear when its distant actors leave the new scope.
      if(!firstScope)for(const id of this.actors.keys()){const actor=this.actor(id);if(actor.kind==='enemy'&&!ids.has(id))this.dormantActors.set(id,{actor:structuredClone(actor),tick:this.tick});}
      for(const id of ids)this.dormantActors.delete(id);
    }
    for(const [id,e] of this.actors)if(!ids.has(id)){this.predictionSleeping.delete(this.ecd.getComponent(e,RigidBody));this.ecd.removeEntity(e);this.actors.delete(id);}
    for(const value of snapshot.actors){
      let a=this.actor(value.id);if(!a)a=this.spawnActor(value.id,value,[value.x,value.y,value.z]);
      const resized=a.crouch!==value.crouch||a.boss!==value.boss;
      const moved=a.x!==value.x||a.y!==value.y||a.z!==value.z;
      Object.assign(a,structuredClone(value));if(moved)this.teleport(a,[value.x,value.y,value.z]);
      if(snapshot.scope==='nearby'&&a.kind==='enemy'){a.path=null;a.pathTick=0;a.patrolGoal=null;delete a.patrolWaitUntil;delete a.patrolDeadline;a.memory=0;}
      this.syncActorCollider(a,resized);
      const body=this.ecd.getComponent(this.actors.get(a.id),RigidBody),velocity=body.linearVelocity;
      // A velocity-only correction must wake its body, but an unchanged
      // snapshot should preserve Meep's sleeping state.
      if(velocity[0]!==value.vx||velocity[1]!==value.vy||velocity[2]!==value.vz)this.physics.setLinearVelocity(body,[value.vx,value.vy,value.vz]);
    }
    for(const e of this.projectiles)this.ecd.removeEntity(e);this.projectiles.clear();
    for(const value of snapshot.projectiles??[]){const e=this.ecd.createEntity(),t=new Transform64(),p=Object.assign(new Projectile(),structuredClone(value));t.setTranslation(...value.position);this.ecd.addComponentToEntity(e,t);this.ecd.addComponentToEntity(e,p);this.projectiles.add(e);}
    this.events=structuredClone(snapshot.events??[]);this.tick=snapshot.tick;this.time=snapshot.time;if(saved&&this.actor(preservePlayer))this.importCharacter(preservePlayer,saved);
  }
  resumeLocalWorld(playerId){
    if(!this.scopedAuthority)return;
    const snapshot=this.snapshot();snapshot.actors=snapshot.actors.filter(a=>a.kind==='enemy'||a.id===playerId);
    for(const {actor,tick} of this.dormantActors.values()){
      const a=structuredClone(actor),elapsed=Math.max(0,(this.tick-tick)*DT);a.cooldown=Math.max(0,a.cooldown-elapsed);a.memory=0;a.targetId=null;a.path=null;
      if(a.hp<=0)a.deadTime+=elapsed;snapshot.actors.push(a);
    }
    this.scopedAuthority=false;this.dormantActors.clear();this.replaceSnapshot(snapshot);
  }
  async stop(){await new Promise((resolve,reject)=>this.em.shutdown(resolve,reject));}
}
