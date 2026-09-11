import {WEAPONS} from '@old-circle/game/content/catalog.mjs';
import {focusCost} from '@old-circle/game/content/charms.mjs';
import {flaskCapacity} from '@old-circle/game/content/relics.mjs';

const roundCost = value => Number(Number.isFinite(value) ? value.toFixed(1) : 0);

function formatWeaponDetail(player, weapon) {
  const stamina = weapon.stamina;
  const magic = weapon.mana ? roundCost(focusCost(player, weapon.mana)) : null;
  const manaText = weapon.mana ? `${magic} focus` : null;
  const arrowText = weapon.style === 'ranged' ? `${player.inventory.arrows} arrows` : null;
  const parts = [`${stamina} stamina`, manaText, arrowText].filter(Boolean);
  return parts.join(' · ');
}

function formatNovaDetail(player) {
  return `${roundCost(focusCost(player, 28))} focus`;
}

function formatHealDetail(player) {
  const cap = flaskCapacity(player);
  return `${player.flasks} / ${cap} flasks`;
}

export function combatStatus(player) {
  const weapon = WEAPONS[player.weapon];
  const dead = player.hp <= 0;
  const onCooldown = player.cooldown > 0;
  const staminaCost = weapon.stamina;
  const focusCostForWeapon = weapon.mana ? focusCost(player, weapon.mana) : 0;
  const novaCost = focusCost(player, 28);

  const fullHealth = player.hp >= player.healthMax;

  const weaponReason = dead
    ? 'Fallen'
    : onCooldown
      ? 'Recovering'
      : player.stamina < staminaCost
        ? `Need ${staminaCost} stamina`
        : focusCostForWeapon > 0 && player.mana < focusCostForWeapon
          ? `Need ${roundCost(focusCostForWeapon)} focus`
          : weapon.style === 'ranged' && player.inventory.arrows < 1
            ? 'No arrows · rest at a hearth'
            : '';

  const novaReason = dead
    ? 'Fallen'
    : onCooldown
      ? 'Recovering'
      : player.mana < novaCost
        ? `Need ${roundCost(novaCost)} focus`
        : '';

  const healReason = dead
    ? 'Fallen'
    : fullHealth
      ? 'Health is full'
      : player.flasks <= 0
        ? 'Rest to refill flasks'
        : '';

  return {
    weapon: {
      ready: weaponReason === '',
      reason: weaponReason,
      detail: formatWeaponDetail(player, weapon),
    },
    nova: {
      ready: novaReason === '',
      reason: novaReason,
      detail: formatNovaDetail(player),
    },
    heal: {
      ready: healReason === '',
      reason: healReason,
      detail: formatHealDetail(player),
    },
  };
}