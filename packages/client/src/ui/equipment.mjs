import {WEAPONS} from '@old-circle/game/content/catalog.mjs';
import {ARMOR,armorFor,reinforcement,reinforcementLimit,reinforcementCost,weaponDamage} from '@old-circle/game/content/equipment.mjs';

export function equipmentMarkup(player,rest){
  const current=armorFor(player),limit=reinforcementLimit(player);
  return `<div class="panel-top"><div><div class="eyebrow">Equipment & hearth forge</div><h2>What carries you onward</h2></div><button class="close" aria-label="Close">×</button></div>
    <p>${rest.reason??`At ${rest.hearth.name}, armor can be changed and weapons reinforced.`}<br>${player.embers} embers · ${player.inventory.arrows} arrows. Resting supplies at least 30 arrows.</p>
    <h3>Your weapons</h3><p>Reinforcement raises damage by 18% of the base per rank. Your seals allow rank +${limit}, up to +6. Choose between reinforcing equipment and improving attributes.</p>
    <div class="equipment-list">${player.inventory.weapons.map(id=>{
      const weapon=WEAPONS[id],rank=reinforcement(player,id),cost=reinforcementCost(player,id),capped=rank>=limit;
      return `<article class="equipment-row"><img src="/assets/icons/${weapon.icon}.png" alt=""><div><h4>${weapon.name} ${rank?'+'+rank:''}</h4><p>${Math.round(weaponDamage(player,id))} ${weapon.style==='magic'?'magic':'physical'} damage · ${weapon.stamina} stamina${weapon.mana?' · '+weapon.mana+' focus':''}<br>${weapon.style==='ranged'?'Scales with Might and Insight':weapon.style==='magic'?'Scales with Insight':'Scales with Might'}</p><div class="equipment-actions"><button class="subtle" data-equip="${id}" ${player.weapon===id?'disabled':''}>${player.weapon===id?'Equipped':'Equip'}</button><button class="subtle" data-reinforce="${id}" ${rest.reason||capped||player.embers<cost?'disabled':''}>${capped?(rank===6?'Fully reinforced':'More seals needed'):`Reinforce · ${cost} embers`}</button></div></div></article>`;
    }).join('')}</div>
    <h3>Armor</h3><p>Wearing ${current.name}. Protection reduces damage; poise reduces stagger and knockback.</p>
    <div class="equipment-list">${Object.entries(ARMOR).map(([id,armor])=>{
      const owned=player.inventory.armors.includes(id),selected=player.inventory.armor===id;
      return `<article class="armor-row ${selected?'selected':''}"><div><h4>${armor.name}</h4><p>${armor.description}</p><dl><div><dt>Physical</dt><dd>${Math.round(armor.physical*100)}%</dd></div><div><dt>Magic</dt><dd>${Math.round(armor.magic*100)}%</dd></div><div><dt>Poise</dt><dd>${Math.round(armor.poise*100)}%</dd></div><div><dt>Pace</dt><dd>${Math.round(armor.speed*100)}%</dd></div><div><dt>Stamina / s</dt><dd>${armor.stamina}</dd></div><div><dt>Focus / s</dt><dd>${armor.focus}</dd></div><div><dt>Noise</dt><dd>${Math.round(armor.noise*100)}%</dd></div></dl></div><button class="subtle" data-armor="${id}" ${rest.reason||!owned||selected?'disabled':''}>${selected?'Wearing':owned?'Wear':armor.seal+' seal'}</button></article>`;
    }).join('')}</div><button class="subtle" id="back-journal">Back to journal</button>`;
}
