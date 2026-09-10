import { AssetManagerBufferProvider } from '@woosh/meep-engine/src/engine/sound/sopra/asset/AssetManagerBufferProvider.js';
import { EventDescription } from '@woosh/meep-engine/src/engine/sound/sopra/definition/EventDescription.js';
import { SampleAudioClip } from '@woosh/meep-engine/src/engine/sound/sopra/definition/clip/SampleAudioClip.js';
import { AnimationCurve } from '@woosh/meep-engine/src/engine/animation/curve/AnimationCurve.js';
import { Keyframe } from '@woosh/meep-engine/src/engine/animation/curve/Keyframe.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import { SoundAssetLoader } from '@woosh/meep-engine/src/engine/asset/loaders/SoundAssetLoader.js';
import { GameAssetType } from '@woosh/meep-engine/src/engine/asset/GameAssetType.js';

export class WorldAudio {
  constructor(engine){this.engine=engine;this.events={};this.bellTime=0;this.footVoices=[];this.variants=new Map();}
  async start(){
    await this.engine.assetManager.registerLoader(GameAssetType.Sound,new SoundAssetLoader(this.engine.sound.context));
    const provider=new AssetManagerBufferProvider(this.engine.assetManager);this.sopra=this.engine.sound.obtainSopra(provider);
    const steps=['step','paw'].flatMap(kind=>['grass','gravel','stone','snow','wood','sand'].flatMap(surface=>[0,1].map(i=>`${kind}-${surface}-${i}`)));
    await Promise.all(['wind','bell','sword','frost','fire',...steps].map(async name=>{
      await provider.get(`/assets/audio/${name}.wav`,false);
      const description=new EventDescription();description.label=name;description.rootClip=SampleAudioClip.from(`/assets/audio/${name}.wav`,{loop:name==='wind'||name==='fire',pitchRandom:name==='sword'?80:0,gainRandom:1});
      const step=steps.includes(name);
      description.gainDb=name==='wind'?-23:name==='fire'?-18:step?-13:-9;description.is3D=name!=='wind';description.distanceMax=step?22:45;
      description.attenuation=AnimationCurve.from([Keyframe.from(0,1),Keyframe.from(8,.7),Keyframe.from(45,0)]);description.maxInstances=6;
      if(step){description.attenuation=AnimationCurve.from([Keyframe.from(0,1),Keyframe.from(3,.8),Keyframe.from(10,.3),Keyframe.from(22,0)]);description.maxInstances=3;}
      this.events[name]=description;
    }));
    this.sopra.playEvent(this.events.wind);this.sopra.playEvent(this.events.fire,{position:new Vector3(0,2,20)});
    this.engine.sound.volume=.55;
  }
  play(name,position){this.sopra.playOneShot(this.events[name],{position:new Vector3(...position)});}
  footstep(actor,foot,position,surface,now,local){
    this.footVoices=this.footVoices.filter(v=>now<v.until);
    // Reserve four voices for the player; crowds cannot drown out their steps.
    if(this.footVoices.filter(v=>v.local===local).length>=(local?4:6))return;
    const key=actor.id+':'+surface,variant=(this.variants.get(key)??0)^1;this.variants.set(key,variant);
    if(this.variants.size>128)this.variants.delete(this.variants.keys().next().value);
    const description=this.events[`${foot.hound?'paw':'step'}-${surface}-${variant}`],voice=this.sopra.playOneShot(description,{position:new Vector3(...position),maxLifetime:.7});
    if(voice){voice.setGainDb(description.gainDb+(actor.crouch?-9:Math.hypot(actor.vx,actor.vz)>4?2:0)+(actor.boss?3:0)+(local?0:-3));this.footVoices.push({until:now+.6,local});}
  }
  update(snapshot,player,dt){
    if(!player)return;this.sopra.listenerPosition=new Vector3(player.x,player.y,player.z);
    if(this.lastSnapshot!==snapshot){for(const e of snapshot.events){if((e.type==='attack'&&['sword','spear'].includes(e.weapon))||(e.type==='release'&&e.weapon==='bow'))this.play('sword',e.position);if(e.type==='nova'||(e.type==='release'&&e.weapon==='staff'))this.play('frost',e.position);if(e.type==='boss-defeated')this.play('bell',e.position);if(e.type==='boss-cast')this.play(['bell','judgment'].includes(e.move)?'bell':'frost',e.position);}this.lastSnapshot=snapshot;}
    this.bellTime+=dt;
    if(this.bellTime>42){this.play('bell',[0,8,-48]);this.bellTime=0;}
    this.sopra.update();
  }
}
