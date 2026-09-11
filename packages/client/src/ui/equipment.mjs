import {WEAPONS} from '@old-circle/game/content/catalog.mjs';
import {ARMOR,armorFor,reinforcement,reinforcementLimit,reinforcementCost,weaponDamage} from '@old-circle/game/content/equipment.mjs';
import {CHARMS,ownsCharm,focusCost} from '@old-circle/game/content/charms.mjs';

export function equipmentMarkup(player,rest){
  const current=armorFor(player),limit=reinforcementLimit(player);
  return `<div class="panel-top"><h2>Equipment & forge</h2><button class="close" aria-label="Close">×</button></div>
    <p>${rest.reason??`At ${rest.hearth.name}, armor and charms can be changed and weapons reinforced.`}<br>${player.embers} embers · ${player.inventory.arrows} arrows. Resting supplies at least 30 arrows.</p>
    <div class="equipment-sections"><section><h3>Weapons</h3><p>Reinforcement: +18% base damage per rank. Current limit: +${limit} of +6.</p>
    <div class="equipment-list">${player.inventory.weapons.map(id=>{
      const weapon=WEAPONS[id],rank=reinforcement(player,id),cost=reinforcementCost(player,id),capped=rank>=limit;
      return `<article class="equipment-row" id="equipment-weapon-${id}" tabindex="-1" aria-labelledby="weapon-title-${id}"><img src="/assets/icons/${weapon.icon}.png" alt=""><div><h4 id="weapon-title-${id}">${weapon.name} ${rank?'+'+rank:''}</h4><p>${Math.round(weaponDamage(player,id))} ${weapon.style==='magic'?'magic':'physical'} damage · ${weapon.stamina} stamina${weapon.mana?' · '+Number(focusCost(player,weapon.mana).toFixed(1))+' focus':''}<br>${weapon.style==='ranged'?'Scales with Might and Insight':weapon.style==='magic'?'Scales with Insight':'Scales with Might'}</p><div class="equipment-actions"><button class="subtle" data-equip="${id}" aria-label="Equip ${weapon.name}" aria-pressed="${player.weapon===id}" ${player.weapon===id?'disabled':''}>${player.weapon===id?'Equipped':'Equip'}</button><button class="subtle" data-reinforce="${id}" aria-label="Reinforce ${weapon.name}${capped?rank===6?' · Fully reinforced':' · More seals needed':' · '+cost+' embers'}" ${rest.reason||capped||player.embers<cost?'disabled':''}>${capped?(rank===6?'Fully reinforced':'More seals needed'):`Reinforce · ${cost} embers`}</button></div></div></article>`;
    }).join('')}</div>
    </section><section><h3>Armor</h3><p>Wearing ${current.name}. Protection reduces damage; poise reduces stagger and knockback.</p>
    <div class="equipment-list">${Object.entries(ARMOR).map(([id,armor])=>{
      const owned=player.inventory.armors.includes(id),selected=player.inventory.armor===id;
      return `<article class="armor-row ${selected?'selected':''}" id="equipment-armor-${id}" tabindex="-1" aria-labelledby="armor-title-${id}"><div><h4 id="armor-title-${id}">${armor.name}</h4><dl><div><dt>Physical</dt><dd>${Math.round(armor.physical*100)}%</dd></div><div><dt>Magic</dt><dd>${Math.round(armor.magic*100)}%</dd></div><div><dt>Poise</dt><dd>${Math.round(armor.poise*100)}%</dd></div><div><dt>Pace</dt><dd>${Math.round(armor.speed*100)}%</dd></div><div><dt>Stamina / s</dt><dd>${armor.stamina}</dd></div><div><dt>Focus / s</dt><dd>${armor.focus}</dd></div><div><dt>Noise</dt><dd>${Math.round(armor.noise*100)}%</dd></div></dl></div><button class="subtle" data-armor="${id}" aria-label="${selected?'Wearing':'Wear'} ${armor.name}" aria-pressed="${selected}" ${rest.reason||!owned||selected?'disabled':''}>${selected?'Wearing':owned?'Wear':armor.seal+' seal'}</button></article>`;
    }).join('')}</div>
    </section><section><h3>Charms</h3><p>Equip one charm at a safe hearth. Weapon stats include its effects.</p>
    <div class="equipment-list">${Object.entries(CHARMS).map(([id,charm])=>{
      const owned=ownsCharm(player,id),selected=(player.inventory.charm??'none')===id;
      return `<article class="armor-row charm-row ${selected?'selected':''}" id="equipment-charm-${id}" tabindex="-1" aria-labelledby="charm-title-${id}"><div class="charm-description">${id!=='none'?`<img src="/assets/icons/charm-${id}.png" alt="" loading="lazy">`:''}<div><h4 id="charm-title-${id}">${charm.name}</h4><p>${id==='none'?'No bonuses or penalties.':charm.description}${!owned?'<br>Found in '+charm.dungeon+'.':''}</p></div></div><button class="subtle" data-charm="${id}" aria-label="${selected?'Wearing':'Wear'} ${charm.name}" aria-pressed="${selected}" ${rest.reason||!owned||selected?'disabled':''}>${selected?'Wearing':owned?(id==='none'?'Remove charm':'Wear'):'Not found'}</button></article>`;
    }).join('')}</div></section></div><button class="subtle" id="back-journal">Back to journal</button>`;
}
