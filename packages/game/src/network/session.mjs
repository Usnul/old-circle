import { EntityManager } from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import { EntityComponentDataset } from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import { NetworkSession } from '@woosh/meep-engine/src/engine/network/NetworkSession.js';
import { NetworkIdentity } from '@woosh/meep-engine/src/engine/network/ecs/components/NetworkIdentity.js';
import { BinarySerializationRegistry } from '@woosh/meep-engine/src/engine/ecs/storage/binary/BinarySerializationRegistry.js';
import { SimAction } from '@woosh/meep-engine/src/engine/network/sim/SimAction.js';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {FrameAdapter} from './frame-adapter.mjs';
import {worldPatch,applyWorldPatch} from './world-patch.mjs';
import { GameWorld,DT } from '../simulation/world.mjs';
import { WEAPONS } from '../content/catalog.mjs';
import {armorIds} from '../content/equipment.mjs';
import {charmIds} from '../content/charms.mjs';
import {projectWorld,scopeInitialSnapshots} from './interest.mjs';

export const PROTOCOL_VERSION=8,NET_DT=1/30;
export class WorldFrame {static typeName='OldCircleWorldFrame';recipient=0;snapshot={version:1,tick:0,time:17.2,actors:[],projectiles:[],events:[]};}
export class CharacterFrame {static typeName='OldCircleCharacterFrame';actor=null;effects=[];intent={x:0,z:0,yaw:0,buttons:0};weapon=0;pvp=0;levelStat=0;sequence=0;armor=0;upgradeWeapon=0;charm=0;appliedSequence=0;}
const weaponIds=Object.keys(WEAPONS),stats=['vigor','endurance','might','insight'];
const InputAction=SimAction.extend({
  type:'OldCircleInput',schema:{network_id:'uintVar',x:'float32',z:'float32',yaw:'float32',buttons:'uint8',weapon:'uint8',pvp:'uint8',levelStat:'uint8',sequence:'uint32',armor:'uint8',upgradeWeapon:'uint8',charm:'uint8'},
  affects(executor){const e=executor.slot_table.entity_for(this.network_id);return e<0?[]:[[e,CharacterFrame]];},
  apply(world,executor){
    const e=executor.slot_table.entity_for(this.network_id);if(e<0)return;const c=world.getComponent(e,CharacterFrame);if(!c)return;
    c.intent={x:this.x,z:this.z,yaw:this.yaw,buttons:this.buttons};c.weapon=this.weapon;c.pvp=this.pvp;c.levelStat=this.levelStat;c.sequence=this.sequence;c.armor=this.armor;c.upgradeWeapon=this.upgradeWeapon;c.charm=this.charm;
    if(world.oldCircle.role==='client')world.oldCircle.predict(c);
  },
});

// Arrivals are authored inputs, so a late input replay reapplies the character
// import at the same frame. Mutating a snapshot between ticks loses that import.
class PresenceAction extends SimAction {
  static action_type_name='OldCirclePresence';
  constructor(id='',actor=null){super();this.id=id;this.actor=actor;}
  affected_components(callback,executor){const e=executor.slot_table.entity_for(0);if(e>=0)callback(e,WorldFrame);}
  apply(world,executor){
    const e=executor.slot_table.entity_for(0);if(e<0)return;
    const snapshot=world.getComponent(e,WorldFrame).snapshot;
    snapshot.actors=snapshot.actors.filter(a=>a.id!==this.id);
    if(this.actor)snapshot.actors.push(structuredClone(this.actor));
  }
  serialize(buffer){buffer.writeUTF8String(JSON.stringify({id:this.id,actor:this.actor}));}
  deserialize(buffer){Object.assign(this,JSON.parse(buffer.readUTF8String()));}
  reset(){this.id='';this.actor=null;}
}

