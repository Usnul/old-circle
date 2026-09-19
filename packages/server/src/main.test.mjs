import {expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from './main.mjs';
import {SharedSession,PROTOCOL_VERSION} from '@old-circle/game/network/session.mjs';
import {GameWorld} from '@old-circle/game/simulation/world.mjs';
import {GameSocketTransport as WebSocketTransport} from '@old-circle/game/network/socket-transport.mjs';
import {WebSocket} from 'ws';
const delay=ms=>new Promise(r=>setTimeout(r,ms));

test('a failed listen releases the simulation without starting background work',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'old-circle-listen-')),occupied=createServer();
  await new Promise(done=>occupied.listen(0,'127.0.0.1',done));
  const stop=vi.spyOn(SharedSession.prototype,'stop');
  try{
    await expect(startServer({port:occupied.address().port,dataDir})).rejects.toMatchObject({code:'EADDRINUSE'});
    expect(stop).toHaveBeenCalledTimes(1);
  }finally{stop.mockRestore();await new Promise(done=>occupied.close(done));await rm(dataDir,{recursive:true,force:true});}
});

test('a failed shutdown save reports the error after closing the server and simulation',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'old-circle-stop-'));let server,stop;
  try{
    server=await startServer({port:0,dataDir});stop=vi.spyOn(server.host,'stop');
    // A directory at the temporary save path fails consistently on all hosts.
    await mkdir(join(dataDir,'world.meep.tmp'));
    await expect(server.stop()).rejects.toThrow();
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(fetch(`http://127.0.0.1:${server.port}/health`)).rejects.toThrow();
    await expect(server.stop()).rejects.toThrow();expect(stop).toHaveBeenCalledTimes(1);
  }finally{await server?.stop().catch(()=>{});stop?.mockRestore();await rm(dataDir,{recursive:true,force:true});}
});

test('an oversized socket frame closes only its connection and leaves the server available',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'old-circle-socket-error-'));let server,socket;
  const report=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{
    server=await startServer({port:0,dataDir});socket=new WebSocket(`ws://127.0.0.1:${server.port}/multiplayer`);
    await new Promise((done,failed)=>{socket.once('open',done);socket.once('error',failed);});
    const closed=new Promise(done=>socket.once('close',done));socket.send(Buffer.alloc(2*1024*1024+1));await closed;
    const health=await fetch(`http://127.0.0.1:${server.port}/health`);expect(health.status).toBe(200);await health.text();
    expect(report).toHaveBeenCalledWith('Socket rejected:',expect.stringContaining('Max payload size exceeded'));
  }finally{socket?.terminate();await server?.stop();report.mockRestore();await rm(dataDir,{recursive:true,force:true});}
});

async function until(predicate,timeout=8000){const end=Date.now()+timeout;while(!predicate()){if(Date.now()>end)throw new Error('Timed out waiting for network state');await delay(30);}}
async function beginJoin(port,character,playerId='integration-player'){
  const socket=new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);await new Promise((done,fail)=>{socket.onopen=done;socket.onerror=fail;});
  const welcome=new Promise((done,fail)=>{socket.addEventListener('message',e=>done(JSON.parse(e.data)),{once:true});socket.addEventListener('close',e=>fail(new Error(`Join closed: ${e.code} ${e.reason}`)),{once:true});});
  socket.send(JSON.stringify({protocol:PROTOCOL_VERSION,playerId,origin:'pilgrim',character}));return {socket,data:await welcome};
}
async function joinWorld(port,character,playerId='integration-player'){
  const {socket,data}=await beginJoin(port,character,playerId);
  const session=await new SharedSession('client',data.peerId).start(),malformed=[],syncs=[],transport=new WebSocketTransport({socket});
  session.net.peer.onMalformedPacket.add((_,error)=>{if(malformed.length<5)malformed.push(error.message);});session.net.peer.onInitialSync.add((_,_token,frame)=>syncs.push(frame));
  session.localNetworkId=data.networkId;session.connect(0,transport);
  socket.send(JSON.stringify({type:'ready',character}));const timer=setInterval(()=>{try{session.tick();}catch(error){session.failure=error;clearInterval(timer);socket.close();}},1000/30);
  const stop=async()=>{clearInterval(timer);await session.stop();socket.close();};
  try{await until(()=>{if(session.failure)throw session.failure;return session.localCharacter()?.actor;});}catch(error){const detail={peer:data.peerId,networkId:data.networkId,frame:session.net.current_frame,actors:session.worldFrame()?.snapshot.actors.map(a=>a.id),socket:socket.readyState,malformed,syncs,traffic:transport.getStats()};await stop();throw new Error(error.message+' '+JSON.stringify(detail));}
  return {session,stop};
}

