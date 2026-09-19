import { GameWorld, DT } from '@old-circle/game/simulation/world.mjs';
import { SharedSession, NET_DT, PROTOCOL_VERSION } from '@old-circle/game/network/session.mjs';
import { GameSocketTransport as WebSocketTransport } from '@old-circle/game/network/socket-transport.mjs';
import { WEAPONS } from '@old-circle/game/content/catalog.mjs';
import {armorIds,reinforcement} from '@old-circle/game/content/equipment.mjs';
import {charmIds} from '@old-circle/game/content/charms.mjs';
import { SpatialAtlas } from '@old-circle/game/world/spatial-atlas.mjs';
import { landmarkPosition,HEARTHS } from '@old-circle/game/world/regions.mjs';
import {hearthArrival} from '@old-circle/game/simulation/resting.mjs';
import {Ragdolls} from '@old-circle/game/simulation/ragdolls.mjs';
import {PresentationEvents} from './presentation-events.mjs';

// Rendering never owns authority. This Worker keeps the same Meep simulation
// warm while NetworkSession predicts and reconciles the connected character.
let world,ragdolls,corpseMode='offline',playerId,url,origin,timer,remote,socket,connecting=false,paused=false,inspect=false,entered=false,characterReady=false;
let last=performance.now(),accumulator=0,retryAt=0,lastServerAt=0,lastServerTick=-1,connectedAt=0;
let intent={x:0,z:0,yaw:0,buttons:0},settings={weapon:0,pvp:0,levelStat:0,armor:0,upgradeWeapon:0,charm:0,sequence:0},pendingLevel,pendingEquipment;
const weaponIds=Object.keys(WEAPONS),stats=['vigor','endurance','might','insight'];
const liveEvents=new PresentationEvents();
let presentationEpoch=0,presentationMode,presentationFrame=-1;
function stamp(snapshot,mode){
  const kind=mode==='online'&&remote?'online':'offline',frame=kind==='online'?remote.net.current_frame*2:world.tick;
  if(kind!==presentationMode||frame<presentationFrame){presentationEpoch++;presentationMode=kind;}
  presentationFrame=frame;const result={...snapshot,presentationFrame:frame,presentationEpoch};
  result.events=liveEvents.read(result);return result;
}
function levelResult(ok){const mode=remote?'online':'offline';postMessage({type:'level-result',ok,snapshot:stamp({...world.snapshot(),events:[],ragdolls:ragdolls.snapshot()},mode),mode});}
function equipmentResult(ok){const mode=remote?'online':'offline';postMessage({type:'equipment-result',ok,snapshot:stamp({...world.snapshot(),events:[],ragdolls:ragdolls.snapshot()},mode),mode});}
function finishEquipment(){if(!pendingEquipment)return;const p=world.actor(playerId),r=pendingEquipment;equipmentResult(r.type==='armor'?p.inventory.armor===r.item:r.type==='charm'?p.inventory.charm===r.item:reinforcement(p,r.item)>r.rank);pendingEquipment=null;}
function disconnect(reason='Connection closed'){
  postMessage({type:'network-status',message:reason});
  const old=remote;remote=null;connecting=false;retryAt=performance.now()+5000;accumulator=0;
  if(old)world.resumeLocalWorld(playerId);
  const ws=socket;socket=null;try{ws?.close();}catch{}
  old?.stop().catch(e=>console.warn('Session cleanup',e));
  if(pendingLevel){levelResult(world.actor(playerId).level>pendingLevel.level);pendingLevel=null;}
  finishEquipment();
  // Rejoining carries the resulting character. A fresh CharacterFrame starts
  // its command sequence at zero, so retained purchases would execute again.
  Object.assign(settings,{levelStat:0,armor:0,upgradeWeapon:0,charm:0,sequence:0});
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
      const candidate=await new SharedSession('client',data.peerId,{simulation:world}).start();
      if(socket!==ws||ws.readyState!==WebSocket.OPEN){await candidate.stop();return;}
      candidate.localNetworkId=data.networkId;candidate.playerId=playerId;
      const transport=new WebSocketTransport({socket:ws});candidate.connect(0,transport);
      ws.send(JSON.stringify({type:'ready',character:world.exportCharacter(playerId)}));
      remote=candidate;connecting=false;clearTimeout(timeout);connectedAt=lastServerAt=performance.now();lastServerTick=-1;accumulator=0;
    }catch(error){console.warn('Shared world unavailable',error);if(socket===ws)disconnect(error.stack??String(error));}
  });
}
function update(){
  if(!entered){last=performance.now();return;}
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
        if(pendingLevel&&remote.localCharacter()?.appliedSequence===pendingLevel.sequence){levelResult(world.actor(playerId).level>pendingLevel.level);pendingLevel=null;}
        if(pendingEquipment&&remote.localCharacter()?.appliedSequence===pendingEquipment.sequence)finishEquipment();
      }else{world.input(playerId,intent);if(!paused)world.step(DT);}
      if(now-connectedAt>5000&&now-lastServerAt>1000)disconnect(`No authoritative updates; continuing locally from tick ${lastServerTick}`);
    }else if(!paused){
      world.input(playerId,intent);while(accumulator>=DT&&steps++<6){world.step();events.push(...world.events);accumulator-=DT;}
    }else accumulator=0;
    if(mode==='online'&&corpseMode!=='online')ragdolls.clear();corpseMode=mode;
    if(!paused||remote)ragdolls.update(frameDt,[...world.actors.keys()].map(id=>world.actor(id)));
    if(steps){
      const snapshot=world.snapshot();snapshot.ragdolls=ragdolls.snapshot();
      snapshot.events=events;postMessage({type:'snapshot',snapshot:stamp(snapshot,mode),mode});
    }
  }catch(error){if(remote){console.warn('Connection interrupted',error);disconnect(error.stack??String(error));}else postMessage({type:'error',message:error.stack??String(error)});}
}
self.onmessage=async({data})=>{
  try{
    if(data.type==='start'){
      entered=false;characterReady=false;paused=true;presentationMode=undefined;accumulator=0;
      if(timer)clearInterval(timer);disconnect();if(world)await world.stop();if(ragdolls)await ragdolls.stop();
      world=await new GameWorld().start();playerId=data.playerId;url=data.url;origin=data.origin;inspect=!!data.inspect;
      ragdolls=await new Ragdolls().start();corpseMode='offline';
      const a=world.addPlayer(playerId,origin,data.saved);settings.weapon=weaponIds.indexOf(a.weapon);settings.pvp=Number(a.pvp);
      characterReady=true;
      last=performance.now();retryAt=0;timer=setInterval(update,16);postMessage({type:'ready',snapshot:stamp(world.snapshot(),'offline'),mode:'offline'});
    }
    if(!world)return;
    if(data.type==='enter-world'){entered=true;paused=!!data.paused;last=performance.now();accumulator=0;}
    if(data.type==='input')intent=data.intent;
    if(data.type==='equip'){world.equip(playerId,data.weapon);settings.weapon=weaponIds.indexOf(data.weapon);}
    if(data.type==='pvp'){world.actor(playerId).pvp=data.enabled;settings.pvp=Number(data.enabled);}
    if(data.type==='level'){
      if(pendingLevel||pendingEquipment)return;
      if(remote){settings.armor=0;settings.upgradeWeapon=0;settings.charm=0;settings.levelStat=stats.indexOf(data.stat)+1;settings.sequence++;pendingLevel={sequence:settings.sequence,level:world.actor(playerId).level};}
      else levelResult(world.levelUp(playerId,data.stat));
    }
    if(data.type==='armor'||data.type==='reinforce'||data.type==='charm'){
      if(pendingLevel||pendingEquipment)return;
      if(remote){
        settings.levelStat=0;settings.armor=data.type==='armor'?armorIds.indexOf(data.item)+1:0;settings.upgradeWeapon=data.type==='reinforce'?weaponIds.indexOf(data.item)+1:0;settings.charm=data.type==='charm'?charmIds.indexOf(data.item)+1:0;settings.sequence++;
        pendingEquipment={type:data.type,item:data.item,sequence:settings.sequence,rank:reinforcement(world.actor(playerId),data.item)};
      }else equipmentResult(data.type==='armor'?world.equipArmor(playerId,data.item):data.type==='charm'?world.equipCharm(playerId,data.item):world.reinforce(playerId,data.item));
    }
    // addPlayer creates a default actor before importing the saved character.
    // A rejected import must never export that partial state over the save.
    if(data.type==='save'&&characterReady)postMessage({type:'save',character:world.exportCharacter(playerId)});
    if(data.type==='pause'){paused=data.paused;if(paused)intent={...intent,x:0,z:0,buttons:0};}
    if(inspect&&data.type==='inspect'){
      if(data.landmark){const hearth=HEARTHS.find(h=>h.id===data.landmark),p=landmarkPosition(data.landmark);world.teleport(world.actor(playerId),hearth?hearthArrival(hearth):[p[0],p[1]+1,p[2]+5]);}
      if(data.position)world.teleport(world.actor(playerId),data.position);
      if(Number.isFinite(data.time))world.time=data.time;
      presentationEpoch++;postMessage({type:'snapshot',snapshot:stamp({...world.snapshot(),ragdolls:ragdolls.snapshot()},'offline'),mode:'offline'});
    }
    if(inspect&&data.type==='atlas'){const atlas=new SpatialAtlas(world).build();postMessage({type:'atlas',faces:atlas.faceCount,samples:atlas.samples});}
    if(data.type==='foot-surfaces'){
      if(data.epoch!==presentationEpoch)return;
      postMessage({type:'foot-surfaces',id:data.id,epoch:data.epoch,hits:data.feet.slice(0,64).map(f=>world.footSurface(f.position,f.scale))});
    }
    if(data.type==='camera'){
      const p=world.actor(playerId),from=data.from??[p.x,p.y+.7,p.z],to=data.position,d=to.map((v,i)=>v-from[i]),length=Math.hypot(...d);
      if(length<.001)return;
      world.ray.set([...from,...d.map(v=>v/length),length]);
      const hit=world.physics.raycast(world.ray,world.hit,e=>e!==world.actors.get(playerId));
      const distance=hit?Math.max(.35,world.hit.t-.3):length;
      let shelter=0;
      for(const [dx,dz] of [[0,0],[-2,0],[2,0],[0,-2],[0,2]]){
        world.ray.set([p.x+dx,p.y+.8,p.z+dz,0,1,0,18]);
        if(world.physics.raycast(world.ray,world.hit,e=>e!==world.actors.get(playerId)))shelter+=.2;
      }
      postMessage({type:'camera',distance,shelter});
    }
  }catch(error){if(data.type==='start')characterReady=false;postMessage({type:'error',message:error.stack??String(error)});}
};

// Baked-asset imports have completed and the message handler is installed.
postMessage({type:'initialized'});
