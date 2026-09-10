import { AssetManagerBufferProvider } from '@woosh/meep-engine/src/engine/sound/sopra/asset/AssetManagerBufferProvider.js';
import { EventDescription } from '@woosh/meep-engine/src/engine/sound/sopra/definition/EventDescription.js';
import { SampleAudioClip } from '@woosh/meep-engine/src/engine/sound/sopra/definition/clip/SampleAudioClip.js';
import { AnimationCurve } from '@woosh/meep-engine/src/engine/animation/curve/AnimationCurve.js';
import { Keyframe } from '@woosh/meep-engine/src/engine/animation/curve/Keyframe.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import { SoundAssetLoader } from '@woosh/meep-engine/src/engine/asset/loaders/SoundAssetLoader.js';
import { GameAssetType } from '@woosh/meep-engine/src/engine/asset/GameAssetType.js';

export class WorldAudio {
  constructor(engine){this.engine=engine;this.events={};this.lastTick=-1;this.footTime=0;this.bellTime=0;}
  async start(){
    await this.engine.assetManager.registerLoader(GameAssetType.Sound,new SoundAssetLoader(this.engine.sound.context));
    const provider=new AssetManagerBufferProvider(this.engine.assetManager);this.sopra=this.engine.sound.obtainSopra(provider);
    await Promise.all(['wind','bell','sword','frost','step','fire'].map(async name=>{
      await provider.get(`/assets/audio/${name}.wav`,false);
      const description=new EventDescription();description.label=name;description.rootClip=SampleAudioClip.from(`/assets/audio/${name}.wav`,{loop:name==='wind'||name==='fire',pitchRandom:name==='sword'?80:0,gainRandom:1});
      description.gainDb=name==='wind'?-23:name==='fire'?-18:name==='step'?-16:-9;description.is3D=name!=='wind';description.distanceMax=45;
      description.attenuation=AnimationCurve.from([Keyframe.from(0,1),Keyframe.from(8,.7),Keyframe.from(45,0)]);description.maxInstances=6;
      this.events[name]=description;
    }));
    this.sopra.playEvent(this.events.wind);this.sopra.playEvent(this.events.fire,{position:new Vector3(0,2,20)});
    this.engine.sound.volume=.55;
  }
  play(name,position){this.sopra.playOneShot(this.events[name],{position:new Vector3(...position)});}
  update(snapshot,player,dt){
    if(!player)return;this.sopra.listenerPosition=new Vector3(player.x,player.y,player.z);
    if(this.lastSnapshot!==snapshot){for(const e of snapshot.events){if(e.type==='attack'&&e.weapon!=='staff')this.play('sword',e.position);if(e.type==='nova')this.play('frost',e.position);if(e.type==='boss-defeated')this.play('bell',e.position);}this.lastSnapshot=snapshot;}
    this.footTime+=dt;this.bellTime+=dt;
    if(player.grounded&&Math.hypot(player.vx,player.vz)>1&&this.footTime>(player.crouch?.85:.55)){this.play('step',[player.x,player.y,player.z]);this.footTime=0;}
    if(this.bellTime>42){this.play('bell',[0,8,-48]);this.bellTime=0;}
    this.sopra.update();
  }
}
