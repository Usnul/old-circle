// Keep the ranged camera and simulation's sight ray on the same shoulder.
export function rangedSightOrigin(actor,yaw=actor.yaw){
  return [actor.x+Math.cos(yaw)*.8,actor.y+.7,actor.z-Math.sin(yaw)*.8];
}

/** Low ballistic arc at fixed launch speed; unreachable shots retain direct aim. */
export function rangedVelocity(origin,target,speed,gravity=0){
  const delta=target.map((v,i)=>v-origin[i]),distance=Math.hypot(...delta);
  if(distance<1e-6)return [0,0,-speed];
  if(gravity>0){
    const speed2=speed*speed,term=speed2-gravity*delta[1];
    const discriminant=term*term-gravity*gravity*distance*distance;
    if(discriminant>=0){
      // Rationalized small root also handles targets directly above/below.
      const time=Math.sqrt(2*distance*distance/(term+Math.sqrt(discriminant)));
      if(Number.isFinite(time)&&time>0)return [delta[0]/time,delta[1]/time+gravity*time/2,delta[2]/time];
    }
  }
  return delta.map(v=>v/distance*speed);
}
