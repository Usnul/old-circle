import { AssetManagerBufferProvider } from '@woosh/meep-engine/src/engine/sound/sopra/asset/AssetManagerBufferProvider.js';
import { EventDescription } from '@woosh/meep-engine/src/engine/sound/sopra/definition/EventDescription.js';
import { SampleAudioClip } from '@woosh/meep-engine/src/engine/sound/sopra/definition/clip/SampleAudioClip.js';
import { AnimationCurve } from '@woosh/meep-engine/src/engine/animation/curve/AnimationCurve.js';
import { Keyframe } from '@woosh/meep-engine/src/engine/animation/curve/Keyframe.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {v3_distance} from '@woosh/meep-engine/src/core/geom/vec3/v3_distance.js';
import { SoundAssetLoader } from '@woosh/meep-engine/src/engine/asset/loaders/SoundAssetLoader.js';
import { GameAssetType } from '@woosh/meep-engine/src/engine/asset/GameAssetType.js';
import {EventInstanceState} from '@woosh/meep-engine/src/engine/sound/sopra/runtime/EventInstance.js';
import {WorldAcoustics,ACOUSTIC_VOICE_LIMIT} from './acoustics.mjs';
import {heightAt} from '@old-circle/game/world/regions.mjs';

export class WorldAudio {
  constructor(engine,layout){
    this.engine=engine;
    this.layout=layout;
    this.events={};this.localEvents={};
    this.bellTime=0;
    this.footVoices=[];
    this.variants=new Map();
    this.voices=new Set();
    this.fires=new Map();
    this.ambientTime=1;
    this.playedEvents=new Set();
  }
  async start(){
    await this.engine.assetManager.registerLoader(GameAssetType.Sound,new SoundAssetLoader(this.engine.sound.context));
    const provider=new AssetManagerBufferProvider(this.engine.assetManager);this.sopra=this.engine.sound.obtainSopra(provider);
    const steps=['step','paw'].flatMap(kind=>['grass','gravel','stone','snow','wood','sand'].flatMap(surface=>[0,1].map(i=>`${kind}-${surface}-${i}`)));
    await Promise.all(['wind','bell','sword','frost','fire','impact','hurt','effort','potion',...steps].map(async name=>{
      await provider.get(`/assets/audio/${name}.wav`,false);
      const description=new EventDescription();description.label=name;description.rootClip=SampleAudioClip.from(`/assets/audio/${name}.wav`,{loop:name==='wind'||name==='fire',pitchRandom:name==='sword'?80:0,gainRandom:1});
      const step=steps.includes(name);
      description.gainDb=name==='wind'?-23:name==='fire'?-18:step?-13:-9;description.is3D=name!=='wind';description.distanceMax=step?22:45;
      description.busId=name==='wind'?'ambient':'effects';
      description.attenuation=AnimationCurve.from([Keyframe.from(0,1),Keyframe.from(8,.7),Keyframe.from(45,0)]);description.maxInstances=6;
      if(step){description.attenuation=AnimationCurve.from([Keyframe.from(0,1),Keyframe.from(3,.8),Keyframe.from(10,.3),Keyframe.from(22,0)]);description.maxInstances=3;}
      this.events[name]=description;
      if(['impact','hurt','effort','potion'].includes(name))this.localEvents[name]=Object.assign(new EventDescription(),description,{is3D:false,gainDb:name==='impact'?-5:-8,maxInstances:3});
    }));
    this.acoustics = await WorldAcoustics.create(this.sopra, this.engine.entityManager);
    this.wind = this.sopra.playEvent(this.events.wind);
    this.engine.sound.volume=.55;
  }
  spatial(description,position,{loop=false,sourceRadius=.2,maxLifetime=4}={}){
    for(const v of this.voices)if(v.state===EventInstanceState.Stopped)this.voices.delete(v);
    if(this.voices.size>=ACOUSTIC_VOICE_LIMIT)return null;
    if(this.sopra.listenerPosition&&v3_distance(...position,...this.sopra.listenerPosition)>=description.distanceMax)return null;
    const options={position:new Vector3(...position),acoustic:true,pathing:false,sourceRadius,maxLifetime};
    const voice=loop?this.sopra.playEvent(description,options):this.sopra.playOneShot(description,options);
    if(voice){this.voices.add(voice);voice.onEnded.addOne(()=>{this.voices.delete(voice);this.acoustics.simulator.forget(voice);});}return voice;
  }
  play(name,position){return this.spatial(this.events[name],position);}
  playDirect(name){
    return this.sopra.playOneShot(this.localEvents[name],{acoustic:false,pathing:false});
  }
  footstep(actor,foot,position,surface,now,local){
    this.footVoices=this.footVoices.filter(v=>now<v.until);
    // Reserve four voices for the player; crowds cannot drown out their steps.
    if(this.footVoices.filter(v=>v.local===local).length>=(local?4:6))return;
    const key=actor.id+':'+surface,variant=(this.variants.get(key)??0)^1;this.variants.set(key,variant);
    if(this.variants.size>128)this.variants.delete(this.variants.keys().next().value);
    const description=this.events[`${foot.hound?'paw':'step'}-${surface}-${variant}`],voice=this.spatial(description,[position[0],position[1]+.12,position[2]],{maxLifetime:.7,sourceRadius:.06});
    if(voice){voice.setGainDb(description.gainDb+(actor.crouch?-9:Math.hypot(actor.vx,actor.vz)>4?2:0)+(actor.boss?3:0)+(local?0:-3));this.footVoices.push({until:now+.6,local});}
  }
  update(snapshot,player,dt){
    if(!player)return;const listener=new Vector3(player.x,player.y+.65,player.z);this.sopra.listenerPosition=listener;
    if(this.lastSnapshot!==snapshot){
      if(snapshot.presentationEpoch!==this.presentationEpoch){
        this.playedEvents.clear();
        this.presentationEpoch=snapshot.presentationEpoch;
      }
      for(const e of snapshot.events){
        const key=e.key??`${e.tick}:${e.type}:${e.id}`;
        if(this.playedEvents.has(key))continue;
        this.playedEvents.add(key);
        if((e.type==='attack'&&['sword','spear'].includes(e.weapon))||(e.type==='release'&&e.weapon==='bow'))this.play('sword',e.position);
        if(e.type==='nova'||(e.type==='release'&&e.weapon==='staff'))this.play('frost',e.position);
        if(e.type==='boss-defeated')this.play('bell',e.position);
        if(e.type==='boss-cast')this.play(['bell','judgment'].includes(e.move)?'bell':'frost',e.position);
        if(e.type==='hit'){
          if(player?.id===e.id){
            this.playDirect('impact');
            this.playDirect('hurt');
          }else{
            this.play('impact',e.position);
          }
        }
        if(e.type==='heal'){if(e.id===player.id)this.playDirect('potion');else this.play('potion',e.position);}
        if(e.type==='attack'&&e.id===player.id)this.playDirect('effort');
        if(e.type==='jump'&&e.id===player.id)this.playDirect('effort');
      }
      if(this.playedEvents.size>2048){
        this.playedEvents= new Set([...this.playedEvents].slice(-1024));
      }
      this.lastSnapshot=snapshot;
    }
    this.bellTime+=dt;
    if(this.bellTime>42){this.play('bell',[-7,heightAt(-7,-64)+8,-64]);this.bellTime=0;}
    this.ambientTime+=dt;
    if(this.ambientTime>.25){
      this.ambientTime=0;const nearby=this.layout.lights.map((p,i)=>({p,i,d:v3_distance(...p,...listener)})).filter(p=>p.d<32).sort((a,b)=>a.d-b.d).slice(0,3),wanted=new Set(nearby.map(p=>p.i));
      for(const [id,voice] of this.fires)if(!wanted.has(id)){voice.fadeOutAndStop(.25);this.fires.delete(id);}
      for(const {p,i} of nearby)if(!this.fires.has(i)||this.fires.get(i).state===EventInstanceState.Stopped){const v=this.spatial(this.events.fire,p,{loop:true,sourceRadius:.25});if(v)this.fires.set(i,v);}
      const gain=-23-this.acoustics.stats.cover*12;if(gain!==this.windGain){this.wind.fadeToGainDb(gain,.6);this.windGain=gain;}
    }
    this.acoustics.update(listener,this.voices,dt);
    this.sopra.update();
  }
}