const patchAdapter=new FrameAdapter(Object);
class WorldPatchAction extends SimAction {
  static action_type_name='OldCircleWorldPatch';
  constructor(patch=null,networkId=0){super();this.patch=patch;this.networkId=networkId;}
  affected_components(callback,executor){const e=executor.slot_table.entity_for(this.networkId);if(e>=0)callback(e,WorldFrame);}
  apply(world,executor){
    const e=executor.slot_table.entity_for(this.networkId);if(e<0)return;
    if(world.oldCircle.failure)return;
    try{applyWorldPatch(world.getComponent(e,WorldFrame).snapshot,this.patch);}
    catch(error){
      // Meep signals report handler exceptions but keep dispatching. Stop this
      // client before it can present a partially applied world as authoritative.
      const session=world.oldCircle;
      if(session.role==='client')session.failure=new Error(`Peer ${session.peerId}, world ${this.networkId}: ${error.message}`,{cause:error});
      throw session.failure??error;
    }
  }
  serialize(buffer){buffer.writeUintVar(this.networkId);patchAdapter.serialize(buffer,this.patch);}
  deserialize(buffer){this.networkId=buffer.readUintVar();this.patch={};patchAdapter.deserialize(buffer,this.patch);}
  reset(){this.patch=null;this.networkId=0;}
}

/** NetworkSession owns packets, fragmentation, action logs, prediction and replay.
 * The replication dataset is a wire projection; gameplay remains in GameWorld's Meep ECS.
 * A host-only WorldFrame preserves rollback; recipient frames contain bounded
 * nearby actors, projectiles and events and have independent replay baselines.
 */
