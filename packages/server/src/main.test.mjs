import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from './main.mjs';
import {SharedSession} from '@old-circle/game/network/session.mjs';
import {GameWorld} from '@old-circle/game/simulation/world.mjs';
import {GameSocketTransport as WebSocketTransport} from '@old-circle/game/network/socket-transport.mjs';
import {WebSocket} from 'ws';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,timeout=8000){const end=Date.now()+timeout;while(!predicate()){if(Date.now()>end)throw new Error('Timed out waiting for network state');await delay(30);}}
async function joinWorld(port,character){
  const socket=new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);await new Promise((done,fail)=>{socket.onopen=done;socket.onerror=fail;});
  const welcome=new Promise(done=>socket.addEventListener('message',e=>done(JSON.parse(e.data)),{once:true}));
  socket.send(JSON.stringify({protocol:1,playerId:'integration-player',origin:'pilgrim',character}));const data=await welcome;
  const session=await new SharedSession('client',data.peerId).start(),malformed=[],syncs=[],transport=new WebSocketTransport({socket});
  session.net.peer.onMalformedPacket.add((_,error)=>{if(malformed.length<5)malformed.push(error.message);});session.net.peer.onInitialSync.add((_,_token,frame)=>syncs.push(frame));
  session.localNetworkId=data.networkId;session.connect(0,transport);
  socket.send(JSON.stringify({type:'ready',character}));const timer=setInterval(()=>session.tick(),1000/30);
  const stop=async()=>{clearInterval(timer);await session.stop();socket.close();};
  try{await until(()=>session.localCharacter()?.actor);}catch(error){const detail={peer:data.peerId,networkId:data.networkId,frame:session.net.current_frame,actors:session.presentation()?.actors.map(a=>a.id),socket:socket.readyState,malformed,syncs,traffic:transport.getStats()};await stop();throw new Error(error.message+' '+JSON.stringify(detail));}
  return {session,stop};
}
test('real socket disconnect, character-only return, and world persistence',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'old-circle-server-'));let server,client,local;
  try{
    server=await startServer({port:0,dataDir});client=await joinWorld(server.port);
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
