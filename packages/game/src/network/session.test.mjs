import {expect,test} from 'vitest';
import {LoopbackTransport} from '@woosh/meep-engine/src/engine/network/transport/LoopbackTransport.js';
import {SharedSession} from './session.mjs';
test('Meep initial sync, owned input prediction and authoritative replication work together',async()=>{
  const host=await new SharedSession('host').start(),client=await new SharedSession('client',1).start();
  try{
    client.localNetworkId=host.addPlayer(1,'network-player','pilgrim');client.playerId='network-player';
    const a=new LoopbackTransport(),b=new LoopbackTransport();LoopbackTransport.bind_pair(a,b);host.connect(1,a);client.connect(0,b);
    for(let i=0;i<12;i++){host.tick();b.deliver_all();client.tick();a.deliver_all();}
    expect(client.presentation().actors.some(a=>a.id==='network-player')).toBe(true);
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
