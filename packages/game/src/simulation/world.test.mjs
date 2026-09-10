import {afterEach,expect,test} from 'vitest';
import {GameWorld,BUTTON} from './world.mjs';
import {heightAt} from '../world/regions.mjs';
import {BoxShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/BoxShape3D.js';
import {BodyKind} from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import {SpatialAtlas} from '../world/spatial-atlas.mjs';
const worlds=[];
async function setup(){const w=await new GameWorld().start({populate:false});worlds.push(w);return w;}
afterEach(async()=>{for(const w of worlds)await w.stop();worlds.length=0;});
const run=(w,n)=>{for(let i=0;i<n;i++)w.step();};
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
test('a supported character holds a gentle slope without drifting downhill',async()=>{
  const w=await setup(),p=w.addPlayer('slope');w.teleport(p,[100,heightAt(100,35)+1,35]);run(w,120);
  const start=[p.x,p.y,p.z];run(w,600);
  expect(Math.hypot(p.x-start[0],p.z-start[2])).toBeLessThan(.015);
  expect(Math.abs(p.y-start[1])).toBeLessThan(.025);expect(p.grounded).toBe(true);
});
test('restoring an unchanged snapshot does not teleport or wake every actor',async()=>{
  const w=await setup();w.addPlayer('still');run(w,60);let calls=0;
  const original=w.physics.setPose.bind(w.physics);w.physics.setPose=(...args)=>{calls++;return original(...args);};
  w.replaceSnapshot(w.snapshot());expect(calls).toBe(0);
});
test('PvP requires both participants to opt in; collisions apply knockback',async()=>{
  const w=await setup(),a=w.addPlayer('attacker'),b=w.addPlayer('victim');w.teleport(b,[2,a.y,a.z]);const hp=b.hp;
  expect(w.damage(a,b,20,300)).toBe(false);a.pvp=true;expect(w.damage(a,b,20,300)).toBe(false);b.pvp=true;
  expect(w.damage(a,b,20,300)).toBe(true);expect(b.hp).toBe(hp-20);w.step();expect(b.vx).toBeGreaterThan(0);
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
  expect(b.hp).toBeCloseTo(200-(24+12*.55));expect(a.hitIds).toContain(b.id);
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
