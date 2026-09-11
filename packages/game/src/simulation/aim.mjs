// Keep the ranged camera and simulation's sight ray on the same shoulder.
export function rangedSightOrigin(actor,yaw=actor.yaw){
  return [actor.x+Math.cos(yaw)*.8,actor.y+.7,actor.z-Math.sin(yaw)*.8];
}
