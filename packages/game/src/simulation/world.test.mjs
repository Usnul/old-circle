import {afterEach,expect,test} from 'vitest';
import {GameWorld,BUTTON} from './world.mjs';
import {heightAt,HEARTHS} from '../world/regions.mjs';
import {hearthArrival} from './resting.mjs';
import {BoxShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/BoxShape3D.js';
import {BodyKind} from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {SpatialAtlas} from '../world/spatial-atlas.mjs';
import {ARMOR,weaponDamage,reinforcementLimit} from '../content/equipment.mjs';
import {BOSSES} from '../content/catalog.mjs';
const worlds=[];
async function setup(){const w=await new GameWorld().start({populate:false});worlds.push(w);return w;}
afterEach(async()=>{for(const w of worlds)await w.stop();worlds.length=0;});
const run=(w,n)=>{for(let i=0;i<n;i++)w.step();};

test('native foot rays ignore characters and identify the contacted floor and its normal',async()=>{
  const w=await setup(),p=w.addPlayer('feet');run(w,30);
  const hit=w.footSurface([p.x,p.y-.845,p.z]);expect(hit).not.toBeNull();expect(hit.normal[1]).toBeGreaterThan(.65);
  const y=heightAt(180,50),floor=w.body([180,y+1,50],BoxShape3D.from(3,.2,3),BodyKind.Static);w.contactSurfaces.set(floor,'wood');
  const plank=w.footSurface([180,y+1.2,50]);expect(plank.surface).toBe('wood');expect(plank.position[1]).toBeCloseTo(y+1.2,3);
  expect(w.footSurface([180,y+5,50])).toBeNull();
});
test('armor protects differently against physical blows and magic and reduces knockback',async()=>{
  const w=await setup(),p=w.addPlayer('armored'),enemy=w.spawnActor('attacker',{},[p.x+3,p.y,p.z]);
  p.inventory.armor='sentinel';const hp=p.hp;
  w.damage(enemy,p,40,100);expect(hp-p.hp).toBeCloseTo(40*(1-ARMOR.sentinel.physical));expect(p.hurtTime).toBeCloseTo(.21);
  const physicalHp=p.hp;w.damage(enemy,p,40,0,'magic');expect(physicalHp-p.hp).toBeCloseTo(40*(1-ARMOR.sentinel.magic));
  p.inventory.armor='keeper';const spellHp=p.hp;w.damage(enemy,p,40,0,'magic');expect(spellHp-p.hp).toBeCloseTo(40*(1-ARMOR.keeper.magic));
});
test('hearth reinforcement spends once, respects seal rank and ownership, and survives legacy saves',async()=>{
  const w=await setup(),p=w.addPlayer('smith');p.embers=2000;
  expect(w.reinforce(p.id,'staff')).toBe(false);expect(p.embers).toBe(2000);
  const base=weaponDamage(p);expect(w.reinforce(p.id,'sword')).toBe(true);expect(weaponDamage(p)).toBeCloseTo(base*1.18);expect(p.embers).toBe(1840);
  expect(w.reinforce(p.id,'sword')).toBe(false);p.seals.push('Dawn');expect(reinforcementLimit(p)).toBe(2);
  expect(w.reinforce(p.id,'sword')).toBe(true);expect(p.embers).toBe(1560);
  const save=w.exportCharacter(p.id);w.importCharacter(p.id,save);expect(p.inventory.reinforcements.sword).toBe(2);
  delete save.inventory.reinforcements;delete save.inventory.armors;save.inventory.armor='road-worn mail';w.importCharacter(p.id,save);
  expect(p.inventory.armor).toBe('mail');expect(p.inventory.armors).toContain('keeper');expect(p.inventory.reinforcements.sword).toBe(0);
  w.teleport(p,[60,heightAt(60,30)+1,30]);expect(w.reinforce(p.id,'sword')).toBe(false);
});
test('origins supply different owned armor and only safe hearths can change it or supply arrows',async()=>{
  const w=await setup(),p=w.addPlayer('ranger','wayfarer');expect(p.inventory.armor).toBe('wayfarer');
  expect(w.equipArmor(p.id,'sentinel')).toBe(false);expect(w.equipArmor(p.id,'mail')).toBe(true);
  p.inventory.arrows=0;expect(w.rest(p)).toBe(true);expect(p.inventory.arrows).toBe(30);
  p.inventory.arrows=47;w.rest(p);expect(p.inventory.arrows).toBe(47);
  const enemy=w.spawnActor('nearby',{},[p.x+8,p.y,p.z]);expect(w.equipArmor(p.id,'wayfarer')).toBe(false);enemy.hp=0;
  expect(w.equipArmor(p.id,'wayfarer')).toBe(true);
});
test('late co-op participants receive armor and a personal ending, while PvP creates no loot',async()=>{
  const w=await setup(),p=w.addPlayer('host'),late=w.addPlayer('late'),seals=Object.values(BOSSES).map(b=>b.seal).filter(s=>s!=='Circle');
  p.seals=[...seals];late.seals=[...seals];const boss=w.spawnActor('king',{archetype:'last-king',boss:true,hp:1,weapon:'spear'},[p.x+4,p.y,p.z]);
  w.damage(p,boss,10,0);expect(p.seals).toContain('Circle');expect(late.seals).toContain('Circle');
  expect(late.inventory.armors).toContain('winter');expect(w.events.filter(e=>e.type==='circle-completed').map(e=>e.id)).toEqual(['host','late']);
  p.pvp=late.pvp=true;late.hp=1;const embers=p.embers,arrows=p.inventory.arrows;w.damage(p,late,10,0);
  expect(p.embers).toBe(embers);expect(p.inventory.arrows).toBe(arrows);
});
test('authored navigation stays unchanged when a player occupies the road',async()=>{
  const w=await setup(),options={bounds:[-5,18,5,34],spacing:1};
  const empty=new SpatialAtlas(w,options).build();w.addPlayer('walker');const occupied=new SpatialAtlas(w,options).build();
  expect(occupied.faceCount).toBe(empty.faceCount);expect(occupied.samples.length).toBe(empty.samples.length);
});
test('walk, sprint and jump are simulated by Meep physics',async()=>{
  const w=await setup(),p=w.addPlayer('player');run(w,60);const z=p.z;
  w.input(p.id,{x:0,z:-1,yaw:0,buttons:0});run(w,60);const walking=z-p.z;expect(walking).toBeGreaterThan(2);expect(walking).toBeLessThan(4);
  const next=p.z;w.input(p.id,{x:0,z:-1,yaw:0,buttons:BUTTON.SPRINT});run(w,60);expect(next-p.z).toBeGreaterThan(walking*1.4);expect(p.stamina).toBeLessThan(p.staminaMax);
  const y=p.y;w.input(p.id,{x:0,z:0,yaw:0,buttons:BUTTON.JUMP});run(w,12);expect(p.y).toBeGreaterThan(y+.4);
});
test('a physical jump produces one landing response and preserves its phase through character import',async()=>{
  const w=await setup(),p=w.addPlayer('landing');w.teleport(p,[160,heightAt(160,120)+1,120]);run(w,90);
  w.input(p.id,{x:0,z:0,yaw:0,buttons:BUTTON.JUMP});w.step();w.input(p.id,{x:0,z:0,yaw:0,buttons:0});
  let landed=0,peakAir=0,peakFall=0;
  for(let i=0;i<150;i++){
    w.step();peakAir=Math.max(peakAir,p.airTime);peakFall=Math.max(peakFall,p.fallSpeed);
    if(p.landingAge===0){
      landed++;expect(p.grounded).toBe(true);expect(p.landingStrength).toBeGreaterThan(.5);
      const saved=w.exportCharacter(p.id);p.landingAge=-1;w.importCharacter(p.id,saved);expect(p.landingAge).toBe(0);
    }
  }
  expect(landed).toBe(1);expect(peakAir).toBeGreaterThan(.8);expect(peakFall).toBeGreaterThan(4);expect(p.landingAge).toBe(-1);
  const legacy=w.exportCharacter(p.id);for(const key of ['airTime','fallSpeed','landingAge','landingStrength'])delete legacy.motion[key];
  p.landingAge=.1;p.airTime=2;w.importCharacter(p.id,legacy);expect(p.landingAge).toBe(-1);expect(p.airTime).toBe(0);
});
test('a supported character holds a gentle slope without drifting downhill',async()=>{
  const w=await setup(),p=w.addPlayer('slope');w.teleport(p,[100,heightAt(100,35)+1,35]);run(w,120);
  const start=[p.x,p.y,p.z];run(w,600);
  expect(Math.hypot(p.x-start[0],p.z-start[2])).toBeLessThan(.015);
  expect(Math.abs(p.y-start[1])).toBeLessThan(.025);expect(p.grounded).toBe(true);
});
test('walking holds a cross-slope heading and keeps uphill contact',async()=>{
  const w=await setup(),p=w.addPlayer('hill-walker');
  w.teleport(p,[38,heightAt(38,-8)+1,-8]);run(w,60);const startX=p.x;w.input(p.id,{x:0,z:-1,yaw:0,buttons:0});run(w,500);
  expect(Math.abs(p.x-startX)).toBeLessThan(.03);expect(p.z).toBeLessThan(-36);
  w.teleport(p,[60,heightAt(60,10)+1,10]);w.input(p.id,{x:0,z:0,yaw:0,buttons:0});run(w,60);w.input(p.id,{x:1,z:0,yaw:0,buttons:0});
  let unsupported=0;for(let i=0;i<120;i++){w.step();if(!p.grounded)unsupported++;}
  expect(unsupported).toBeLessThan(3);expect(p.x).toBeGreaterThan(66.5);expect(Math.abs(p.z-10)).toBeLessThan(.1);
});
test('ground support settles the feet onto the surface instead of hovering inside the probe margin',async()=>{
  const w=await setup(),p=w.addPlayer('grounded');
  for(const [x,z] of [[0,23],[20,0],[100,35]]){
    w.teleport(p,[x,heightAt(x,z)+1,z]);run(w,180);
    const gap=()=>{
      w.ray.set([p.x,p.y,p.z,0,-1,0,1.2]);expect(w.physics.raycast(w.ray,w.hit,e=>e!==w.actors.get(p.id))).toBe(true);
      const n=w.hit.normal,support=[0,0,0];w.ecd.getComponent(w.actors.get(p.id),Collider).shape.support(support,0,-n[0],-n[1],-n[2]);
      return n[0]*support[0]+n[1]*(support[1]+w.hit.t)+n[2]*support[2];
    };
    expect(gap()).toBeLessThan(.035);
    w.setCrouch(p,true);run(w,30);expect(gap()).toBeLessThan(.035);w.setCrouch(p,false);
  }
});
test('Meep terrain collision matches the triangle surface exported to Blender across the world',async()=>{
  const w=await setup();let worst=0;
  for(let z=-447.3;z<140;z+=29.3)for(let x=-225.7;x<230;x+=31.7){
    w.ray.set([x,180,z,0,-1,0,220]);expect(w.physics.raycast(w.ray,w.hit,e=>e===w.terrainEntity)).toBe(true);
    worst=Math.max(worst,Math.abs(w.hit.position[1]-heightAt(x,z)));
  }
  expect(worst).toBeLessThan(.0001);
});
test('ground adhesion does not let contact friction drag down the walking speed',async()=>{
  const w=await setup(),p=w.addPlayer('walking');w.teleport(p,[160,heightAt(160,120)+1,120]);run(w,90);
  w.input(p.id,{x:0,z:-1,yaw:0,buttons:0});run(w,120);expect(-p.vz).toBeGreaterThan(3.4);expect(p.grounded).toBe(true);
  w.input(p.id,{x:0,z:0,yaw:0,buttons:0});run(w,90);expect(Math.hypot(p.vx,p.vz)).toBeLessThan(.02);
});
test('restoring an unchanged snapshot does not teleport or wake every actor',async()=>{
  const w=await setup();w.addPlayer('still');run(w,60);let calls=0;
  const original=w.physics.setPose.bind(w.physics);w.physics.setPose=(...args)=>{calls++;return original(...args);};
  w.replaceSnapshot(w.snapshot());expect(calls).toBe(0);
});

test('prediction suspends distant physics and AI, then local authority resumes both',async()=>{
  const w=await setup(),p=w.addPlayer('predicted'),a=w.spawnActor('distant',{},[180,heightAt(180,100)+6,100]);
  let thoughts=0;const think=w.think.bind(w);w.think=(...args)=>{thoughts++;return think(...args);};
  const y=a.y;for(let i=0;i<30;i++)w.step(1/60,{predictPlayer:p.id});
  expect(thoughts).toBe(0);expect(a.y).toBe(y);expect(w.actor(a.id)).toBe(a);
  run(w,30);expect(thoughts).toBeGreaterThan(0);expect(a.y).toBeLessThan(y-.5);expect(w.predictionSleeping.size).toBe(0);
});

test('older world saves retain progression above a raised terrain surface',async()=>{
  const w=await setup(),p=w.addPlayer('returning');p.embers=345;p.seals=['Dawn'];
  const saved=w.snapshot();delete saved.contentVersion;saved.actors[0].y=-2;saved.actors[0].checkpoint=[0,0,24];
  w.restoreWorld(saved);expect(p.embers).toBe(345);expect(p.seals).toEqual(['Dawn']);
  expect(p.y).toBeGreaterThan(heightAt(p.x,p.z));expect(p.checkpoint[1]).toBeGreaterThan(heightAt(0,24));
});

test('saved NPCs regain authored homes without resurrecting enemies or changing health',async()=>{
  const w=await setup(),p=w.addPlayer('returning'),a=w.spawnActor('displaced',{},[160,heightAt(160,120)+1,120]),dead=w.spawnActor('fallen',{hp:0,deadTime:70},[180,heightAt(180,120)+1,120]);
  const home=[...a.home],saved=w.snapshot(),old=saved.actors.find(v=>v.id===a.id),fallen=saved.actors.find(v=>v.id===dead.id);
  old.x+=100;old.hp=31;old.path=[[0,0,0]];fallen.home[0]+=3;
  w.restoreWorld(saved);
  expect([a.x,a.y,a.z]).toEqual(home);expect(a.hp).toBe(31);expect(a.path).toBeNull();
  expect(dead.hp).toBe(0);expect(dead.deadTime).toBe(70);expect(dead.home[0]).toBe(180);expect(p.embers).toBe(0);
});
test('PvP requires both participants to opt in; collisions apply knockback',async()=>{
  const w=await setup(),a=w.addPlayer('attacker'),b=w.addPlayer('victim');w.teleport(b,[2,a.y,a.z]);const hp=b.hp;
  expect(w.damage(a,b,20,300)).toBe(false);a.pvp=true;expect(w.damage(a,b,20,300)).toBe(false);b.pvp=true;
  expect(w.damage(a,b,20,300)).toBe(true);expect(b.hp).toBeCloseTo(hp-17.6);w.step();expect(b.vx).toBeGreaterThan(0);
});

test('death removes the standing collision capsule and respawn restores it',async()=>{
  const w=await setup(),p=w.addPlayer('fallen'),enemy=w.spawnActor('attacker',{},[2,3,24]),e=w.actors.get(p.id);
  w.setCrouch(p,true);w.damage(enemy,p,1000,200);expect(w.ecd.getComponent(e,Collider)).toBeUndefined();
  const snapshot=w.snapshot();snapshot.actors.find(a=>a.id===p.id).crouch=false;w.replaceSnapshot(snapshot);expect(w.ecd.getComponent(e,Collider)).toBeUndefined();
  w.respawn(p);expect(w.ecd.getComponent(e,Collider)).toBeDefined();expect(p.hp).toBe(p.healthMax);expect(p.crouch).toBe(false);expect(p.y).toBeGreaterThan(heightAt(p.x,p.z));
});
test('Meep line-of-sight queries and nova damage respect cover',async()=>{
  const w=await setup(),a=w.addPlayer('player');w.teleport(a,[100,heightAt(100,30)+1,30]);
  const b=w.spawnActor('victim',{hp:100},[104,a.y,30]);w.body([102,a.y,30],BoxShape3D.from_size(1,4,5),BodyKind.Static);
  expect(w.lineOfSight([a.x,a.y,a.z],[b.x,b.y,b.z],w.actors.get(a.id),w.actors.get(b.id))).toBe(false);
  w.nova(a,7,30,'frost');expect(b.hp).toBe(100);
});
test('a visible melee swing connects once with each victim',async()=>{
  const w=await setup(),a=w.addPlayer('player');w.teleport(a,[100,heightAt(100,30)+1,30]);
  const b=w.spawnActor('victim',{hp:200,healthMax:200},[100,a.y,28.5]);a.yaw=0;w.attack(a);
  for(let i=0;i<12;i++){a.attackAge=.18+i*.02;w.melee(a);}
  expect(b.hp).toBeCloseTo(167);expect(a.hitIds).toContain(b.id);
});
test('sword damage cannot reach beyond the visible blade tip',async()=>{
  const w=await setup(),a=w.addPlayer('player');w.teleport(a,[100,15,30]);
  const b=w.spawnActor('victim',{hp:100},[100,15,27.4]);a.yaw=0;w.attack(a);
  for(let i=0;i<16;i++){a.attackAge=.18+i/60;w.melee(a);}
  expect(b.hp).toBe(100);
});
test('boss resets only after the last living participant leaves or dies',async()=>{
  const w=await setup(),a=w.addPlayer('one'),b=w.addPlayer('two');const boss=w.spawnActor('boss',{boss:true,archetype:'warden',hp:20,healthMax:420,active:true},[0,2,-48]);
  w.teleport(a,[1,2,-45]);w.teleport(b,[2,2,-45]);a.hp=0;w.checkEncounters();expect(boss.hp).toBe(20);
  b.hp=0;w.checkEncounters();expect(boss.hp).toBe(420);expect(boss.active).toBe(false);
});
test('reconnect imports the character and replaces every world-owned state',async()=>{
  const local=await setup(),server=await setup();const p=local.addPlayer('player');p.embers=432;p.seals=['Dawn'];
  local.spawnActor('offline-only',{hp:0},[10,2,0]);server.addPlayer('player');server.spawnActor('server-enemy',{hp:90},[12,2,0]);
  const character=local.exportCharacter('player');server.importCharacter('player',character);local.replaceSnapshot(server.snapshot());
  expect(local.actor('offline-only')).toBeUndefined();expect(local.actor('server-enemy').hp).toBe(90);expect(local.actor('player').embers).toBe(432);expect(local.actor('player').seals).toEqual(['Dawn']);
});

test('character handoff preserves velocity, crouch and action phase without restarting locomotion',async()=>{
  const local=await setup(),server=await setup(),p=local.addPlayer('moving');server.addPlayer(p.id);
  local.setCrouch(p,true);local.input(p.id,{x:1,z:0,yaw:.6,buttons:BUTTON.CROUCH});run(local,45);local.attack(p);local.advanceAttack(p,.2);
  p.sprintExhausted=true;const saved=local.exportCharacter(p.id);server.importCharacter(p.id,saved);const returning=server.actor(p.id);
  for(const key of ['vx','vy','vz','yaw','crouch','animationTime','gaitPhase','attackAge','attackId','sprintExhausted'])expect(returning[key],key).toBe(p[key]);
  server.input(p.id,{x:1,z:0,yaw:.6,buttons:BUTTON.CROUCH});server.step();expect(returning.vx).toBeGreaterThan(1);expect(returning.attackAge).toBeGreaterThan(.2);
});
test('a fast arrow hits a thin wall before the actor behind it',async()=>{
  const w=await setup(),a=w.addPlayer('archer','wayfarer');w.teleport(a,[100,15,30]);
  const b=w.spawnActor('victim',{hp:100},[100,15,25]);w.body([100,15,27],BoxShape3D.from_size(3,4,.02),BodyKind.Static);
  w.attack(a);expect(w.projectiles.size).toBe(0);w.advanceAttack(a,.45);expect(w.projectiles.size).toBe(0);w.advanceAttack(a,.02);expect(w.projectiles.size).toBe(1);w.stepProjectiles(.2);expect(w.projectiles.size).toBe(0);expect(b.hp).toBe(100);
});
test('a fast arrow connects with a visible actor over its swept travel',async()=>{
  const w=await setup(),a=w.addPlayer('archer','wayfarer');w.teleport(a,[100,15,30]);
  const b=w.spawnActor('victim',{hp:100},[100,15,25]);w.attack(a);w.advanceAttack(a,.47);w.stepProjectiles(.2);expect(b.hp).toBeLessThan(100);expect(w.projectiles.size).toBe(0);
});
test('nova damages nearby visible actors and excludes distant actors',async()=>{
  const w=await setup(),a=w.addPlayer('caster');w.teleport(a,[100,15,30]);
  const near=w.spawnActor('near',{hp:100},[102,15,30]),far=w.spawnActor('far',{hp:100},[110,15,30]);
  w.nova(a,6.5,36,'frost');expect(near.hp).toBe(64);expect(far.hp).toBe(100);
  expect(a.attackId).toBe(1); // Area attacks must advance a boss's three-move cycle too.
});
test('crouch preserves foot height and cannot stand into a low ceiling',async()=>{
  const w=await setup(),p=w.addPlayer('player');run(w,60);const standingY=p.y;
  w.setCrouch(p,true);expect(p.y).toBeCloseTo(standingY-.35);
  w.body([p.x,standingY+.65,p.z],BoxShape3D.from_size(3,.2,3),BodyKind.Static);
  w.setCrouch(p,false);expect(p.crouch).toBe(true);
});

test('the Bellkeeper vault shelters its interior and allows walking through both mouths',async()=>{
  const w=await setup(),p=w.addPlayer('vault-walker');
  for(const z of [-14,-18,-22,-26,-30,-34]){
    w.ray.set([39,heightAt(39,z)+1.7,z,0,1,0,12]);
    expect(w.physics.raycast(w.ray,w.hit,e=>e!==w.actors.get(p.id)),`Roof at ${z}`).toBe(true);
    expect(w.hit.t).toBeGreaterThan(2);
  }
  w.teleport(p,[38,heightAt(38,-8)+.86,-8]);w.input(p.id,{x:0,z:-1,yaw:0,buttons:0});run(w,650);
  expect(p.z).toBeLessThan(-42);expect(Math.abs(p.x-38)).toBeLessThan(.1);
});
test('a clear ledge supports hanging, followed by a mantle on jump',async()=>{
  const w=await setup(),p=w.addPlayer('climber');w.teleport(p,[100,15,30]);
  w.body([100,15,28.85],BoxShape3D.from_size(3,2,1),BodyKind.Static);p.yaw=0;
  w.tryMantle(p,w.actors.get(p.id));expect(p.mantle?.phase).toBe('hang');
  run(w,20);expect(p.mantle?.phase).toBe('hang');
  w.input(p.id,{x:0,z:0,yaw:0,buttons:BUTTON.JUMP});run(w,34);
  expect(p.mantle).toBeNull();expect(p.y).toBeGreaterThan(16.7);expect(p.z).toBeLessThan(29.1);
});
test('equipment and arrows belong to the character and survive save import',async()=>{
  const w=await setup(),p=w.addPlayer('player','wayfarer');expect(p.weapon).toBe('bow');w.attack(p);expect(p.inventory.arrows).toBe(29);
  p.attackAge=-1;w.equip(p.id,'staff');expect(p.weapon).toBe('bow');const saved=w.exportCharacter(p.id);
  w.importCharacter(p.id,saved);expect(p.inventory.arrows).toBe(29);expect(p.inventory.weapons).toContain('bow');
});

test('each regional hearth restores resources and remembers a safe return point through saves',async()=>{
  const w=await setup(),p=w.addPlayer('pilgrim');
  for(const hearth of HEARTHS){
    w.teleport(p,hearthArrival(hearth));p.hp=1;p.stamina=0;p.mana=0;p.flasks=0;
    expect(w.rest(p),hearth.id).toBe(true);expect(p.checkpointId).toBe(hearth.id);expect(p.hearths).toContain(hearth.id);
    const saved=w.exportCharacter(p.id);w.importCharacter(p.id,saved);expect(p.checkpointId).toBe(hearth.id);
    w.teleport(p,[0,10,30]);w.respawn(p);expect([p.x,p.y,p.z]).toEqual(hearthArrival(hearth));
    expect([p.hp,p.stamina,p.mana,p.flasks]).toEqual([p.healthMax,p.staminaMax,p.manaMax,3]);
  }
});

test('level improvements cannot spend embers during danger and work at a regional hearth',async()=>{
  const w=await setup(),p=w.addPlayer('learner'),hearth=HEARTHS[2];w.teleport(p,hearthArrival(hearth));p.embers=500;
  const guard=w.spawnActor('guard',{},[p.x+10,p.y,p.z]),stats={...p.stats};
  expect(w.levelUp(p.id,'vigor')).toBe(false);expect(p.embers).toBe(500);expect(p.stats).toEqual(stats);
  guard.hp=0;expect(w.levelUp(p.id,'vigor')).toBe(true);expect(p.level).toBe(2);expect(p.stats.vigor).toBe(stats.vigor+1);expect(p.embers).toBe(377);
  expect(p.checkpointId).toBe(hearth.id);expect(p.hp).toBe(p.healthMax);
  w.teleport(p,[p.x,p.y+5,p.z]);expect(w.rest(p)).toBe(false);
});

test('idle enemies patrol, pause, and keep individual facing and animation phases',async()=>{
  const w=await setup(),a=w.spawnActor('patrol-one',{},[160,heightAt(160,120)+1,120]),b=w.spawnActor('patrol-two',{},[180,heightAt(180,120)+1,120]);
  expect(a.yaw).not.toBe(b.yaw);expect(a.animationTime).not.toBe(b.animationTime);
  const start=[a.x,a.z],phases=new Set();for(let i=0;i<720;i++){w.step();phases.add(a.phase);}
  expect(phases.has('patrol')).toBe(true);expect(phases.has('watch')).toBe(true);
  expect(Math.hypot(a.x-start[0],a.z-start[1])).toBeGreaterThan(1);expect(Math.hypot(a.x-a.home[0],a.z-a.home[2])).toBeLessThan(10);
});

test('crouched players behind an enemy are unseen, while a nearby attack draws attention',async()=>{
  const w=await setup(),p=w.addPlayer('stealth');w.teleport(p,[160,10,125]);p.crouch=true;
  const guard=w.spawnActor('guard',{},[160,10,120]);guard.yaw=0;w.think(guard,1/60);
  expect(guard.targetId).toBeUndefined();w.damage(p,guard,1,0);w.think(guard,1/60);expect(guard.targetId).toBe(p.id);expect(guard.active).toBe(true);
});
