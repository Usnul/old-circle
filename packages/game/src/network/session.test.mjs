import {expect,test,vi} from 'vitest';
import {LoopbackTransport} from '@woosh/meep-engine/src/engine/network/transport/LoopbackTransport.js';
import {CharacterFrame,SharedSession} from './session.mjs';
import {GameWorld} from '../simulation/world.mjs';
import {heightAt} from '../world/regions.mjs';
import {armorIds} from '../content/equipment.mjs';
import {charmIds} from '../content/charms.mjs';
import {castBossMove} from '../simulation/boss-attacks.mjs';
import {RELICS} from '../content/relics.mjs';
import {INTEREST} from './interest.mjs';

test('malformed client input cannot poison rollback state and peers cannot replace owned character components',async()=>{
  const host=await new SharedSession('host').start(),client=await new SharedSession('client',1).start();
  try{
    const id='invalid-input';client.localNetworkId=host.addPlayer(1,id);
    const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    const frames=n=>{for(let i=0;i<n;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}};frames(12);
    const rejected=[];host.net.peer.executor.onActionRejected.add((peer,action)=>rejected.push({peer,type:action.constructor.action_type_name??action.constructor.name}));
    client.localInput.x=NaN;client.localInput.pitch=Infinity;frames(12);
    expect(rejected.some(r=>r.peer===1&&r.type==='OldCircleInput')).toBe(true);
    expect(host.ecd.getComponent(host.characters.get(id),CharacterFrame).intent.x).toBe(0);
    expect(client.localCharacter().intent.x).toBe(0);
    client.localInput.x=0;client.localInput.pitch=0;
    const entity=client.net.peer.slot_table.entity_for(client.localNetworkId);
    const replace=()=>client.ecd.sendEvent(entity,'net_mutate_component',{component_type:CharacterFrame,new_state:{...client.localCharacter(),appliedSequence:999}});
    client.net.client.onPredict.add(replace);client.tick();client.net.client.onPredict.remove(replace);
    frames(12);
    expect(rejected.some(r=>r.type==='ReplaceComponentAction')).toBe(true);
    expect(host.ecd.getComponent(host.characters.get(id),CharacterFrame).appliedSequence).toBe(0);
    expect(host.sim.actor(id).hp).toBeGreaterThan(0);expect(client.failure).toBeUndefined();
  }finally{await client.stop();await host.stop();}
});

test('an invalid replicated world baseline stops prediction so the Worker can return to local authority',async()=>{
  const host=await new SharedSession('host').start(),client=await new SharedSession('client',1).start();
  const report=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
    client.localNetworkId=host.addPlayer(1,'missing-baseline');
    const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    for(let i=0;i<18;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}
    client.net.normalize_if_dirty();client.worldFrame().snapshot.tick-=2;
    host.tick();b.deliver_all();
    expect(client.failure?.message).toContain('World history gap');expect(report).toHaveBeenCalled();
    expect(()=>client.tick()).toThrow('World history gap');
    expect(()=>client.presentation()).toThrow('World history gap');
  }finally{report.mockRestore();await client.stop();await host.stop();}
});

test('each peer receives only its nearby world at initial sync and after crossing into another region',async()=>{
  const host=await new SharedSession('host').start(),clients=[],links=[];
  try{
    for(const [peer,id,x,z] of [[1,'west',-115,-225],[2,'east',140,-120]]){
      const p=host.sim.addPlayer(id);host.sim.teleport(p,[x,heightAt(x,z)+1,z]);
      const client=await new SharedSession('client',peer).start();clients.push(client);
      client.localNetworkId=host.addPlayer(peer,id,'pilgrim',host.sim.exportCharacter(id));
      const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);links.push([a,b]);host.connect(peer,a);client.connect(0,b);
    }
    const frames=n=>{for(let i=0;i<n;i++){host.tick();links.forEach(([,b])=>b.deliver_all());clients.forEach(c=>c.tick());links.forEach(([a])=>a.deliver_all());}};frames(18);
    for(const [i,c] of clients.entries()){
      const state=c.presentation();expect(state.scope).toBe('nearby');expect(state.actors).toHaveLength(host.ecd.getComponent(host.views.get(i+1).entity,host.worldFrame().constructor).snapshot.actors.length);
      expect(state.actors.some(a=>a.id===(i?'west':'east'))).toBe(false);expect(state.actors.length).toBeLessThan(host.sim.actors.size/2);
      expect(c.net.peer.slot_table.entity_for(0)).toBeLessThan(0);expect(c.net.peer.slot_table.entity_for(clients[1-i].localNetworkId)).toBeLessThan(0);
    }
    const east=host.sim.actor('east'),saved=host.sim.exportCharacter('west');Object.assign(saved,{x:east.x+3,y:east.y,z:east.z});host.importReturningCharacter('west',saved);frames(30);
    expect(clients[0].presentation().actors.some(a=>a.id==='east')).toBe(true);
    expect(clients[0].presentation().actors.some(a=>a.id==='boss-mirror')).toBe(false);
    expect(clients[1].presentation().actors.some(a=>a.id==='west')).toBe(true);
    expect(clients.every(c=>c.presentation().actors.length<=INTEREST.actors)).toBe(true);
    host.removePlayer(1,'west');frames(12);expect(host.views.has(1)).toBe(false);expect(clients[1].presentation().actors.some(a=>a.id==='west')).toBe(false);
  }finally{for(const c of clients)await c.stop();await host.stop();}
},30000);

