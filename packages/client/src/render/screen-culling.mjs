import {sphere_project} from '@woosh/meep-engine/src/core/geom/3d/sphere/sphere_project.js';
import {actorFeet,actorScale} from '@old-circle/game/simulation/animation.mjs';

// Fractions of viewport area, independent of display resolution. Characters
// remain until only a few pixels tall; cloth stops while the garment is small.
export const CHARACTER_CULL=Object.freeze({exit:.000025,enter:.00004,delay:.5});
export const CLOTH_CULL=Object.freeze({exit:.001,enter:.0015,delay:.25});

/** A modest body bound, excluding weapons and animation reach. */
export function actorScreenSphere(actor){
  const radius=(actor.archetype==='hound'?.75:.95)*actorScale(actor),[x,y,z]=actorFeet(actor);
  return [x,y+radius,z,radius];
}

/** Meep's sphere projection, expressed as a fraction of the viewport. */
export function sphereScreenArea(sphere,camera,{frustum=true}={}){
  if(!camera)return 1;
  const [x,y,z,radius]=sphere,m=camera.view_matrix;
  const depth=-(m[2]*x+m[6]*y+m[10]*z+m[14]);
  if(frustum){
    if(depth+radius<=camera.near)return 0;
    const f=camera.frustum;
    for(let i=0;i<24;i+=4)if(f[i]*x+f[i+1]*y+f[i+2]*z+f[i+3]<-radius)return 0;
  }
  // A sphere crossing the eye plane is near, including the formula's singularity.
  // Size-only consumers also retain nearby objects behind the camera (lights
  // and shadows can still contribute). The projection is symmetric in depth.
  if((frustum?depth:Math.abs(depth))<=radius)return 1;
  const area=sphere_project(sphere,m,1/Math.tan(camera.fov/2))/(4*camera.aspect);
  return Number.isFinite(area)?Math.min(1,Math.max(0,area)):1;
}

/** Separate enter/exit thresholds and continuous dwell prevent edge thrashing. */
export class ScreenCullState {
  active=undefined;
  below=0;
  update(area,dt,policy){
    if(this.active===undefined){this.active=area>=policy.enter;return this.active;}
    if(!this.active){
      if(area>=policy.enter)this.active=true;
      this.below=0;
    }else if(area<policy.exit){
      if(Number.isFinite(dt)&&dt>0)this.below+=Math.min(dt,.1);
      if(this.below>=policy.delay){this.active=false;this.below=0;}
    }else this.below=0;
    return this.active;
  }
}
