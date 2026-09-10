import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WebSocketServer} from 'ws';
import {GameSocketTransport as WebSocketTransport} from '@old-circle/game/network/socket-transport.mjs';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {SharedSession,PROTOCOL_VERSION,NET_DT} from '@old-circle/game/network/session.mjs';
import {INTEREST} from '@old-circle/game/network/interest.mjs';
import {staticAssets} from './static-assets.mjs';

const root=resolve(import.meta.dirname,'../../..');
// Disk saves are independent of network framing. Protocol upgrades must not
// invalidate the persistent world's existing Meep binary envelope.
const WORLD_SAVE_VERSION=1;
export async function startServer({port=Number(process.env.PORT??8787),address=process.env.HOST??'127.0.0.1',dataDir=process.env.OLD_CIRCLE_DATA_DIR??resolve(root,'.local/server'),maxPlayers=Number(process.env.OLD_CIRCLE_MAX_PLAYERS??INTEREST.players)}={}){
  if(!Number.isInteger(maxPlayers)||maxPlayers<1||maxPlayers>INTEREST.maximumPlayers)throw new Error(`Player capacity must be 1–${INTEREST.maximumPlayers}`);
  const storage=resolve(dataDir),savePath=resolve(storage,'world.meep'),clientRoot=resolve(root,'packages/client/dist');
  await mkdir(storage,{recursive:true});let saved;
  try{const bytes=await readFile(savePath),b=new BinaryBuffer();b.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));if(b.readUint32()!==WORLD_SAVE_VERSION)throw new Error('Unsupported world save');saved=JSON.parse(b.readUTF8String());saved.actors=saved.actors.filter(a=>a.kind!=='player');}catch(e){if(e.code!=='ENOENT')throw e;}
  const host=await new SharedSession('host').start(saved),sockets=new Map(),joins=new Map(),reservedPeers=new Set(),serve=staticAssets(clientRoot);
  const http=createServer(async(req,res)=>{
    if(req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({title:'Old Circle',protocol:PROTOCOL_VERSION,tick:host.sim.tick,players:sockets.size,capacity:maxPlayers}));return;}
    await serve(req,res);
  });
  const wss=new WebSocketServer({server:http,path:'/multiplayer',maxPayload:2*1024*1024});
  wss.on('connection',socket=>{
    let info,readyTimeout,closed=false;
    const timeout=setTimeout(()=>socket.close(1008,'Join timed out'),5000);
    socket.on('close',()=>{
      if(closed)return;closed=true;clearTimeout(timeout);clearTimeout(readyTimeout);sockets.delete(socket);
      if(info){if(joins.get(info.playerId)?.socket===socket)joins.delete(info.playerId);host.removePlayer(info.peerId,info.playerId);queueMicrotask(()=>{host.net.drop_peer(info.peerId,'Socket closed');reservedPeers.delete(info.peerId);});}
    });
    socket.once('message',(bytes,isBinary)=>{
      clearTimeout(timeout);
      try{
        if(isBinary)throw new Error('Expected join');const hello=JSON.parse(bytes.toString());
        if(hello.protocol!==PROTOCOL_VERSION||typeof hello.playerId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(hello.playerId))throw new Error('Incompatible join');
        const prior=joins.get(hello.playerId);
        if(joins.size>=maxPlayers&&!prior)throw new Error('World is full');
        let peerId=1;while(reservedPeers.has(peerId)&&peerId<=253)peerId++;if(peerId>253)throw new Error('World is full');reservedPeers.add(peerId);
        info={peerId,playerId:hello.playerId};
        // Loading clients already own a reservation. Replace them as well as
        // ready peers, and prevent their delayed ready packet importing a save.
        joins.set(hello.playerId,{socket,info});prior?.socket.close(1000,'Character reconnected');
        const networkId=host.addPlayer(peerId,hello.playerId,hello.origin,hello.character);
        socket.send(JSON.stringify({type:'welcome',protocol:PROTOCOL_VERSION,peerId,networkId}));
        readyTimeout=setTimeout(()=>socket.close(1008,'Client initialization timed out'),15000);
        socket.once('message',(data,isBinary)=>{
          clearTimeout(readyTimeout);
          if(closed||joins.get(info.playerId)?.socket!==socket)return;
          try{
            if(isBinary)throw new Error('Expected ready');const ready=JSON.parse(data.toString());if(ready.type!=='ready')throw new Error('Expected ready');
            if(ready.character)host.importReturningCharacter(hello.playerId,ready.character);
            host.connect(peerId,new WebSocketTransport({socket}));sockets.set(socket,info);
          }catch(error){console.error('Ready rejected:',error.message);socket.close(1008,'Invalid ready');}
        });
      }catch(error){console.error('Join rejected:',error.message);socket.close(1008,error.message.slice(0,100));}
    });
  });
  let last=performance.now(),accumulator=0;
  const ticker=setInterval(()=>{const now=performance.now();accumulator+=Math.min(.25,(now-last)/1000);last=now;let steps=0;while(accumulator>=NET_DT&&steps++<8){host.tick();accumulator-=NET_DT;}},8);
  let saving=Promise.resolve();
  function save(){saving=saving.catch(()=>{}).then(async()=>{const b=new BinaryBuffer();b.writeUint32(WORLD_SAVE_VERSION);b.writeUTF8String(JSON.stringify(host.sim.snapshot()));await writeFile(savePath+'.tmp',new Uint8Array(b.data,0,b.position));await rename(savePath+'.tmp',savePath);});return saving;}
  const saver=setInterval(()=>save().catch(e=>console.error('World save failed',e)),15000);
  let stopping;
  function stop(){return stopping??=(async()=>{clearInterval(ticker);clearInterval(saver);await save();for(const socket of wss.clients)socket.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>http.close(r));await host.stop();})();}
  await new Promise((done,failed)=>{http.once('error',failed);http.listen(port,address,done);});
  return {host,port:http.address().port,save,stop};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const server=await startServer();console.log(`Old Circle: http://${process.env.HOST??'127.0.0.1'}:${server.port}`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.stop().then(()=>process.exit(0)));
}
