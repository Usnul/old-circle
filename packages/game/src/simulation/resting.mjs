import {HEARTHS,heightAt} from '../world/regions.mjs';

export function restStatus(actor,actors){
  if(!actor||actor.kind!=='player'||actor.hp<=0)return {hearth:null,reason:'You cannot rest now.'};
  const hearth=HEARTHS.find(h=>Math.hypot(actor.x-h.position[0],actor.z-h.position[2])<=4&&Math.abs(actor.y-heightAt(h.position[0],h.position[2])-1)<2);
  if(!hearth)return {hearth:null,reason:'Return to a hearth to rest and improve your attributes.'};
  if(actor.hurtTime>0||actor.attackAge>=0||actor.mantle)return {hearth,reason:'Finish your action before resting.'};
  if(actors.some(e=>e.kind==='enemy'&&e.hp>0&&Math.hypot(e.x-actor.x,e.y-actor.y,e.z-actor.z)<14))return {hearth,reason:'Enemies are too close to rest.'};
  return {hearth,reason:null};
}

export function hearthArrival(hearth){
  const [x,z]=hearth.arrival;return [x,heightAt(x,z)+1,z];
}
