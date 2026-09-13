import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {SphereShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/SphereShape3D.js';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';
import {Actor,Projectile} from './components.mjs';
import {actorFeet} from './animation.mjs';
import {BOSSES,WEAPONS} from '../content/catalog.mjs';
import {bossEnraged,waveRadius,WAVE_INNER_FRACTION} from '../content/boss-moves.mjs';
import {heightAt} from '../world/regions.mjs';

export function spawnHazard(world,owner,kind,position,options={}){
  const p=Object.assign(new Projectile(),{owner:owner.id,kind,weapon:'staff',velocity:[0,0,0],damage:BOSSES[owner.archetype]?.damage??20,
    key:`${owner.id}:hazard:${++owner.hazardSequence}`,radius:kind==='wave'?0:2.3,maxRadius:11,speed:7,delay:0,life:3,effect:'shockwave'},options),t=new Transform64(),e=world.ecd.createEntity();
  t.setTranslation(...position);world.ecd.addComponentToEntity(e,t);world.ecd.addComponentToEntity(e,p);world.projectiles.add(e);return p;
}
const ground=(x,z)=>[x,heightAt(x,z)+.12,z];
// One reused query sphere: hazards test their band every tick and never nest.
const hazardVolume=SphereShape3D.from(1),upright=[0,0,0,1];
export function castBossMove(world,a,move){
  const strong=bossEnraged(a),damage=BOSSES[a.archetype].damage;
  const players=[...world.actors.keys()].map(id=>world.actor(id)).filter(p=>p.kind==='player'&&p.hp>0&&Math.hypot(p.x-a.home[0],p.z-a.home[2])<29).sort((p,q)=>p.id.localeCompare(q.id)).slice(0,6);
  const wave=(delay=0,effect='shockwave')=>spawnHazard(world,a,'wave',ground(a.x,a.z),{delay,life:delay+2,maxRadius:12,speed:8,effect,damage:damage*.8});
  const sigil=(x,z,delay=1.4,effect='frost',radius=2.3)=>spawnHazard(world,a,'sigil',ground(x,z),{delay,life:delay+.45,radius,effect,damage:damage*.85});
  a.bossMove=move;a.windup=0;a.attackAge=0;a.attackKind='ritual';a.attackId++;a.hitIds=[];
  if(move==='bell'){wave();if(strong)wave(.8);}
  if(move==='roots')for(const p of players){sigil(p.x,p.z,1.4,'roots');if(strong){sigil(p.x+4,p.z,1.7,'roots',1.8);sigil(p.x-4,p.z,1.7,'roots',1.8);}}
  if(move==='cinders'){
    const target=players.find(p=>p.id===a.targetId)??players[0];if(target){
      const aim=Math.atan2(a.x-target.x,a.z-target.z),count=strong?7:5;
      for(let i=0;i<count;i++){
        const {p,t}=world.spawnProjectile({...a,weapon:'staff'},WEAPONS.staff),angle=aim+(i-(count-1)/2)*.16;
        const distance=Math.max(1,Math.hypot(target.x-a.x,target.z-a.z)),rise=clamp((target.y-a.y-.3)/distance,-.5,.5);
        p.key=`${a.id}:cinder:${a.attackId}:${i}`;p.velocity=[-Math.sin(angle)*16,rise*16,-Math.cos(angle)*16];p.damage=damage*.7;p.effect='cinder';p.life=2;
        t.setTranslation(a.x-Math.sin(angle)*1.2,a.y+.3,a.z-Math.cos(angle)*1.2);
      }
    }
  }
  if(move==='mirrors')for(const p of players){
    const d=Math.atan2(p.x-a.x,p.z-a.z),spacing=strong?3.2:4.2;
    for(const side of [-1,1])sigil(p.x+Math.cos(d)*spacing*side,p.z-Math.sin(d)*spacing*side,1.3,'stars',2.7);
    if(strong)sigil(p.x,p.z,2.05,'stars',2);
  }
  if(move==='winter'){
    for(let i=0;i<5;i++){const distance=3+i*3;sigil(a.x-Math.sin(a.yaw)*distance,a.z-Math.cos(a.yaw)*distance,.8+i*.17,'frost',2);}
    if(strong)wave(.5,'frost');
  }
  if(move==='judgment'){
    wave();wave(.85);if(strong){wave(1.7);for(const p of players)sigil(p.x,p.z,1.65,'frost',2.1);}
  }
  world.event('boss-cast',a,{move});
}

/** Native overlap identifies bodies; the swept wave band narrows its damage
 * volume to the visible low ring, letting a capsule jump cleanly over it. */
export function stepHazard(world,e,p,t,dt){
  const owner=world.actor(p.owner);if(!owner||owner.hp<=0||p.age>p.life){world.ecd.removeEntity(e);world.projectiles.delete(e);return;}
  if(p.age<p.delay)return;
  const before=waveRadius(p,p.age-dt);
  if(p.kind==='wave')p.radius=waveRadius(p);
  const x=t.translation_x,y=t.translation_y,z=t.translation_z;
  hazardVolume.radius=p.radius+1.6;
  const count=world.physics.overlap(hazardVolume,[x,y+.6,z],upright,world.overlaps,0);
  // Meep resolves its own packed body handles back to entities.
  const touched=new Set();for(let i=0;i<count;i++){const body=world.physics.entityOf(world.overlaps[i]);if(body>=0)touched.add(body);}
  for(const [id,entity] of world.actors){
    const victim=world.actor(id);if(p.hitIds.includes(id)||!touched.has(entity))continue;
    const radius=.32*(victim.boss?1.5:1),distance=Math.hypot(victim.x-x,victim.z-z),feet=actorFeet(victim)[1];
    if(distance>p.radius+radius||p.kind==='wave'&&distance+radius<before*WAVE_INNER_FRACTION)continue;
    const surface=heightAt(victim.x,victim.z)+.12;
    if(feet>surface+(p.kind==='wave'?.85:2.6)||feet+1.7<surface)continue;
    // Characters do not shelter one another from a marked patch of ground.
    if(!world.lineOfSight([x,y+.6,z],[victim.x,victim.y,victim.z],world.actors.get(owner.id),entity,e=>!world.ecd.getComponent(e,Actor)))continue;
    if(world.damage(owner,victim,p.damage,310,['frost','stars'].includes(p.effect)?'magic':'physical',{effect:p.effect}))p.hitIds.push(id);
  }
}

export function clearBossHazards(world,id){for(const e of [...world.projectiles])if(world.ecd.getComponent(e,Projectile).owner===id){world.ecd.removeEntity(e);world.projectiles.delete(e);}}
