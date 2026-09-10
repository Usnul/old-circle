import {expect,test} from 'vitest';
import {LoopbackTransport} from '@woosh/meep-engine/src/engine/network/transport/LoopbackTransport.js';
import {SharedSession} from './session.mjs';
import {GameWorld} from '../simulation/world.mjs';
import {heightAt} from '../world/regions.mjs';
import {armorIds} from '../content/equipment.mjs';
import {castBossMove} from '../simulation/boss-attacks.mjs';

test('a late joining peer sees a pending root trap and receives its damage only once',async()=>{
  const sim=await new GameWorld().start({populate:false,navigation:false});sim.think=()=>{};
  const present=sim.addPlayer('present');sim.teleport(present,[185,heightAt(185,100)+1,100]);
  const boss=sim.spawnActor('widow',{boss:true,archetype:'rootbound',hp:630,healthMax:630,weapon:'sword'},[180,heightAt(180,100)+1.3,100]);
  for(let i=0;i<60;i++)sim.step();castBossMove(sim,boss,'roots');const key=sim.snapshot().projectiles[0].key;
  const host=await new SharedSession('host',0,{simulation:sim}).start(),client=await new SharedSession('client',1).start();
  try{
    const saved=sim.exportCharacter(present.id);saved.x+=.9;client.localNetworkId=host.addPlayer(1,'late-pilgrim','pilgrim',saved);
    const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    const frames=n=>{for(let i=0;i<n;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}};frames(12);
    const warning=client.presentation().projectiles.find(p=>p.key===key);expect(warning.age).toBeLessThan(warning.delay);expect(warning.position[0]).toBeCloseTo(present.x,1);
    const hp=host.sim.actor('late-pilgrim').hp;frames(55);const expected=hp-29*.85*.88;
    expect(host.sim.actor('late-pilgrim').hp).toBeCloseTo(expected);expect(client.localCharacter().actor.hp).toBeCloseTo(expected);expect(client.presentation().projectiles).toHaveLength(0);
  }finally{await client.stop();await host.stop();await sim.stop();}
},30000);

test('hearth equipment commands replay once and replicate owned armor and reinforcement',async()=>{
  const host=await new SharedSession('host').start(),client=await new SharedSession('client',1).start();
  try{
    const p=host.sim.addPlayer('smith','wayfarer');p.embers=2000;p.seals=['Dawn'];
    client.localNetworkId=host.addPlayer(1,p.id,'wayfarer',host.sim.exportCharacter(p.id));
    const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    const frames=n=>{for(let i=0;i<n;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}};frames(12);
    client.localInput={...client.localInput,sequence:1,upgradeWeapon:1};frames(20);
    expect(host.sim.actor(p.id).inventory.reinforcements.sword).toBe(1);expect(host.sim.actor(p.id).embers).toBe(1840);
    client.localInput={...client.localInput,sequence:2,upgradeWeapon:0,armor:armorIds.indexOf('keeper')+1};frames(20);
    expect(host.sim.actor(p.id).inventory.armor).toBe('keeper');expect(client.localCharacter().actor.inventory.armor).toBe('keeper');
    expect(client.localCharacter().actor.inventory.reinforcements.sword).toBe(1);expect(host.sim.actor(p.id).embers).toBe(1840);
    client.localInput={...client.localInput,sequence:3,armor:0,levelStat:1};frames(20);
    expect(host.sim.actor(p.id).level).toBe(2);expect(client.localCharacter().actor.stats.vigor).toBe(11);
    expect(host.sim.actor(p.id).embers).toBe(1717);
  }finally{await client.stop();await host.stop();}
});
test('Meep initial sync, owned input prediction and authoritative replication work together',async()=>{
  const host=await new SharedSession('host').start(),client=await new SharedSession('client',1).start();
  try{
    for(let i=0;i<90;i++)host.tick();
    let synchronized=false,actionsBeforeSync=0;
    client.net.peer.onInitialSync.add(()=>{synchronized=true;});
    client.net.peer.replicator.onFrameApplied.add(()=>{if(!synchronized)actionsBeforeSync++;});
    client.localNetworkId=host.addPlayer(1,'network-player','pilgrim');client.playerId='network-player';
    const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    for(let i=0;i<12;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}
    expect(client.presentation().actors.some(a=>a.id==='network-player')).toBe(true);
    expect(actionsBeforeSync).toBe(0);
    const initial=host.sim.actor('network-player').z;client.localInput.z=-1;
    for(let i=0;i<35;i++){client.tick();a.deliver_all();host.tick();b.deliver_all();}
    expect(host.sim.actor('network-player').z).toBeLessThan(initial-1);
    expect(client.localCharacter().actor.z).toBeCloseTo(host.sim.actor('network-player').z,0);
    client.localInput.z=0;client.localInput.buttons=16;client.tick();
    expect(client.presentation().events.some(e=>e.type==='nova'&&e.id==='network-player')).toBe(true);
    a.deliver_all();host.tick();b.deliver_all();client.localInput.buttons=0;
    for(let i=0;i<5;i++){client.tick();a.deliver_all();host.tick();b.deliver_all();}
    expect(host.worldFrame().snapshot.events.some(e=>e.type==='nova'&&e.id==='network-player')).toBe(true);
  }finally{await client.stop();await host.stop();}
},30000);

test('late combat input corrects already-published enemy health after server replay',async()=>{
  const host=await new SharedSession('host').start(),client=await new SharedSession('client',1).start();
  try{
    const snapshot=host.worldFrame().snapshot,victim=snapshot.actors.find(a=>a.id==='enemy-0');
    Object.assign(victim,{x:160,y:heightAt(160,120)+1,z:120,home:[160,heightAt(160,120)+1,120],patrolWaitUntil:100000});
    host.sim.replaceSnapshot(snapshot);const player=host.sim.addPlayer('delayed-caster');host.sim.teleport(player,[163,heightAt(163,120)+1,120]);
    const saved=host.sim.exportCharacter(player.id);client.localNetworkId=host.addPlayer(1,player.id,'pilgrim',saved);
    const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    for(let i=0;i<10;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}
    const hp=host.sim.actor(victim.id).hp;
    client.localInput.buttons=16;client.tick();client.localInput.buttons=0;
    // Keep the input in flight while the host publishes those frames.
    for(let i=0;i<12;i++){host.tick();b.deliver_all();client.tick();}
    a.deliver_all();host.tick();b.deliver_all();
    expect(host.sim.actor(victim.id).hp).toBeLessThan(hp);
    expect(client.worldFrame().snapshot.actors.find(a=>a.id===victim.id).hp).toBe(host.sim.actor(victim.id).hp);
  }finally{await client.stop();await host.stop();}
},30000);

test('disconnecting prediction preserves the running local physics world for offline play',async()=>{
  const world=await new GameWorld().start({populate:false}),p=world.addPlayer('continuing-player');
  try{
    const physics=world.physics,session=await new SharedSession('client',1,{simulation:world}).start();
    expect(session.sim).toBe(world);await session.stop();
    const tick=world.tick,z=p.z;world.input(p.id,{x:0,z:1,yaw:0,buttons:0});for(let i=0;i<60;i++)world.step();
    expect(world.physics).toBe(physics);expect(world.tick).toBe(tick+60);expect(p.z).toBeGreaterThan(z+2);
  }finally{await world.stop();}
});
