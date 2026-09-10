import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {Animation} from '@woosh/meep-engine/src/engine/ecs/animation/Animation.js';
import {AnimationClip} from '@woosh/meep-engine/src/engine/ecs/animation/AnimationClip.js';

export class WorldBanners {
  constructor(view,placements){
    this.view=view;this.wind=[0,0,0];
    this.banners=placements.map(p=>{
      const t=new Transform64();t.setTranslation(...p.position);t.setRotation(0,Math.sin(p.yaw/2),0,Math.cos(p.yaw/2));t.updateMatrix();
      const mesh=new SGMesh();mesh.url='votiveBanner:player';const animation=new Animation();
      const clips=['calm','breeze','reverse'].map(name=>AnimationClip.fromJSON({name,repeatCount:Infinity,timeScale:0,weight:name==='calm'?1:0}));
      for(const clip of clips)animation.clips.add(clip);
      const id=new Entity().add(t).add(mesh).add(animation).build(view.ecd);
      return {...p,id,clips,time:p.phase,strength:0};
    });
  }
  update(dt){
    for(const b of this.banners){
      this.view.wind.sample(this.wind,b.position[0],b.position[1]+3,b.position[2]);
      // Blender's +Y cloth deflection is local -Z in the engine. A reverse clip
      // handles wind on the opposite face while the mast remains immovable.
      const normal=-this.wind[0]*Math.sin(b.yaw)-this.wind[2]*Math.cos(b.yaw);
      b.strength+=(Math.max(-1,Math.min(1,normal/2))-b.strength)*(1-Math.exp(-dt*2));
      b.time=(b.time+dt*(.55+Math.min(1.2,Math.hypot(...this.wind)*.3)))%3.6;
      b.clips[0].weight.set(1-Math.abs(b.strength));b.clips[1].weight.set(Math.max(0,b.strength));b.clips[2].weight.set(Math.max(0,-b.strength));
      for(const playback of this.view.animations.playbacks_of(b.id)){playback.elapsed=b.time;playback.finished=false;}
    }
  }
}
