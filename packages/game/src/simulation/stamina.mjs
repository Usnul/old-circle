export const SPRINT_DRAIN=18,SPRINT_RECOVERY=25;

/** Exhaustion latches until the runner releases Shift with enough reserve.
 * Regeneration happens only while walking/resting, after the sprint decision. */
export function updateStamina(actor,dt,{held,moving,regeneration=22}){
  if(actor.sprintExhausted&&!held&&actor.stamina>=Math.min(SPRINT_RECOVERY,actor.staminaMax*.25))actor.sprintExhausted=false;
  const wants=held&&moving&&!actor.crouch&&!actor.mantle;
  if(wants&&actor.stamina<=0)actor.sprintExhausted=true;
  const sprinting=wants&&!actor.sprintExhausted&&actor.stamina>0;
  actor.stamina=Math.max(0,Math.min(actor.staminaMax,actor.stamina+dt*(sprinting?-SPRINT_DRAIN:regeneration)));
  if(sprinting&&actor.stamina===0)actor.sprintExhausted=true;
  return sprinting;
}
