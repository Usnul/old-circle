import {WEAPONS,BOSSES} from './catalog.mjs';
import {CHARMS,charmDamage} from './charms.mjs';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';

// Fractions are reductions; regeneration values are resources per second.
// Every set exchanges protection for mobility, quiet movement or focus.
export const ARMOR = {
  mail: {name:'Road-worn Mail', description:'Reliable iron links beneath a pilgrim’s cloak.', physical:.12, magic:.06, poise:.12, speed:1, stamina:22, focus:3, noise:1, appearance:'pilgrim', seal:null},
  wayfarer: {name:'Wayfarer’s Leathers', description:'Soft leather and moss cloth for a quiet, tireless road.', physical:.05, magic:.04, poise:0, speed:1.07, stamina:27, focus:3, noise:.65, appearance:'wayfarer', seal:'Root'},
  keeper: {name:'Bellkeeper’s Vestments', description:'Pale votive cloth gathers the last warmth of a spell.', physical:.03, magic:.24, poise:0, speed:1, stamina:22, focus:4.5, noise:.8, appearance:'keeper', seal:'Dawn'},
  sentinel: {name:'Crown Sentinel Plate', description:'Heavy iron and tarnished brass withstand blows at the cost of haste.', physical:.27, magic:.08, poise:.4, speed:.90, stamina:18, focus:3, noise:1.4, appearance:'sentinel', seal:'Ash'},
  winter: {name:'Winter Pilgrim’s Mantle', description:'Layered pale wool guards against the cold light of the high road.', physical:.14, magic:.22, poise:.18, speed:.97, stamina:21, focus:3.6, noise:1.1, appearance:'winter', seal:'Frost'},
};
export const armorIds=Object.keys(ARMOR);
export const SEALS=Object.values(BOSSES).map(b=>b.seal);
export const hasAllSeals=actor=>SEALS.every(seal=>actor.seals.includes(seal));
export const armorFor=actor=>ARMOR[actor.inventory?.armor]??ARMOR.mail;
export const reinforcement= (actor,weapon=actor.weapon)=>actor.inventory?.reinforcements?.[weapon]??0;
export const reinforcementLimit=actor=>Math.min(6,1+SEALS.filter(s=>actor.seals.includes(s)).length);
export const reinforcementCost=(actor,weapon)=>160+120*reinforcement(actor,weapon);
export function weaponDamage(actor,weapon=actor.weapon){
  const w=WEAPONS[weapon],{might,insight}=actor.stats;
  const scaling=w.style==='melee'?might*.75:w.style==='ranged'?might*.45+insight*.3:insight*.85;
  return (w.damage+scaling)*(1+.18*reinforcement(actor,weapon))*charmDamage(actor,w.style);
}

// Version-one characters had an arbitrary armor label and no item collection.
// Unknown content is removed, while known owned equipment survives reconnect.
export function migrateInventory(saved,weapon='sword',seals=[],relics=[]){
  const armor=Object.hasOwn(ARMOR,saved?.armor)?saved.armor:'mail';
  const weapons=[...new Set(['sword',weapon,...(saved?.weapons??[]).filter(w=>Object.hasOwn(WEAPONS,w))])];
  const armors=[...new Set(['mail',armor,...(Array.isArray(saved?.armors)?saved.armors.filter(id=>Object.hasOwn(ARMOR,id)):[]),...armorIds.filter(id=>seals.includes(ARMOR[id].seal))])];
  const reinforcements=Object.fromEntries(weapons.map(id=>[id,clamp(Math.floor(Number(saved?.reinforcements?.[id])||0),0,6)]));
  const charm=CHARMS[saved?.charm]&&relics.includes(CHARMS[saved.charm].relic)?saved.charm:'none';
  return {weapons,arrows:clamp(Math.floor(Number(saved?.arrows??30)||0),0,9999),armor,armors,reinforcements,charm};
}
