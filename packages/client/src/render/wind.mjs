import Entity from '@woosh/meep-engine/src/engine/ecs/Entity.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {FluidSystem} from '@woosh/meep-engine/src/engine/physics/fluid/ecs/FluidSystem.js';
import {FluidComponent} from '@woosh/meep-engine/src/engine/physics/fluid/ecs/FluidComponent.js';
import {FluidEffectorsComponent} from '@woosh/meep-engine/src/engine/physics/fluid/ecs/FluidEffectorsComponent.js';
import {fluid_reanchor_field} from '@woosh/meep-engine/src/engine/physics/fluid/ecs/fluid_reanchor_field.js';
import {heightAt} from '@old-circle/game/world/regions.mjs';
import {GlobalFluidEffector} from '@woosh/meep-engine/src/engine/physics/fluid/effector/GlobalFluidEffector.js';

/** Local presentation wind. Native MAC advection and pressure projection bend
 * flow around terrain; this field never changes authoritative combat motion. */
export class WorldWind extends FluidSystem {
  constructor(){
    super();this.pending=0;this.time=0;this.stepMs=0;this.maskOrigin=[];
    this.fluid=new FluidComponent();this.fluid.cell_size=3;this.fluid.offset=[0,4,0];
    this.fluid.field.setResolution(18,8,18);this.fluid.field.build();this.fluid.enabled=false;
    this.transform=new Transform64();this.source=new GlobalFluidEffector();this.source.drag=.8;
    this.effectors=new FluidEffectorsComponent();this.effectors.addEffector(this.source);
  }
  attach(ecd){new Entity().add(this.fluid).add(this.transform).build(ecd);new Entity().add(this.effectors).build(ecd);}
  follow(x,y,z){this.transform.setTranslation(x,y,z);this.fluid.enabled=true;}
  fixedUpdate(dt){
    if(!this.fluid.enabled)return;
    this.pending+=dt;if(this.pending<.05-1e-8)return;this.pending-=.05;this.time+=.05;
    const start=performance.now(),c=this.fluid;
    fluid_reanchor_field(c,this.transform);
    if(c.origin.some((v,i)=>v!==this.maskOrigin[i])){
      const [rx,ry,rz]=c.field.getResolution(),cs=c.cell_size,[ox,oy,oz]=c.origin;
      for(let z=0;z<rz;z++)for(let x=0;x<rx;x++){
        const h=heightAt(ox+x*cs,oz+z*cs);
        for(let y=0;y<ry;y++)c.field.solid[(z*ry+y)*rx+x]=oy+y*cs<h?1:0;
      }
      c.field.recomputeSolidNeighbourMask();this.maskOrigin=[...c.origin];
    }
    const gust=1.35+.5*Math.sin(this.time*.21)+.25*Math.sin(this.time*.73);
    this.source.wind=[gust,0,.4+.35*Math.sin(this.time*.13)];
    super.fixedUpdate(.05);this.stepMs+=(performance.now()-start-this.stepMs)*.05;
  }
  sample(out,x,y,z){
    const c=this.fluid,res=c.field.getResolution(),p=[x,y,z];
    // Distant cloth still follows the native prevailing effector. Only nearby
    // consumers receive the detailed terrain flow within this bounded field.
    if(p.some((v,i)=>v<c.origin[i]+c.cell_size||v>c.origin[i]+(res[i]-2)*c.cell_size)){
      for(let i=0;i<3;i++)out[i]=this.source.wind[i];return out;
    }
    this.fluid.sampleVelocityAtWorld(out,x,y,z);
    for(let i=0;i<3;i++)out[i]*=this.fluid.cell_size;
    return out;
  }
}
