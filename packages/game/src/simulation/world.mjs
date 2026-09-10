import { EntityComponentDataset } from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import { EntityManager } from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import { Transform64 } from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import { PhysicsSystem } from '@woosh/meep-engine/src/engine/physics/ecs/PhysicsSystem.js';
import { ColliderObserverSystem } from '@woosh/meep-engine/src/engine/physics/ecs/ColliderObserverSystem.js';
import { RigidBody } from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import { BodyKind } from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import { Collider } from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import { CapsuleShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/CapsuleShape3D.js';
import { HeightMapShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/HeightMapShape3D.js';
import { SphereShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/SphereShape3D.js';
import { Sampler2D } from '@woosh/meep-engine/src/engine/graphics/texture/sampler/Sampler2D.js';
import { Ray3 } from '@woosh/meep-engine/src/core/geom/3d/ray/Ray3.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import { PhysicsSurfacePoint } from '@woosh/meep-engine/src/engine/physics/queries/PhysicsSurfacePoint.js';
import { Actor, Projectile } from './components.mjs';
import { sphereSweep } from './sphere-sweep.mjs';
import { weaponPose } from './weapon-pose.mjs';
import { ConvexHullShape3D } from '@woosh/meep-engine/src/core/geom/3d/shape/ConvexHullShape3D.js';
import collisionAssets from '../content/colliders.json' with {type:'json'};
import { SpatialAtlas } from '../world/spatial-atlas.mjs';
import { heightAt, landmarkPosition, REGIONS, regionAt, SPAWN } from '../world/regions.mjs';
import { buildLayout } from '../world/layout.mjs';
import { WEAPONS, BOSSES, ENEMIES, ORIGINS, canDamage, maxHealth, maxStamina, maxMana, levelCost } from '../content/catalog.mjs';

export const DT=1/60;
export const BUTTON={SPRINT:1,CROUCH:2,JUMP:4,ATTACK:8,NOVA:16,HEAL:32,INTERACT:64};
const rotation={x:0,y:0,z:0,w:1};
const q=[0,0,0,1];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class GameWorld {
  constructor(){
    this.em=new EntityManager();this.ecd=new EntityComponentDataset();this.physics=new PhysicsSystem();
    this.em.addSystem(this.physics);this.em.addSystem(new ColliderObserverSystem(this.physics));this.em.attachDataset(this.ecd);
    for(const c of [Transform64,RigidBody,Collider,Actor,Projectile])this.ecd.registerComponentType(c);
    this.actors=new Map();this.projectiles=new Set();this.events=[];this.tick=0;this.time=15.2;this.layout=buildLayout();
    this.ray=new Ray3();this.hit=new PhysicsSurfacePoint();this.overlaps=new Uint32Array(512);
    this.navigation=new Map();
  }
  async start({populate=true}={}){
    await new Promise((resolve,reject)=>this.em.startup(resolve,reject));
    // Meep heightfield with a safe below-surface base. Same height function and metre coordinates as Blender.
    const samples=new Float32Array(241*321);
    for(let z=0;z<321;z++)for(let x=0;x<241;x++)samples[z*241+x]=heightAt(x*2-240,z*2-480)+15;
    const sampler=new Sampler2D(samples,1,241,321);
    this.body([0,-15,-160],HeightMapShape3D.from(sampler,480,90,640),BodyKind.Static);
    this.layout.solids=[];
    for(const prop of this.layout.props)for(const part of collisionAssets[prop.model]??[]){
      const vertices=new Float32Array(part.vertices.length),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<vertices.length;i+=3){
        const x=part.vertices[i]*prop.scale[0],y=part.vertices[i+1]*prop.scale[1],z=part.vertices[i+2]*prop.scale[2];
        vertices[i]=Math.cos(prop.yaw)*x+Math.sin(prop.yaw)*z;vertices[i+1]=y;vertices[i+2]=-Math.sin(prop.yaw)*x+Math.cos(prop.yaw)*z;
        for(let j=0;j<3;j++){min[j]=Math.min(min[j],vertices[i+j]+prop.position[j]);max[j]=Math.max(max[j],vertices[i+j]+prop.position[j]);}
      }
      this.body(prop.position,ConvexHullShape3D.from(vertices,new Uint32Array(part.indices)),BodyKind.Static);
      this.layout.solids.push({position:min.map((v,j)=>(v+max[j])/2),size:min.map((v,j)=>max[j]-v)});
    }
    if(populate)this.populate();
    this.physics.optimizeBroadphase?.();return this;
  }
  body(position,shape,kind=BodyKind.Dynamic){
    const e=this.ecd.createEntity(),t=new Transform64(),b=new RigidBody(),c=new Collider();
    t.setTranslation(...position);b.kind=kind;b.mass=75;b.linearDamping=.45;c.shape=shape;c.friction=.05;
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
    this.spawnActor('cave-keeper',{kind:'enemy',archetype:'mage',name:'The Lost Bellkeeper',weapon:'staff',hp:100,healthMax:100},[38,heightAt(38,-26)+1,-26]);
  }
  spawnActor(id,values={},position){
    const a=Object.assign(new Actor(),values,{id});
    const p=position??[SPAWN[0],heightAt(SPAWN[0],SPAWN[2])+1,SPAWN[2]];
    a.x=p[0];a.y=p[1];a.z=p[2];a.home=[...p];
    const scale=a.boss?1.5:1;
    const e=this.body(p,CapsuleShape3D.from(.32*scale,1.05*scale));
    this.ecd.addComponentToEntity(e,a);this.actors.set(id,e);return a;
  }
  addPlayer(id,origin='pilgrim',saved){
    const o=ORIGINS.find(x=>x.id===origin)??ORIGINS[0];
    const a=this.spawnActor(id,{kind:'player',name:o.name,origin:o.id,stats:{...o.stats},weapon:o.weapon});
    a.inventory={weapons:[...new Set(['sword',o.weapon])],arrows:30,armor:'road-worn mail'};
    a.healthMax=maxHealth(a.stats);a.hp=a.healthMax;a.staminaMax=maxStamina(a.stats);a.stamina=a.staminaMax;a.manaMax=maxMana(a.stats);a.mana=a.manaMax;
    if(saved)this.importCharacter(id,saved);
    return a;
  }
  actor(id){const e=this.actors.get(id);return e===undefined?undefined:this.ecd.getComponent(e,Actor);}
  input(id,intent){const a=this.actor(id);if(a)a.intent={x:clamp(Number(intent.x)||0,-1,1),z:clamp(Number(intent.z)||0,-1,1),yaw:Number(intent.yaw)||0,buttons:(intent.buttons|0)&127};}
  equip(id,weapon){const a=this.actor(id);if(a&&WEAPONS[weapon]&&a.attackAge<0&&(a.kind!=='player'||a.inventory.weapons.includes(weapon)))a.weapon=weapon;}
  event(type,actor,data={}){this.events.push({key:`${this.tick}:${actor.id}:${type}:${this.events.length}`,type,id:actor.id,position:[actor.x,actor.y,actor.z],tick:this.tick,...data});}
  step(dt=DT){
    this.tick++;this.time=(this.time+dt/90)%24;this.events=[];
    for(const [id,e] of this.actors){
      const a=this.actor(id),t=this.ecd.getComponent(e,Transform64),b=this.ecd.getComponent(e,RigidBody);
      if(a.hp<=0){
        a.deadTime+=dt;b.linearVelocity.fill(0);
        if(a.kind==='player'&&a.deadTime>4)this.respawn(a);
        if(a.kind==='enemy'&&a.deadTime>(a.boss?1200:180)&&![...this.actors.keys()].some(pid=>{const p=this.actor(pid);return p.kind==='player'&&p.hp>0&&Math.hypot(p.x-a.home[0],p.z-a.home[2])<30;})){
          a.hp=a.healthMax;a.deadTime=0;a.active=false;a.attackAge=-1;this.teleport(a,a.home);
        }
        continue;
      }
      a.hurtTime=Math.max(0,a.hurtTime-dt);a.cooldown=Math.max(0,a.cooldown-dt);
      a.stamina=Math.min(a.staminaMax,a.stamina+dt*22);a.mana=Math.min(a.manaMax,a.mana+dt*3);
      if(a.kind==='enemy')this.think(a,dt);
      const input=a.intent,buttons=input.buttons,pressed=buttons&~a.lastButtons;a.lastButtons=buttons;
      if(!!(buttons&BUTTON.CROUCH)!==a.crouch)this.setCrouch(a,!!(buttons&BUTTON.CROUCH));a.yaw=input.yaw;
      this.ray.set([a.x,a.y-.35,a.z,0,-1,0,.8]);
      a.grounded=this.physics.raycast(this.ray,this.hit,(other)=>other!==e)&&this.hit.normal[1]>.45;
      const len=Math.hypot(input.x,input.z),sprinting=(buttons&BUTTON.SPRINT)&&a.stamina>5&&len>0&&!a.crouch;
      const speed=a.kind==='enemy'?(a.boss?2.3:ENEMIES[a.archetype]?.speed??2.2):a.crouch?1.65:sprinting?6.7:3.5;
      if(sprinting)a.stamina=Math.max(0,a.stamina-dt*31);
      const blend=Math.min(1,dt*(a.grounded?15:4)),control=a.hurtTime>0?.18:1;
      if(len>0||(pressed&BUTTON.JUMP))this.physics.wake(b);
      b.linearVelocity[0]+=(input.x/Math.max(1,len)*speed-b.linearVelocity[0])*blend*control;
      b.linearVelocity[2]+=(input.z/Math.max(1,len)*speed-b.linearVelocity[2])*blend*control;
      if((pressed&BUTTON.JUMP)&&a.grounded&&a.stamina>=12){b.linearVelocity[1]=6.4;a.stamina-=12;this.event('jump',a);}
      if((buttons&BUTTON.JUMP)&&!a.grounded&&!a.mantle)this.tryMantle(a,e);
      if(a.mantle){
        const mantle=a.mantle;mantle.t+=dt;
        if(mantle.phase==='hang'){
          if(buttons&BUTTON.CROUCH){a.mantle=null;b.linearVelocity[1]=-1;}
          else{
            this.physics.setPose(b,{x:mantle.from[0],y:mantle.from[1],z:mantle.from[2]},rotation);b.linearVelocity.fill(0);
            if((pressed&BUTTON.JUMP)||((buttons&BUTTON.JUMP)&&mantle.t>.22)){mantle.phase='climb';mantle.t=0;this.event('mantle',a);}
          }
        }else{
          const k=Math.min(1,mantle.t/.4),s=k*k*(3-2*k),p=mantle.from.map((v,i)=>v+(mantle.to[i]-v)*s);
          this.physics.setPose(b,{x:p[0],y:p[1],z:p[2]},rotation);b.linearVelocity.fill(0);if(k===1)a.mantle=null;
        }
      }
      if((buttons&BUTTON.ATTACK)&&a.cooldown===0)this.attack(a);
      if((pressed&BUTTON.NOVA)&&a.kind==='player'&&a.cooldown===0&&a.mana>=28){a.mana-=28;a.cooldown=1.2;this.nova(a,6.5,36,'frost');}
      if((pressed&BUTTON.HEAL)&&a.flasks>0&&a.hp<a.healthMax){a.flasks--;a.hp=Math.min(a.healthMax,a.hp+70);this.event('heal',a);}
      if((pressed&BUTTON.INTERACT)&&a.kind==='player')this.rest(a);
      if(a.attackAge>=0){a.attackAge+=dt;this.melee(a);if(a.attackAge>(a.boss?1.2:WEAPONS[a.weapon].cooldown))a.attackAge=-1;}
      t.setRotation(0,Math.sin(a.yaw/2),0,Math.cos(a.yaw/2));
    }
    this.physics.fixedUpdate(dt);
    for(const [id,e] of this.actors){
      const a=this.actor(id),t=this.ecd.getComponent(e,Transform64),b=this.ecd.getComponent(e,RigidBody);
      a.x=t.translation_x;a.y=t.translation_y;a.z=t.translation_z;
      a.vx=b.linearVelocity[0];a.vy=b.linearVelocity[1];a.vz=b.linearVelocity[2];
      if(a.y < -25 || Math.abs(a.x)>235 || a.z < -465 || a.z>145){a.hp=0;this.event('death',a);}
    }
    this.stepProjectiles(dt);this.checkEncounters();
  }
  think(a,dt){
    let target=null,distance=Infinity;
    for(const id of this.actors.keys()){
      const p=this.actor(id);if(p.kind!=='player'||p.hp<=0)continue;
      const d=Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z);
      const detect=a.boss?23:p.crouch?7:19;
      if(d<detect&&d<distance&&this.lineOfSight([a.x,a.y+.4,a.z],[p.x,p.y+.3,p.z],this.actors.get(a.id),this.actors.get(p.id))){target=p;distance=d;}
    }
    if(target){a.targetId=target.id;a.memory=6;}else if(a.memory>0){a.memory-=dt;const p=this.actor(a.targetId);if(p?.hp>0&&Math.hypot(p.x-a.x,p.z-a.z)<35){target=p;distance=Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z);}}
    if(!target){a.intent={x:0,z:0,yaw:a.yaw,buttons:0};a.phase='idle';return;}
    a.active=true;
    const dx=target.x-a.x,dz=target.z-a.z,d=Math.max(.01,Math.hypot(dx,dz));
    const ranged=WEAPONS[a.weapon].style!=='melee',range=ranged?12:a.boss?3.7:2;
    a.phase=distance>range?'pursue':'windup';
    if(a.windup>0){a.windup-=dt;a.intent={x:0,z:0,yaw:Math.atan2(-dx,-dz),buttons:0};if(a.windup<=0){if(a.attackKind==='nova')this.nova(a,8, BOSSES[a.archetype].damage,'shockwave');else this.attack(a);a.cooldown=a.boss?2.6:1.7;}return;}
    a.intent={x:distance>range?dx/d:0,z:distance>range?dz/d:0,yaw:Math.atan2(-dx,-dz),buttons:0};
    if(distance>range){
      this.ray.set([a.x,a.y,a.z,dx/d,0,dz/d,Math.min(d,2)]);
      if(this.physics.raycast(this.ray,this.hit,e=>e!==this.actors.get(a.id)&&e!==this.actors.get(target.id))){
        const key=`${Math.floor(a.home[0]/40)},${Math.floor(a.home[2]/40)}`;
        let atlas=this.navigation.get(key);if(!atlas){const [x,z]=key.split(',').map(v=>Number(v)*40);atlas=new SpatialAtlas(this,{bounds:[x-32,z-32,x+72,z+72],spacing:2}).build();this.navigation.set(key,atlas);}
        if(!a.path||this.tick-(a.pathTick??0)>45){a.path=atlas.path([a.x,a.y-.845,a.z],[target.x,target.y-.845,target.z]).points;a.pathTick=this.tick;}
        while(a.path?.length>1&&Math.hypot(a.path[0][0]-a.x,a.path[0][2]-a.z)<1)a.path.shift();
        const next=a.path?.[0];if(next){const px=next[0]-a.x,pz=next[2]-a.z,pl=Math.max(.1,Math.hypot(px,pz));a.intent.x=px/pl;a.intent.z=pz/pl;}
      }
    }
    if(distance<=range&&a.cooldown===0){a.windup=a.boss?1.15:.8;a.attackKind=a.boss&&a.attackId%3===2?'nova':'weapon';this.event('telegraph',a,{effect:a.attackKind,radius:a.attackKind==='nova'?8:range});}
  }
  attack(a){
    const w=WEAPONS[a.weapon];if(a.stamina<w.stamina||a.mana<(w.mana??0))return;
    if(a.kind==='player'&&a.weapon==='bow'){if(a.inventory.arrows<=0)return;a.inventory.arrows--;}
    a.stamina-=w.stamina;a.mana-=w.mana??0;a.cooldown=w.cooldown;a.attackAge=0;a.attackId++;a.hitIds=[];
    this.event('attack',a,{weapon:a.weapon});
    if(w.style!=='melee')this.spawnProjectile(a,w);
  }
  setCrouch(a,crouch){
    if(a.kind!=='player')return;
    const e=this.actors.get(a.id),y=a.y+(crouch?-.35:.35);
    if(!crouch&&this.physics.overlap(CapsuleShape3D.from(.32,1.05),[a.x,y+.025,a.z],q,this.overlaps,0,id=>id!==e)>0)return;
    this.ecd.removeComponentFromEntity(e,Collider);const c=new Collider();c.shape=CapsuleShape3D.from(.32,crouch?.35:1.05);c.friction=.05;
    this.ecd.addComponentToEntity(e,c);const b=this.ecd.getComponent(e,RigidBody);
    this.physics.setPose(b,{x:a.x,y,z:a.z},rotation);a.y=y;a.crouch=crouch;
  }
  melee(a){
    const w=WEAPONS[a.weapon];if(w.style!=='melee')return;
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
        if(v&&!a.hitIds.includes(v.id)&&this.lineOfSight([a.x,a.y+.15,a.z],[v.x,v.y,v.z],this.actors.get(a.id),this.actors.get(v.id))){a.hitIds.push(v.id);this.damage(a,v,a.boss?BOSSES[a.archetype].damage:a.kind==='enemy'?(ENEMIES[a.archetype]?.damage??w.damage):w.damage+a.stats.might*.55,w.impulse);}
      }
    }
  }
  damage(a,v,amount,impulse){
    if(!canDamage(a,v))return false;
    v.hp=Math.max(0,v.hp-amount);v.hurtTime=.35;
    const dx=v.x-a.x,dz=v.z-a.z,d=Math.max(.01,Math.hypot(dx,dz)),b=this.ecd.getComponent(this.actors.get(v.id),RigidBody);
    this.physics.applyImpulse(b,new Vector3(dx/d*impulse,impulse*.16,dz/d*impulse));
    this.event('hit',v,{damage:Math.round(amount),source:a.id});
    if(v.hp===0){
      this.event('death',v);v.deadTime=0;
      if(a.kind==='player'){
        const reward=v.boss?BOSSES[v.archetype].reward:(ENEMIES[v.archetype]?.reward??45);
        // Everyone alive in the encounter earns boss progress, including late joiners.
        for(const id of this.actors.keys()){
          const p=this.actor(id);if(p.kind!=='player'||p.hp<=0||(p.id!==a.id&&(!v.boss||Math.hypot(p.x-v.x,p.z-v.z)>30)))continue;
          p.embers+=reward;if(v.boss&&!p.seals.includes(BOSSES[v.archetype].seal))p.seals.push(BOSSES[v.archetype].seal);
          if(!p.inventory.weapons.includes(v.weapon)){p.inventory.weapons.push(v.weapon);this.event('equipment-found',p,{weapon:v.weapon});}
          p.inventory.arrows+=v.weapon==='bow'?12:2;
          this.event(v.boss?'boss-defeated':'reward',p,{name:v.name,reward});
        }
      }
    }
    return true;
  }
  nova(a,radius,damage,effect){
    a.attackId++;this.event('nova',a,{key:`${a.id}:nova:${a.attackId}`,radius,effect});
    const n=this.physics.overlap(SphereShape3D.from(radius),[a.x,a.y,a.z],q,this.overlaps,0);
    const hit=new Set();
    for(let i=0;i<n;i++){
      const body=this.overlaps[i];
      for(const [id,e] of this.actors){
        const b=this.ecd.getComponent(e,RigidBody),v=this.actor(id);
        if(b._bodyId!==body||hit.has(id))continue;hit.add(id);
        if(this.lineOfSight([a.x,a.y+.2,a.z],[v.x,v.y+.2,v.z],this.actors.get(a.id),e))this.damage(a,v,damage,420);
      }
    }
  }
  spawnProjectile(a,w){
    const t=new Transform64(),p=new Projectile(),e=this.ecd.createEntity();
    p.owner=a.id;p.weapon=a.weapon;p.damage=a.kind==='player'?w.damage+a.stats.insight*.6:a.boss?BOSSES[a.archetype].damage:ENEMIES[a.archetype]?.damage??18;
    p.velocity=[-Math.sin(a.yaw)*w.speed,1,-Math.cos(a.yaw)*w.speed];p.radius=a.weapon==='staff'?.17:.05;
    t.setTranslation(a.x-Math.sin(a.yaw)*.8,a.y+.3,a.z-Math.cos(a.yaw)*.8);
    this.ecd.addComponentToEntity(e,t);this.ecd.addComponentToEntity(e,p);this.projectiles.add(e);
  }
  stepProjectiles(dt){
    for(const e of this.projectiles){
      const t=this.ecd.getComponent(e,Transform64),p=this.ecd.getComponent(e,Projectile);p.age+=dt;
      if(p.weapon==='bow')p.velocity[1]-=9.81*dt;
      const v=p.velocity,speed=Math.hypot(...v);this.ray.set([t.translation_x,t.translation_y,t.translation_z,v[0]/speed,v[1]/speed,v[2]/speed,speed*dt]);
      const hit=sphereSweep(this.physics,this.ray,p.radius,this.hit,id=>id!==this.actors.get(p.owner));
      if(hit){const victim=this.ecd.getComponent(this.hit.entity,Actor),owner=this.actor(p.owner);if(victim&&owner)this.damage(owner,victim,p.damage,WEAPONS[p.weapon].impulse);}
      if(hit||p.age>p.life){this.ecd.removeEntity(e);this.projectiles.delete(e);continue;}
      t.setTranslation(t.translation_x+v[0]*dt,t.translation_y+v[1]*dt,t.translation_z+v[2]*dt);
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
    if(this.physics.overlap(CapsuleShape3D.from(.32,1.05),[x,y+.08,z],q,this.overlaps,0,id=>id!==e)>0)return;
    a.mantle={phase:'hang',from:[a.x,y-1.65,a.z],to:[x,y,z],t:0};a.stamina-=14;this.event('ledge-grab',a);
  }
  lineOfSight(from,to,ignore=-1,target=-1){
    const d=to.map((v,i)=>v-from[i]),length=Math.hypot(...d);if(length<.001)return true;
    this.ray.set([...from,d[0]/length,d[1]/length,d[2]/length,length]);
    return !this.physics.raycast(this.ray,this.hit,e=>e!==ignore&&e!==target);
  }
  rest(a){
    const p=landmarkPosition('hearth');if(Math.hypot(a.x-p[0],a.z-p[2])>4)return false;
    if([...this.actors.keys()].some(id=>{const e=this.actor(id);return e.kind==='enemy'&&e.hp>0&&Math.hypot(e.x-a.x,e.z-a.z)<12;}))return false;
    a.hp=a.healthMax;a.stamina=a.staminaMax;a.mana=a.manaMax;a.flasks=3;a.checkpoint=[p[0],p[1]+1,p[2]+3];this.event('rest',a);return true;
  }
  levelUp(id,stat){
    const a=this.actor(id);if(!a||!Object.hasOwn(a.stats,stat)||a.embers<levelCost(a.level))return false;
    if(Math.hypot(a.x,a.z-20)>4||a.hp<=0)return false;
    a.embers-=levelCost(a.level);a.level++;a.stats[stat]++;
    a.healthMax=maxHealth(a.stats);a.staminaMax=maxStamina(a.stats);a.manaMax=maxMana(a.stats);this.rest(a);return true;
  }
  respawn(a){a.hp=a.healthMax;a.deadTime=0;a.flasks=3;a.embers=Math.floor(a.embers*.75);this.teleport(a,a.checkpoint);this.event('respawn',a);}
  teleport(a,p){const e=this.actors.get(a.id),b=this.ecd.getComponent(e,RigidBody);this.physics.setPose(b,{x:p[0],y:p[1],z:p[2]},rotation);b.linearVelocity.fill(0);[a.x,a.y,a.z]=p;}
  checkEncounters(){
    for(const id of this.actors.keys()){
      const a=this.actor(id);if(!a.boss||!a.active||a.hp<=0)continue;
      const alive=[...this.actors.keys()].some(pid=>{const p=this.actor(pid);return p.kind==='player'&&p.hp>0&&Math.hypot(p.x-a.home[0],p.z-a.home[2])<26;});
      if(!alive){a.hp=a.healthMax;a.active=false;a.attackAge=-1;a.windup=0;a.cooldown=1;this.teleport(a,a.home);}
    }
  }
  exportCharacter(id){const a=this.actor(id);if(!a)return null;const {origin,weapon,stats,level,embers,flasks,pvp,seals,hp,stamina,mana,x,y,z,checkpoint,inventory}=a;return {version:1,origin,weapon,stats:{...stats},level,embers,flasks,pvp,seals:[...seals],hp,stamina,mana,x,y,z,checkpoint:[...checkpoint],inventory:structuredClone(inventory)};}
  importCharacter(id,s){
    const a=this.actor(id);if(!a||s.version!==1)throw new Error('Unsupported character save version');
    const fields=['vigor','endurance','might','insight'];
    if(!fields.every(k=>Number.isFinite(s.stats?.[k])&&s.stats[k]>=1)||![s.x,s.y,s.z,s.hp,s.stamina,s.mana,s.level,s.embers].every(Number.isFinite))throw new Error('Malformed character state');
    if(!WEAPONS[s.weapon]||!Array.isArray(s.seals)||!Array.isArray(s.checkpoint)||s.checkpoint.length!==3||!s.checkpoint.every(Number.isFinite))throw new Error('Malformed equipment or checkpoint');
    if(s.inventory&&!Array.isArray(s.inventory.weapons))throw new Error('Malformed inventory');
    // Client progression is trusted at reconnect, per game policy. World state never comes from this payload.
    Object.assign(a,{origin:s.origin,weapon:s.weapon,stats:{...s.stats},level:s.level,embers:s.embers,flasks:s.flasks,pvp:!!s.pvp,seals:[...s.seals],checkpoint:[...s.checkpoint]});
    a.inventory=s.inventory?{weapons:[...new Set(s.inventory.weapons.filter(w=>WEAPONS[w]).concat(s.weapon))],arrows:clamp(Math.floor(Number(s.inventory.arrows)||0),0,9999),armor:String(s.inventory.armor??'road-worn mail')}:{weapons:[s.weapon,'sword'],arrows:30,armor:'road-worn mail'};
    a.flasks=clamp(Math.floor(Number(a.flasks)||0),0,3);
    a.healthMax=maxHealth(a.stats);a.staminaMax=maxStamina(a.stats);a.manaMax=maxMana(a.stats);
    a.hp=clamp(s.hp,0,a.healthMax);a.stamina=clamp(s.stamina,0,a.staminaMax);a.mana=clamp(s.mana,0,a.manaMax);this.teleport(a,[s.x,s.y,s.z]);
  }
  snapshot(){return {version:1,tick:this.tick,time:this.time,actors:[...this.actors.keys()].map(id=>structuredClone(this.actor(id))),projectiles:[...this.projectiles].map(e=>{const p=this.ecd.getComponent(e,Projectile),t=this.ecd.getComponent(e,Transform64);return {...structuredClone(p),id:e,position:[t.translation_x,t.translation_y,t.translation_z]};}),events:structuredClone(this.events)};}
  replaceSnapshot(snapshot,{preservePlayer}={}){
    const saved=preservePlayer?this.exportCharacter(preservePlayer):null;
    const ids=new Set(snapshot.actors.map(a=>a.id));
    for(const [id,e] of this.actors)if(!ids.has(id)){this.ecd.removeEntity(e);this.actors.delete(id);}
    for(const value of snapshot.actors){
      let a=this.actor(value.id);if(!a)a=this.spawnActor(value.id,value,[value.x,value.y,value.z]);
      if(a.crouch!==value.crouch)this.setCrouch(a,value.crouch);
      Object.assign(a,structuredClone(value));this.teleport(a,[value.x,value.y,value.z]);
      const velocity=this.ecd.getComponent(this.actors.get(a.id),RigidBody).linearVelocity;velocity[0]=value.vx;velocity[1]=value.vy;velocity[2]=value.vz;
    }
    for(const e of this.projectiles)this.ecd.removeEntity(e);this.projectiles.clear();
    for(const value of snapshot.projectiles??[]){const e=this.ecd.createEntity(),t=new Transform64(),p=Object.assign(new Projectile(),structuredClone(value));t.setTranslation(...value.position);this.ecd.addComponentToEntity(e,t);this.ecd.addComponentToEntity(e,p);this.projectiles.add(e);}
    this.events=structuredClone(snapshot.events??[]);this.tick=snapshot.tick;this.time=snapshot.time;if(saved&&this.actor(preservePlayer))this.importCharacter(preservePlayer,saved);
  }
  async stop(){await new Promise((resolve,reject)=>this.em.shutdown(resolve,reject));}
}