export class SharedSession {
  constructor(role,peerId=0,{simulation}={}){
    this.role=role;this.peerId=peerId;this.em=new EntityManager();this.ecd=new EntityComponentDataset();
    this.ecd.setComponentTypeMap([NetworkIdentity,WorldFrame,CharacterFrame]);this.em.attachDataset(this.ecd);this.ecd.oldCircle=this;
    this.characters=new Map();this.localInput={x:0,z:0,yaw:0,buttons:0,weapon:0,pvp:0,levelStat:0,sequence:0};this.localNetworkId=0;this.playerId='';
    this.nextNetworkId=1000;this.retired=[];this.syncedPeers=new Set();this.connections=new Map();this.views=new Map();
    this.sim=simulation;this.ownsSimulation=!simulation;
  }
  async start(savedWorld){
    this.sim??=await new GameWorld().start({populate:this.role==='host'});
    if(savedWorld)this.sim.restoreWorld(savedWorld);
    await new Promise((resolve,reject)=>this.em.startup(resolve,reject));
    const registry=new BinarySerializationRegistry();for(const c of [WorldFrame,CharacterFrame])registry.registerAdapter(new FrameAdapter(c),c.typeName);
    this.net=new NetworkSession({entity_manager:this.em,role:this.role,local_peer_id:this.peerId,binary_registry:registry,tick_rate_hz:30,simulation_delay_ticks:3,frame_capacity:64,scope_filter:this.role==='client'?{is_entity_in_scope:(_peer,id)=>id===this.localNetworkId}:null,reconnect:{enabled:false},connection_timeout_ms:3000});
    this.net.replicate(WorldFrame);this.net.replicate(CharacterFrame);this.net.defineAction(InputAction);this.net.defineAction(PresenceAction);this.net.defineAction(WorldPatchAction);
    if(this.role==='client')this.net.defineInputSampler(()=>{
      if(!this.localNetworkId||!this.localCharacter()?.actor)return [];
      const i=this.localInput;return [new InputAction(this.localNetworkId,i.x,i.z,i.yaw,i.buttons,i.weapon,i.pvp,i.levelStat,i.sequence,i.armor??0,i.upgradeWeapon??0,i.charm??0)];
    });
    await this.net.start();
    if(this.role==='client')this.net.peer.onMalformedPacket.add((_peer,error)=>{this.failure=error;});
    if(this.role==='client')this.net.peer.onInitialSync.add((peer,_token,frame)=>{
      const b=new BinaryBuffer();b.writeUint8(1);b.writeUint32(frame);this.net.peer.send_reliable_command(peer,b.raw_bytes,b.position);
    });
    if(this.role==='host'){
      const replicator=this.net.peer.replicator,pack=replicator.pack_for_peer.bind(replicator);
      // Entity scope does not gate global actions or records whose entity was
      // retired. Their packet ACK would credit withheld world deltas as well.
      // Write no action stream until the initial snapshot is acknowledged.
      replicator.pack_for_peer=(peer,from,to,buffer,budget)=>this.syncedPeers.has(peer)?pack(peer,from,to,buffer,budget):from-1;
      replicator.scope_filter={is_entity_in_scope:(peer,id)=>this.views.get(peer)?.networkId===id};
      scopeInitialSnapshots(this.net,peer=>{const view=this.views.get(peer),character=view&&this.characters.get(view.playerId);return view&&character!==undefined?[view.entity,character]:[];});
      this.net.peer.onReliableCommand.add((peer,buffer,offset,length)=>{
        if(length!==5)return;buffer.position=offset;if(buffer.readUint8()!==1)return;const frame=buffer.readUint32();
        if(frame>this.net.current_frame)return;
        // The recipient confirms the baseline it actually installed. Older
        // action history must not race ahead of that initial world snapshot.
        this.net.peer.baseline.set_acked(peer,frame);this.syncedPeers.add(peer);
      });
      const f=new WorldFrame();f.snapshot=this.sim.snapshot();this.worldEntity=this.spawn(0,0,f);
      this.net.server.onRewind.add(()=>{this.worldRewound=true;});
      this.net.server.onLocalSim.add(frame=>this.hostStep(frame));
    }
    return this;
  }
  spawn(networkId,owner,component){const e=this.ecd.createEntity();this.ecd.addComponentToEntity(e,component);const n=new NetworkIdentity();n.network_id=networkId;n.owner_peer_id=owner;this.ecd.addComponentToEntity(e,n);return e;}
  addPlayer(peerId,playerId,origin,saved){
    // Reconnect accepts only the returning character. The authoritative world is never imported.
    let actor=this.sim.actor(playerId);if(!actor)actor=this.sim.addPlayer(playerId,origin,saved);else if(saved)this.sim.importCharacter(playerId,saved);
    const prior=this.characters.get(playerId);if(prior!==undefined){this.retireView(this.ecd.getComponent(prior,NetworkIdentity)?.owner_peer_id);this.retire(prior);}
    const c=new CharacterFrame();c.actor=structuredClone(actor);c.weapon=weaponIds.indexOf(actor.weapon);c.pvp=Number(actor.pvp);
    const networkId=this.nextNetworkId++,e=this.spawn(networkId,peerId,c);this.characters.set(playerId,e);
    const f=new WorldFrame();f.recipient=peerId;f.snapshot=projectWorld(this.sim.snapshot(),playerId);
    const viewId=this.nextNetworkId++;this.views.set(peerId,{playerId,networkId:viewId,entity:this.spawn(viewId,0,f)});
    this.net.send(new PresenceAction(playerId,structuredClone(actor)));
    return networkId;
  }
  hostStep(frame){
    const f=this.ecd.getComponent(this.worldEntity,WorldFrame);
    this.sim.replaceSnapshot(f.snapshot);
    for(const [id,e] of this.characters){const c=this.ecd.getComponent(e,CharacterFrame);if(c&&this.sim.actor(id))this.applyIntent(c,id);}
    const events=[];for(let i=0;i<2;i++){this.sim.step(DT);events.push(...this.sim.events);}
    const snapshot=this.sim.snapshot();snapshot.events=[...f.snapshot.events,...events].filter(e=>e.tick>=snapshot.tick-90).slice(-256);
    // Replaying a past frame can change fields a peer already received. The
    // first fresh frame after that replay carries a complete corrected world;
    // deltas against rewritten history would otherwise leave stale HP/items.
    const replace=this.worldRewound&&frame>this.net.current_frame;
    this.net.send(new WorldPatchAction(worldPatch(f.snapshot,snapshot,{replace})));
    for(const view of this.views.values()){
      const prior=this.ecd.getComponent(view.entity,WorldFrame).snapshot,next=projectWorld(snapshot,view.playerId,prior);
      this.net.send(new WorldPatchAction(worldPatch(prior,next,{replace}),view.networkId));
    }
    if(replace)this.worldRewound=false;
    for(const [id,e] of this.characters){const old=this.ecd.getComponent(e,CharacterFrame),actor=this.sim.actor(id);if(!old||!actor)continue;const next={...old,effects:[],actor:structuredClone(actor),appliedSequence:old.sequence};this.ecd.sendEvent(e,'net_mutate_component',{component_type:CharacterFrame,new_state:next});}
  }
  removePlayer(peerId,id){
    const e=this.characters.get(id);if(e===undefined||this.ecd.getComponent(e,NetworkIdentity)?.owner_peer_id!==peerId)return;
    this.retire(e);this.characters.delete(id);
    this.retireView(peerId);
    this.net.send(new PresenceAction(id));
  }
  retireView(peer){const view=this.views.get(peer);if(view){this.retire(view.entity);this.views.delete(peer);}this.syncedPeers.delete(peer);}
  retire(e){
    // Prior-byte history references local ECS IDs. Keep the old row until that
    // history expires, otherwise a rewind can restore it into a new character.
    this.ecd.removeComponentFromEntity(e,NetworkIdentity);this.retired.push({e,frame:this.net.current_frame});
  }
  importReturningCharacter(id,character){
    this.sim.importCharacter(id,character);
    const frame=this.ecd.getComponent(this.characters.get(id),CharacterFrame),actor=this.sim.actor(id);
    frame.actor=structuredClone(actor);frame.weapon=weaponIds.indexOf(actor.weapon);frame.pvp=Number(actor.pvp);
    this.net.send(new PresenceAction(id,structuredClone(actor)));
  }
  applyIntent(c,id){
    this.sim.input(id,c.intent);this.sim.equip(id,weaponIds[c.weapon]??'sword');this.sim.actor(id).pvp=!!c.pvp;
    if(c.sequence!==c.appliedSequence){
      if(c.levelStat>0)this.sim.levelUp(id,stats[c.levelStat-1]);
      else if(c.armor>0)this.sim.equipArmor(id,armorIds[c.armor-1]);
      else if(c.upgradeWeapon>0)this.sim.reinforce(id,weaponIds[c.upgradeWeapon-1]);
      else if(c.charm>0)this.sim.equipCharm(id,charmIds[c.charm-1]);
    }
  }
  worldFrame(){if(this.role==='host')return this.ecd.getComponent(this.worldEntity,WorldFrame);let f;this.ecd.traverseEntities([WorldFrame],value=>{if(value.recipient===this.peerId)f=value;});return f;}
  localCharacter(){let c;this.ecd.traverseEntities([CharacterFrame,NetworkIdentity],(value,n)=>{if(n.owner_peer_id===this.peerId)c=value;});return c;}
  predict(c){
    const f=this.worldFrame();if(!c.actor||!f||!f.snapshot.actors.length)return;
    const state=structuredClone(f.snapshot),i=state.actors.findIndex(a=>a.id===c.actor.id);if(i<0)return;
    state.actors[i]=structuredClone(c.actor);this.sim.replaceSnapshot(state);this.applyIntent(c,c.actor.id);
    const effects=[];for(let i=0;i<2;i++){this.sim.step(DT,{predictPlayer:c.actor.id});effects.push(...this.sim.events.filter(e=>e.id===c.actor.id&&e.type==='nova'));}
    c.effects=[...(c.effects??[]),...effects].filter(e=>e.tick>=state.tick-90).slice(-32);
    c.actor=structuredClone(this.sim.actor(c.actor.id));c.appliedSequence=c.sequence;
  }
  tick(){if(this.failure)throw this.failure;this.net.normalize_if_dirty();this.net.tick(NET_DT);while(this.retired.length&&this.net.current_frame-this.retired[0].frame>66)this.ecd.removeEntity(this.retired.shift().e);}
  presentation(){if(this.failure)throw this.failure;const f=this.worldFrame(),local=this.localCharacter();if(!f||this.role==='client'&&!local?.actor)return null;const snapshot=structuredClone(f.snapshot);if(local?.actor){const i=snapshot.actors.findIndex(a=>a.id===local.actor.id);if(i>=0)snapshot.actors[i]=structuredClone(local.actor);snapshot.events.push(...structuredClone(local.effects??[]));}return snapshot;}
  connect(peer,transport){
    this.syncedPeers.delete(peer);
    this.net.connect(peer,transport);
    // A world sync can contain more fragments than the channel's 32-bit ACK
    // window. Acknowledge each small burst before its first packets age out;
    // waiting for the next simulation tick can otherwise cause endless resend.
    let received=0;const empty=new Uint8Array(0);
    const acknowledge=(_bytes,length)=>{if(length>9&&++received%16===0)this.net.peer.channel_for(peer)?.send(empty,0);};
    const cleanup=()=>{transport.onReceive.remove(acknowledge);transport.onDisconnect.remove(cleanup);if(this.connections.get(peer)===cleanup)this.connections.delete(peer);};
    this.connections.get(peer)?.();this.connections.set(peer,cleanup);transport.onReceive.add(acknowledge);transport.onDisconnect.add(cleanup);
  }
  async stop(){for(const cleanup of this.connections.values())cleanup();await this.net.stop();if(this.ownsSimulation)await this.sim.stop();await new Promise((resolve,reject)=>this.em.shutdown(resolve,reject));}
}