test.each([1,2])('a returning character replaces an unfinished join at capacity %i',async maxPlayers=>{
  const dataDir=await mkdtemp(join(tmpdir(),'old-circle-pending-join-'));let server,pending,returning;
  try{
    server=await startServer({port:0,dataDir,maxPlayers});pending=await beginJoin(server.port);
    if(maxPlayers===1)await expect(joinWorld(server.port,undefined,'second-player')).rejects.toThrow('World is full');
    returning=await joinWorld(server.port);
    await until(()=>pending.socket.readyState===WebSocket.CLOSED);
    expect(returning.session.localCharacter().actor.id).toBe('integration-player');
    expect(returning.session.localNetworkId).not.toBe(pending.data.networkId);
    expect(server.host.views.size).toBe(1);expect(server.host.characters.size).toBe(1);
    const health=await fetch(`http://127.0.0.1:${server.port}/health`).then(r=>r.json());expect(health.players).toBe(1);
  }finally{pending?.socket.terminate();await returning?.stop();await server?.stop();await rm(dataDir,{recursive:true,force:true});}
},30000);

test('the server enforces its player budget and permits a returning character to replace its socket',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'old-circle-capacity-'));let server,client,returning;
  try{
    server=await startServer({port:0,dataDir,maxPlayers:1});client=await joinWorld(server.port);
    await expect(joinWorld(server.port,undefined,'second-player')).rejects.toThrow('World is full');
    for(let i=0;i<6;i++){
      returning=await joinWorld(server.port);expect(returning.session.localCharacter().actor.id).toBe('integration-player');
      const joinedTick=returning.session.presentation().tick;
      await until(()=>{if(returning.session.failure)throw returning.session.failure;return returning.session.presentation().tick>joinedTick+12;});
      expect(returning.session.failure).toBeUndefined();
      await client.stop();client=returning;returning=null;
    }
    expect([...server.host.sim.actors.keys()].filter(id=>server.host.sim.actor(id).kind==='player')).toEqual(['integration-player']);
    expect(server.host.views.size).toBe(1);
  }finally{await client?.stop();await returning?.stop();await server?.stop();await rm(dataDir,{recursive:true,force:true});}
},30000);
test('real socket disconnect, character-only return, and world persistence',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'old-circle-server-'));let server,client,local;
  try{
    server=await startServer({port:0,dataDir});
    // A running world accumulates patrol state. The former UTF-8 projection
    // exceeded Meep's default 64 KiB fragment limit and could never join.
    const snapshot=server.host.worldFrame().snapshot;
    for(const a of snapshot.actors){a.patrolWaitUntil=100000;a.path=Array.from({length:40},(_,i)=>[a.x+Math.sin(i)*3,a.y,a.z+Math.cos(i)*3]);}
    expect(JSON.stringify(snapshot).length).toBeGreaterThan(65536);
    client=await joinWorld(server.port);
    const joinedTick=client.session.presentation().tick,z=server.host.sim.actor('integration-player').z;
    client.session.localInput.z=1;
    await until(()=>server.host.sim.actor('integration-player').z>z+1&&client.session.presentation().tick>joinedTick+30);
    client.session.localInput.z=0;
    local=await new GameWorld().start({populate:false});local.replaceSnapshot(client.session.presentation());
    await client.stop();client=null;await until(()=>!server.host.sim.actor('integration-player'));
    const player=local.actor('integration-player');player.embers=617;local.input(player.id,{z:-1,x:0,yaw:0,buttons:0});for(let i=0;i<30;i++)local.step();
    local.spawnActor('offline-only',{hp:1},[100,20,30]);
    client=await joinWorld(server.port,local.exportCharacter(player.id));
    expect(client.session.localCharacter().actor.embers).toBe(617);expect(server.host.sim.actor('offline-only')).toBeUndefined();
    const tick=server.host.sim.tick;await client.stop();client=null;await server.stop();server=await startServer({port:0,dataDir});
    expect(server.host.sim.tick).toBeGreaterThanOrEqual(tick);expect(server.host.sim.actor('integration-player')).toBeUndefined();
  }finally{await client?.stop();await local?.stop();await server?.stop();await rm(dataDir,{recursive:true,force:true});}
},30000);
