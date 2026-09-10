import { EntityManager } from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import { EntityComponentDataset } from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import { NetworkSession } from '@woosh/meep-engine/src/engine/network/NetworkSession.js';
import { NetworkIdentity } from '@woosh/meep-engine/src/engine/network/ecs/components/NetworkIdentity.js';
import { BinarySerializationRegistry } from '@woosh/meep-engine/src/engine/ecs/storage/binary/BinarySerializationRegistry.js';
import { SimAction } from '@woosh/meep-engine/src/engine/network/sim/SimAction.js';
import { JsonComponentAdapter } from '../simulation/components.mjs';
import { GameWorld,DT } from '../simulation/world.mjs';
import { WEAPONS } from '../content/catalog.mjs';

export const PROTOCOL_VERSION=1,NET_DT=1/30;
export class WorldFrame {static typeName='OldCircleWorldFrame';snapshot={version:1,tick:0,time:17.2,actors:[],projectiles:[],events:[]};}
export class CharacterFrame {static typeName='OldCircleCharacterFrame';actor=null;effects=[];intent={x:0,z:0,yaw:0,buttons:0};weapon=0;pvp=0;levelStat=0;sequence=0;appliedSequence=0;}
const weaponIds=Object.keys(WEAPONS),stats=['vigor','endurance','might','insight'];
const InputAction=SimAction.extend({
  type:'OldCircleInput',schema:{network_id:'uintVar',x:'float32',z:'float32',yaw:'float32',buttons:'uint8',weapon:'uint8',pvp:'uint8',levelStat:'uint8',sequence:'uint32'},
  affects(executor){const e=executor.slot_table.entity_for(this.network_id);return e<0?[]:[[e,CharacterFrame]];},
  apply(world,executor){
    const e=executor.slot_table.entity_for(this.network_id);if(e<0)return;const c=world.getComponent(e,CharacterFrame);if(!c)return;
    c.intent={x:this.x,z:this.z,yaw:this.yaw,buttons:this.buttons};c.weapon=this.weapon;c.pvp=this.pvp;c.levelStat=this.levelStat;c.sequence=this.sequence;
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

/** NetworkSession owns packets, fragmentation, action logs, prediction and replay.
 * The replication dataset is a wire projection; gameplay remains in GameWorld's Meep ECS.
 * WorldFrame is a correctness-first baseline. Split it into scoped per-actor records before scaling.
 */
export class SharedSession {
  constructor(role,peerId=0){
    this.role=role;this.peerId=peerId;this.em=new EntityManager();this.ecd=new EntityComponentDataset();
    this.ecd.setComponentTypeMap([NetworkIdentity,WorldFrame,CharacterFrame]);this.em.attachDataset(this.ecd);this.ecd.oldCircle=this;
    this.characters=new Map();this.localInput={x:0,z:0,yaw:0,buttons:0,weapon:0,pvp:0,levelStat:0,sequence:0};this.localNetworkId=0;this.playerId='';
    this.nextNetworkId=1000;this.retired=[];
  }
  async start(savedWorld){
    this.sim=await new GameWorld().start({populate:this.role==='host'});
    if(savedWorld)this.sim.restoreWorld(savedWorld);
    await new Promise((resolve,reject)=>this.em.startup(resolve,reject));
    const registry=new BinarySerializationRegistry();for(const c of [WorldFrame,CharacterFrame])registry.registerAdapter(new JsonComponentAdapter(c),c.typeName);
    this.net=new NetworkSession({entity_manager:this.em,role:this.role,local_peer_id:this.peerId,binary_registry:registry,tick_rate_hz:30,simulation_delay_ticks:0,frame_capacity:64,scope_filter:this.role==='client'?{is_entity_in_scope:(_peer,id)=>id===this.localNetworkId}:null,reconnect:{enabled:false},connection_timeout_ms:3000});
    this.net.replicate(WorldFrame);this.net.replicate(CharacterFrame);this.net.defineAction(InputAction);this.net.defineAction(PresenceAction);
    if(this.role==='client')this.net.defineInputSampler(()=>{
      if(!this.localNetworkId)return [];
      const i=this.localInput;return [new InputAction(this.localNetworkId,i.x,i.z,i.yaw,i.buttons,i.weapon,i.pvp,i.levelStat,i.sequence)];
    });
    await this.net.start();
    if(this.role==='host'){
      const f=new WorldFrame();f.snapshot=this.sim.snapshot();this.worldEntity=this.spawn(0,0,f);
      this.net.server.onLocalSim.add(()=>this.hostStep());
    }
    return this;
  }
  spawn(networkId,owner,component){const e=this.ecd.createEntity();this.ecd.addComponentToEntity(e,component);const n=new NetworkIdentity();n.network_id=networkId;n.owner_peer_id=owner;this.ecd.addComponentToEntity(e,n);return e;}
  addPlayer(peerId,playerId,origin,saved){
    // Reconnect accepts only the returning character. The authoritative world is never imported.
    let actor=this.sim.actor(playerId);if(!actor)actor=this.sim.addPlayer(playerId,origin,saved);else if(saved)this.sim.importCharacter(playerId,saved);
    const prior=this.characters.get(playerId);if(prior!==undefined)this.retire(prior);
    const c=new CharacterFrame();c.actor=structuredClone(actor);c.weapon=weaponIds.indexOf(actor.weapon);c.pvp=Number(actor.pvp);
    const networkId=this.nextNetworkId++,e=this.spawn(networkId,peerId,c);this.characters.set(playerId,e);
    this.net.send(new PresenceAction(playerId,structuredClone(actor)));
    return networkId;
  }
  hostStep(){
    const f=this.ecd.getComponent(this.worldEntity,WorldFrame);
    this.sim.replaceSnapshot(f.snapshot);
    for(const [id,e] of this.characters){const c=this.ecd.getComponent(e,CharacterFrame);if(c&&this.sim.actor(id))this.applyIntent(c,id);}
    const events=[];for(let i=0;i<2;i++){this.sim.step(DT);events.push(...this.sim.events);}
    const snapshot=this.sim.snapshot();snapshot.events=[...f.snapshot.events,...events].filter(e=>e.tick>=snapshot.tick-90).slice(-256);
    this.ecd.sendEvent(this.worldEntity,'net_mutate_component',{component_type:WorldFrame,new_state:{snapshot}});
    for(const [id,e] of this.characters){const old=this.ecd.getComponent(e,CharacterFrame),actor=this.sim.actor(id);if(!old||!actor)continue;const next={...old,effects:[],actor:structuredClone(actor),appliedSequence:old.sequence};this.ecd.sendEvent(e,'net_mutate_component',{component_type:CharacterFrame,new_state:next});}
  }
  removePlayer(peerId,id){
    const e=this.characters.get(id);if(e===undefined||this.ecd.getComponent(e,NetworkIdentity)?.owner_peer_id!==peerId)return;
    this.retire(e);this.characters.delete(id);
    this.net.send(new PresenceAction(id));
  }
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
    if(c.levelStat>0&&c.sequence!==c.appliedSequence)this.sim.levelUp(id,stats[c.levelStat-1]);
  }
  worldFrame(){let f;this.ecd.traverseEntities([WorldFrame],value=>f=value);return f;}
  localCharacter(){let c;this.ecd.traverseEntities([CharacterFrame,NetworkIdentity],(value,n)=>{if(n.owner_peer_id===this.peerId)c=value;});return c;}
  predict(c){
    const f=this.worldFrame();if(!c.actor||!f||!f.snapshot.actors.length)return;
    const state=structuredClone(f.snapshot),i=state.actors.findIndex(a=>a.id===c.actor.id);if(i<0)return;
    state.actors[i]=structuredClone(c.actor);this.sim.replaceSnapshot(state);this.applyIntent(c,c.actor.id);
    const effects=[];for(let i=0;i<2;i++){this.sim.step(DT);effects.push(...this.sim.events.filter(e=>e.id===c.actor.id&&e.type==='nova'));}
    c.effects=[...(c.effects??[]),...effects].filter(e=>e.tick>=state.tick-90).slice(-32);
    c.actor=structuredClone(this.sim.actor(c.actor.id));c.appliedSequence=c.sequence;
  }
  tick(){this.net.normalize_if_dirty();this.net.tick(NET_DT);while(this.retired.length&&this.net.current_frame-this.retired[0].frame>66)this.ecd.removeEntity(this.retired.shift().e);}
  presentation(){const f=this.worldFrame();if(!f)return null;const snapshot=structuredClone(f.snapshot),local=this.localCharacter();if(local?.actor){const i=snapshot.actors.findIndex(a=>a.id===local.actor.id);if(i>=0)snapshot.actors[i]=structuredClone(local.actor);snapshot.events.push(...structuredClone(local.effects??[]));}return snapshot;}
  connect(peer,transport){this.net.connect(peer,transport);}
  async stop(){await this.net.stop();await this.sim.stop();await new Promise((resolve,reject)=>this.em.shutdown(resolve,reject));}
}