test('scoped state converges through delayed, dropped and reordered packets without repeating a purchase',async()=>{
  const host=await new SharedSession('host').start(),client=await new SharedSession('client',1).start();
  try{
    const p=host.sim.addPlayer('imperfect-link');p.embers=500;client.localNetworkId=host.addPlayer(1,p.id,'pilgrim',host.sim.exportCharacter(p.id));
    const a=new LoopbackTransport(),b=new LoopbackTransport();a.reliable=b.reliable=false;a.ordered=b.ordered=false;LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    const clean=n=>{for(let i=0;i<n;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}};clean(18);
    const z=host.sim.actor(p.id).z;client.localInput={...client.localInput,sequence:1,upgradeWeapon:1};
    for(let i=0;i<180;i++){
      host.tick();
      if(i%3===0){if(i%15===0)b.drop_next(1);if(b.queued_count()>2)b.reorder(0,b.queued_count()-1);b.deliver_all();}
      if(i===45)client.localInput.z=1;client.tick();
      if(i%3===1){if(i%19===0)a.drop_next(1);if(a.queued_count()>2)a.reorder(0,a.queued_count()-1);a.deliver_all();}
    }
    client.localInput.z=0;clean(36);
    const actor=host.sim.actor(p.id);expect(actor.z).toBeGreaterThan(z+7);expect(actor.embers).toBe(340);expect(actor.inventory.reinforcements.sword).toBe(1);
    expect(client.localCharacter().actor.embers).toBe(340);expect(client.localCharacter().actor.z).toBeCloseTo(actor.z,1);
    expect(client.presentation().tick).toBeGreaterThan(360);expect(client.failure).toBeUndefined();
  }finally{await client.stop();await host.stop();}
},30000);

test('a delayed relic interaction replays once and replicates the permanent reward',async()=>{
  const sim=await new GameWorld().start({populate:false,navigation:false}),p=sim.addPlayer('relic-seeker'),r=RELICS[0];
  sim.teleport(p,[r.position[0],r.position[1]+.85,r.position[2]+1.5]);
  const host=await new SharedSession('host',0,{simulation:sim}).start(),client=await new SharedSession('client',1).start();
  try{
    client.localNetworkId=host.addPlayer(1,p.id,'pilgrim',sim.exportCharacter(p.id));
    const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    const frames=n=>{for(let i=0;i<n;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}};frames(12);
    client.localInput.buttons=64;client.tick();client.localInput.buttons=0;
    for(let i=0;i<12;i++){host.tick();b.deliver_all();client.tick();}
    a.deliver_all();frames(20);
    const actor=host.sim.actor(p.id);expect(actor.relics).toEqual([r.id]);expect(actor.embers).toBe(r.embers);expect(actor.flasks).toBe(4);
    expect(client.localCharacter().actor.relics).toEqual([r.id]);expect(client.localCharacter().actor.embers).toBe(r.embers);
  }finally{await client.stop();await host.stop();await sim.stop();}
},30000);

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

test('hearth equipment commands replay once and replicate owned armor, reinforcement and charms',async()=>{
  const host=await new SharedSession('host').start(),client=await new SharedSession('client',1).start();
  try{
    const p=host.sim.addPlayer('smith','wayfarer');p.embers=2000;p.seals=['Dawn'];p.relics=['listening-glass'];
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
    client.localInput={...client.localInput,sequence:4,levelStat:0,charm:charmIds.indexOf('glass')+1};
    for(let i=0;i<10;i++){client.tick();host.tick();b.deliver_all();}a.deliver_all();frames(24);
    expect(host.sim.actor(p.id).inventory.charm).toBe('glass');expect(client.localCharacter().actor.inventory.charm).toBe('glass');
    expect(host.sim.actor(p.id).embers).toBe(1717);
    client.localInput={...client.localInput,sequence:5,charm:charmIds.indexOf('crown')+1};frames(20);
    expect(host.sim.actor(p.id).inventory.charm).toBe('glass');expect(client.localCharacter().actor.inventory.charm).toBe('glass');
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

test('pitch crosses loopback into authoritative and predicted aim and defaults to zero when omitted',async()=>{
  const sim=await new GameWorld().start({populate:false,navigation:false});
  const host=await new SharedSession('host',0,{simulation:sim}).start(),client=await new SharedSession('client',1).start();
  try{
    const id='network-player';client.localNetworkId=host.addPlayer(1,id,'pilgrim');
    const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    const frames=n=>{for(let i=0;i<n;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}};frames(12);
    const hostCharacter=()=>host.ecd.getComponent(host.characters.get(id),CharacterFrame);
    expect(hostCharacter().intent.pitch).toBe(0);expect(host.sim.actor(id).intent.pitch).toBe(0);
    for(const pitch of [.45,-.33,undefined]){
      client.localInput={...client.localInput,yaw:.05,pitch};if(pitch===undefined)delete client.localInput.pitch;
      frames(12);
      expect(hostCharacter().intent.pitch).toBeCloseTo(pitch??0);
      expect(host.sim.actor(id).intent.pitch).toBeCloseTo(pitch??0);
      expect(client.localCharacter().intent.pitch).toBeCloseTo(pitch??0);
      expect(client.localCharacter().actor.intent.pitch).toBeCloseTo(pitch??0);
    }
    expect(client.failure).toBeUndefined();
  }finally{await client.stop();await host.stop();await sim.stop();}
},30000);
