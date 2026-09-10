export const WEAPONS = {
  sword: { name: 'Pilgrim’s Longsword', style: 'melee', damage: 24, reach: 2.35, stamina: 19, cooldown: .72, active: [.18, .43], impulse: 260, icon: 'sword' },
  spear: { name: 'Bellkeeper’s Spear', style: 'melee', damage: 21, reach: 3.2, stamina: 23, cooldown: .85, active: [.24, .46], impulse: 220, icon: 'sword' },
  bow: { name: 'Ashwood Bow', style: 'ranged', damage: 27, speed: 36, stamina: 16, cooldown: .8, impulse: 130, icon: 'bow' },
  staff: { name: 'Cinder Seal', style: 'magic', damage: 32, speed: 19, mana: 12, stamina: 5, cooldown: .65, impulse: 180, icon: 'seal' },
};
export const ORIGINS = [
  { id: 'pilgrim', name: 'The Pilgrim', description: 'A road-worn blade. A borrowed purpose.', stats: { vigor: 12, endurance: 12, might: 12, insight: 8 }, weapon: 'sword' },
  { id: 'wayfarer', name: 'The Wayfarer', description: 'A patient eye. An ashwood bow.', stats: { vigor: 10, endurance: 14, might: 10, insight: 10 }, weapon: 'bow' },
  { id: 'ember', name: 'The Ember Keeper', description: 'A fading vow. A spark that remembers.', stats: { vigor: 9, endurance: 10, might: 9, insight: 16 }, weapon: 'staff' },
];
export const ENEMIES = {
  hollow: { name: 'Roadbound', health: 65, speed: 2.4, damage: 13, reach: 2, reward: 38, weapon: 'sword', color: 'iron' },
  hound: { name: 'Briar Hound', health: 42, speed: 4.1, damage: 10, reach: 1.8, reward: 30, weapon: 'sword', color: 'bark' },
  archer: { name: 'Ash Watcher', health: 54, speed: 2.5, damage: 14, reach: 20, reward: 48, weapon: 'bow', color: 'cloth' },
  mage: { name: 'Candle Wraith', health: 60, speed: 2.2, damage: 18, reach: 16, reward: 60, weapon: 'staff', color: 'magic' },
  sentinel: { name: 'Crown Sentinel', health: 135, speed: 2.3, damage: 25, reach: 3, reward: 95, weapon: 'spear', color: 'brass' },
};
export const BOSSES = {
  warden: { name: 'Aldren, the Hollow Bell', health: 420, damage: 22, reward: 480, scale: 1.9, seal: 'Dawn', landmark: 'abbey', level: 4 },
  rootbound: { name: 'The Rootbound Widow', health: 630, damage: 29, reward: 900, scale: 2.1, seal: 'Root', landmark: 'oak', level: 9 },
  cantor: { name: 'Cantor of the Cinders', health: 900, damage: 36, reward: 1400, scale: 2, seal: 'Ash', landmark: 'aqueduct', level: 15 },
  mirror: { name: 'The Listening Saint', health: 1200, damage: 42, reward: 2100, scale: 2.2, seal: 'Star', landmark: 'spire', level: 21 },
  frostbound: { name: 'Veyr, Keeper of Winter', health: 1550, damage: 49, reward: 3000, scale: 2.3, seal: 'Frost', landmark: 'pilgrims', level: 27 },
  'last-king': { name: 'The King Who Remains', health: 2200, damage: 58, reward: 5000, scale: 2.5, seal: 'Circle', landmark: 'halo', level: 34 },
};
// A first clear funds the next region's lower level range without respawn farming.
export const levelCost = level => Math.floor(120 + 3 * Math.pow(level, 1.6));
export const maxHealth = stats => 70 + stats.vigor * 5;
export const maxStamina = stats => 65 + stats.endurance * 3;
export const maxMana = stats => 30 + stats.insight * 4;
export function canDamage(attacker, victim) {
  if (attacker === victim || victim.hp <= 0) return false;
  if (attacker.kind === 'player' && victim.kind === 'player') return attacker.pvp && victim.pvp;
  return attacker.kind === 'player' || victim.kind === 'player';
}
