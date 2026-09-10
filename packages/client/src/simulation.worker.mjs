import { GameWorld, DT } from '@old-circle/game/simulation/world.mjs';
import { SharedSession, NET_DT, PROTOCOL_VERSION } from '@old-circle/game/network/session.mjs';
import { GameSocketTransport as WebSocketTransport } from '@old-circle/game/network/socket-transport.mjs';
import { WEAPONS } from '@old-circle/game/content/catalog.mjs';
import { SpatialAtlas } from '@old-circle/game/world/spatial-atlas.mjs';
import { landmarkPosition } from '@old-circle/game/world/regions.mjs';
import {Ragdolls} from '@old-circle/game/simulation/ragdolls.mjs';

// Rendering never owns authority. This Worker keeps the same Meep simulation
// warm while NetworkSession predicts and reconciles the connected character.
let world,ragdolls,corpseMode='offline',playerId,url,origin,timer,remote,socket,connecting=false,paused=false,inspect=false;
let last=performance.now(),accumulator=0,retryAt=0,lastServerAt=0,lastServerTick=-1,lastEventTick=-1;
let intent={x:0,z:0,yaw:0,buttons:0},settings={weapon:0,pvp:0,levelStat:0,sequence:0},pendingLevel;
const weaponIds=Object.keys(WEAPONS),stats=['vigor','endurance','might','insight'];
const seenEvents=new Set();
function disconnect(reason='Connection closed'){
  seenEvents.clear();
  postMessage({type:'network-status',message:reason});
  const old=remote;remote=null;connecting=false;retryAt=performance.now()+5000;accumulator=0;lastEventTick=-1;
  const ws=socket;socket=null;try{ws?.close();}catch{}
  old?.stop().catch(e=>console.warn('Session cleanup',e));
  if(pendingLevel){postMessage({type:'level-result',ok:world.actor(playerId).level>pendingLevel.level});pendingLevel=null;}
}
function connect(){
  if(connecting||remote||!url)return;connecting=true;
  const ws=new WebSocket(url);socket=ws;const timeout=setTimeout(()=>{if(socket===ws&&connecting)disconnect();},12000);
  ws.addEventListener('open',()=>ws.send(JSON.stringify({type:'hello',protocol:PROTOCOL_VERSION,playerId,origin,character:world.exportCharacter(playerId)})));
  ws.addEventListener('close',event=>{clearTimeout(timeout);if(socket===ws)disconnect(`Server closed: ${event.code} ${event.reason}`);});
  ws.addEventListener('error',()=>{if(socket===ws)disconnect();});
  ws.addEventListener('message',async function welcome(event){
    if(typeof event.data!=='string')return;
    ws.removeEventListener('message',welcome);
    try{
      const data=JSON.parse(event.data);if(data.type!=='welcome'||data.protocol!==PROTOCOL_VERSION)throw new Error('Incompatible server');
      const candidate=await new SharedSession('client',data.peerId).start();
      if(socket!==ws||ws.readyState!==WebSocket.OPEN){await candidate.stop();return;}
      candidate.localNetworkId=data.networkId;candidate.playerId=playerId;
      const transport=new WebSocketTransport({socket:ws});candidate.connect(0,transport);
      ws.send(JSON.stringify({type:'ready',character:world.exportCharacter(playerId)}));
      remote=candidate;seenEvents.clear();connecting=false;clearTimeout(timeout);lastServerAt=performance.now();lastServerTick=-1;lastEventTick=-1;accumulator=0;
    }catch(error){console.warn('Shared world unavailable',error);if(socket===ws)disconnect(error.stack??String(error));}
  });
}
function update(){
  const now=performance.now(),frameDt=Math.min(.1,(now-last)/1000);accumulator+=frameDt;last=now;
  if(!remote&&!connecting&&now>=retryAt)connect();
  const events=[];let steps=0,mode='offline';
  try{
    if(remote){
      while(accumulator>=NET_DT&&steps++<3){remote.localInput={...intent,...settings};remote.tick();accumulator-=NET_DT;}
      const state=remote.presentation();
      if(state?.actors.some(a=>a.id===playerId)){
        if(state.tick!==lastServerTick){lastServerTick=state.tick;lastServerAt=now;}
        events.push(...state.events);
        world.replaceSnapshot(state);mode='online';
        if(pendingLevel&&remote.localCharacter()?.appliedSequence===pendingLevel.sequence){postMessage({type:'level-result',ok:world.actor(playerId).level>pendingLevel.level});pendingLevel=null;}
      }else{world.input(playerId,intent);if(!paused)world.step(DT);}
      if(now-lastServerAt>3500)disconnect(`No authoritative updates; last tick ${lastServerTick}`);
    }else if(!paused){
      world.input(playerId,intent);while(accumulator>=DT&&steps++<6){world.step();events.push(...world.events);accumulator-=DT;}
    }else accumulator=0;
    if(mode==='online'&&corpseMode!=='online')ragdolls.clear();corpseMode=mode;
    if(!paused||remote)ragdolls.update(frameDt,[...world.actors.keys()].map(id=>world.actor(id)));
    if(steps){
      const snapshot=world.snapshot();snapshot.ragdolls=ragdolls.snapshot();
      snapshot.events=events.filter(e=>{const key=e.key??`${e.tick}:${e.id}:${e.type}`;if(seenEvents.has(key))return false;seenEvents.add(key);return true;});while(seenEvents.size>2048)seenEvents.delete(seenEvents.values().next().value);postMessage({type:'snapshot',snapshot,mode});
    }
  }catch(error){if(remote){console.warn('Connection interrupted',error);disconnect(error.stack??String(error));}else postMessage({type:'error',message:error.stack??String(error)});}
}
self.onmessage=async({data})=>{
  try{
    if(data.type==='start'){
      if(timer)clearInterval(timer);disconnect();if(world)await world.stop();if(ragdolls)await ragdolls.stop();
      world=await new GameWorld().start();playerId=data.playerId;url=data.url;origin=data.origin;inspect=!!data.inspect;
      ragdolls=await new Ragdolls().start();corpseMode='offline';
      const a=world.addPlayer(playerId,origin,data.saved);settings.weapon=weaponIds.indexOf(a.weapon);settings.pvp=Number(a.pvp);
      last=performance.now();retryAt=0;timer=setInterval(update,16);postMessage({type:'ready',snapshot:world.snapshot(),mode:'offline'});
    }
    if(!world)return;
    if(data.type==='input')intent=data.intent;
    if(data.type==='equip'){world.equip(playerId,data.weapon);settings.weapon=weaponIds.indexOf(data.weapon);}
    if(data.type==='pvp'){world.actor(playerId).pvp=data.enabled;settings.pvp=Number(data.enabled);}
    if(data.type==='level'){
      if(remote){settings.levelStat=stats.indexOf(data.stat)+1;settings.sequence++;pendingLevel={sequence:settings.sequence,level:world.actor(playerId).level};}
      else postMessage({type:'level-result',ok:world.levelUp(playerId,data.stat)});
    }
    if(data.type==='save')postMessage({type:'save',character:world.exportCharacter(playerId)});
    if(data.type==='pause'){paused=data.paused;if(paused)intent={...intent,x:0,z:0,buttons:0};}
    if(inspect&&data.type==='inspect'){
      if(data.landmark){const p=landmarkPosition(data.landmark);world.teleport(world.actor(playerId),[p[0],p[1]+1,p[2]+5]);}
      if(data.position)world.teleport(world.actor(playerId),data.position);
      if(Number.isFinite(data.time))world.time=data.time;
      postMessage({type:'snapshot',snapshot:{...world.snapshot(),ragdolls:ragdolls.snapshot()},mode:'offline'});
    }
    if(inspect&&data.type==='atlas'){const atlas=new SpatialAtlas(world).build();postMessage({type:'atlas',faces:atlas.faceCount,samples:atlas.samples});}
    if(data.type==='camera'){
      const p=world.actor(playerId),from=data.from??[p.x,p.y+.7,p.z],to=data.position,d=to.map((v,i)=>v-from[i]),length=Math.hypot(...d);
      if(length<.001)return;
      world.ray.set([...from,...d.map(v=>v/length),length]);
      const hit=world.physics.raycast(world.ray,world.hit,e=>e!==world.actors.get(playerId));
      postMessage({type:'camera',distance:hit?Math.max(.35,world.hit.t-.3):length});
    }
  }catch(error){postMessage({type:'error',message:error.stack??String(error)});}
};
