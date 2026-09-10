// One charm may be worn at a safe hearth. Ownership derives from personal
// exploration relics, so returning characters never import world treasure state.
export const CHARMS={
  none:{name:'No charm',description:'Travel without a charm’s blessing or burden.'},
  briar:{name:'Briar Knot',relic:'briar-knot',dungeon:'The Rootbound Cloister',description:'Recover stamina 22% faster. Take 8% more damage.',stamina:1.22,received:1.08},
  ash:{name:'Ashen Lens',relic:'ashen-lens',dungeon:'The Ashen Cistern',description:'Arrows deal 20% more damage. Melee attacks deal 10% less.',ranged:1.2,melee:.9},
  glass:{name:'Listening Glass',relic:'listening-glass',dungeon:'The Listening Observatory',description:'Spells cost 20% less focus and deal 10% more damage. Take 15% more damage.',cost:.8,magic:1.1,received:1.15},
  frost:{name:'Frozen Heart',relic:'frozen-heart',dungeon:'The White Ossuary',description:'Take 15% less damage. Move 10% slower and recover focus 20% slower.',received:.85,speed:.9,focus:.8},
  crown:{name:'King’s Brand',relic:'kings-brand',dungeon:'The Uncrowned Archive',description:'Deal 18% more damage and take 18% more damage.',damage:1.18,received:1.18},
};
export const charmIds=Object.keys(CHARMS);
export const ownsCharm=(actor,id)=>id==='none'||Object.hasOwn(CHARMS,id)&&(actor.relics??[]).includes(CHARMS[id].relic);
export const charmFor=actor=>actor?.kind==='player'&&ownsCharm(actor,actor.inventory?.charm)?CHARMS[actor.inventory.charm]:CHARMS.none;
export const focusCost=(actor,base)=>Math.round(base*(charmFor(actor).cost??1)*100)/100;
export const charmDamage=(actor,style)=>(charmFor(actor).damage??1)*(charmFor(actor)[style]??1);
