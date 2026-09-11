import {afterEach, expect, test} from 'vitest';
import {GameWorld} from '@old-circle/game/simulation/world.mjs';
import {focusCost} from '@old-circle/game/content/charms.mjs';
import {flaskCapacity} from '@old-circle/game/content/relics.mjs';
import {combatStatus} from './combat-status.mjs';

const worlds = [];

async function setup() {
  const world = await new GameWorld().start({populate: false});
  worlds.push(world);
  return world;
}

afterEach(async () => {
  for (const world of worlds) await world.stop();
  worlds.length = 0;
});

test('resource failures are weapon-specific and reflect bow arrows, including empty-arrow lockout', async () => {
  const world = await setup();
  const player = world.addPlayer('archer', 'wayfarer');

  player.inventory.arrows = 0;
  player.mana = 999;
  player.stamina = 999;
  const status = combatStatus(player);

  expect(status.weapon.ready).toBe(false);
  expect(status.weapon.reason).toBe('No arrows · rest at a hearth');
  expect(status.weapon.detail).toContain('16 stamina');
  expect(status.weapon.detail).toContain('0 arrows');
  expect(status.nova.ready).toBe(true);
  expect(Number(status.nova.detail.split(' ')[0])).toBe(28);
});

test('stamina and focus threshold checks include exact boundary behavior', async () => {
  const world = await setup();
  const player = world.addPlayer('caster');

  player.weapon = 'sword';
  player.stamina = 18.99;
  const belowStamina = combatStatus(player);
  expect(belowStamina.weapon.ready).toBe(false);
  expect(belowStamina.weapon.reason).toBe('Need 19 stamina');

  player.stamina = 19;
  const exactStamina = combatStatus(player);
  expect(exactStamina.weapon.ready).toBe(true);
  expect(exactStamina.weapon.reason).toBe('');

  player.inventory.charm = 'glass';
  player.relics.push('listening-glass');
  player.weapon = 'staff';

  player.mana = 9.59;
  const belowStaffFocus = combatStatus(player);
  expect(Number(belowStaffFocus.weapon.detail.split(' · ')[1].split(' ')[0])).toBe(9.6);
  expect(belowStaffFocus.weapon.ready).toBe(false);
  expect(belowStaffFocus.weapon.reason).toBe('Need 9.6 focus');

  player.mana = 9.6;
  const readyStaff = combatStatus(player);
  expect(Number(readyStaff.weapon.detail.split(' · ')[1].split(' ')[0])).toBe(9.6);
  expect(readyStaff.weapon.ready).toBe(true);
  expect(readyStaff.weapon.reason).toBe('');

  player.mana = 22.39;
  const belowNova = combatStatus(player);
  expect(Number(belowNova.nova.detail.split(' ')[0])).toBe(22.4);
  expect(belowNova.nova.ready).toBe(false);
  expect(belowNova.nova.reason).toBe('Need 22.4 focus');

  player.mana = focusCost(player, 28);
  const readyNova = combatStatus(player);
  expect(readyNova.nova.ready).toBe(true);
  expect(readyNova.nova.reason).toBe('');
});

test('cooldown blocks weapon and nova together while leaving healing as a separate check', async () => {
  const world = await setup();
  const player = world.addPlayer('vigil');

  player.cooldown = 1.2;
  player.flasks = flaskCapacity(player);
  const status = combatStatus(player);

  expect(status.weapon.ready).toBe(false);
  expect(status.nova.ready).toBe(false);
  expect(status.weapon.reason).toBe('Recovering');
  expect(status.nova.reason).toBe('Recovering');

  player.hp = player.healthMax - 1;
  expect(combatStatus(player).heal.ready).toBe(true);
  expect(combatStatus(player).heal.reason).toBe('');
});

test('healing requires damage taken and flasks, while dead blocks all actions', async () => {
  const world = await setup();
  const player = world.addPlayer('wounded');

  player.hp = player.healthMax - 10;
  player.flasks = 0;
  expect(combatStatus(player).heal.reason).toBe('Rest to refill flasks');
  expect(combatStatus(player).heal.ready).toBe(false);

  player.hp = player.healthMax;
  player.flasks = 2;
  const full = combatStatus(player).heal;
  expect(full.ready).toBe(false);
  expect(full.reason).toBe('Health is full');

  player.hp = 0;
  player.flasks = 2;
  const dead = combatStatus(player).heal;
  expect(dead.ready).toBe(false);
  expect(dead.reason).toBe('Fallen');
});

test('combat status helper never mutates player snapshot', async () => {
  const world = await setup();
  const player = world.addPlayer('steady');

  const before = structuredClone(player);
  combatStatus(player);
  expect(player).toEqual(before);
});