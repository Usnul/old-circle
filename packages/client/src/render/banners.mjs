import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {Cloth} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/Cloth.js';
import {t64_announce_change} from '@woosh/meep-engine/src/engine/ecs/transform/t64_announce_change.js';
import {clothComponents} from './cloth.mjs';

export class WorldBanners {
  constructor(view,placements){
    this.view=view;
    this.banners=placements.map(p=>({...p,id:null}));
  }
  create(p){
    const t=new Transform64();t.setTranslation(...p.position);t.setRotation(0,Math.sin(p.yaw/2),0,Math.cos(p.yaw/2));t.updateMatrix();
    const mesh=new SGMesh();mesh.url='votiveBanner:player';
    const components=clothComponents('votiveBanner'),entity=new Entity().add(t).add(mesh);
    for(const component of components)entity.add(component);
    p.id=entity.build(this.view.ecd);p.t=t;p.cloth=components.find(c=>c instanceof Cloth);p.active=true;
  }
  update(dt,player){
    for(const b of this.banners){
      const distance=Math.hypot(b.position[0]-player.x,b.position[1]-player.y,b.position[2]-player.z);
      if(b.id===null){if(distance>90)continue;this.create(b);}
      else if(b.active&&distance>110){
        // Retain the skin's allocations (MEEP-012), but release the simulation.
        this.view.ecd.removeComponentFromEntity(b.id,Cloth);b.t.setTranslation(0,-10000,0);b.t.updateMatrix();t64_announce_change(this.view.ecd,b.id);b.active=false;
      }else if(!b.active&&distance<=90){
        b.t.setTranslation(...b.position);b.t.updateMatrix();t64_announce_change(this.view.ecd,b.id);
        this.view.ecd.addComponentToEntity(b.id,b.cloth);b.active=true;
      }
    }
  }
}
