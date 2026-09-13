// Stable clip IDs travel with an attack through prediction and snapshots.
export const MELEE_ATTACKS={
  sword:['sword','sword_reverse','sword_low','sword_high'],
  spear:['spear','spear_sweep','spear_low','spear_high'],
};
export const meleeClip=a=>a.archetype!=='hound'&&MELEE_ATTACKS[a.weapon]?.includes(a.attackVariant)?a.attackVariant:a.weapon;
