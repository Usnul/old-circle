// Sections describe an above-ground rock vault in world metres: X, Z, clear
// half-width, clear height. Blender samples the shared terrain beneath it.
export const CAVES=[{
  id:'bellkeeper',model:'bellkeeperHollow',
  sections:[[38,-9,3.8,4.7],[39,-14,4.2,5.3],[40,-19,5.2,6.0],[40.5,-24,6.2,6.8],[40,-29,5.4,6.2],[39,-34,4.3,5.2],[38,-40,3.9,4.7]],
  lights:[[36,-13],[43.5,-22],[37.5,-30.8],[40,-36]],
  tombs:[[35.9,-23,.1],[45.0,-25,-.12],[35.7,-28,.12]],
  keeper:[41,-27],
}];

export function inCaveFootprint(x,z,margin=0){
  return CAVES.some(cave=>cave.sections.slice(1).some((b,i)=>{
    const a=cave.sections[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<a[2]+(b[2]-a[2])*t+margin;
  }));
}
