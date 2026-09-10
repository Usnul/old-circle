// World coordinates are metres, Y-up. North is -Z. One continuous landscape.
export const WORLD_VERSION = 1;
export const SPAWN = [0, 0, 24];
export const REGIONS = [
  { id: 'meadow', name: 'The Waking Fields', level: [1, 5], center: [0, 15], radius: 95, color: '#8eaa76', enemies: ['hollow', 'hound'], landmark: 'The Bell Without a Tongue', purpose: 'Learn the old road. Light the abbey hearth.', boss: 'warden' },
  { id: 'wood', name: 'Mourningwood', level: [5, 10], center: [-125, -55], radius: 100, color: '#365d50', enemies: ['hollow', 'hound', 'archer'], landmark: 'The Widow Oak', purpose: 'Recover the root seal beneath the Widow Oak.', boss: 'rootbound' },
  { id: 'desert', name: 'The Cinder March', level: [10, 16], center: [135, -105], radius: 100, color: '#bd895b', enemies: ['hollow', 'archer', 'mage'], landmark: 'The Severed Aqueduct', purpose: 'Cross the salt road and recover the ash seal.', boss: 'cantor' },
  { id: 'magic', name: 'The Glasswood', level: [16, 22], center: [-115, -225], radius: 100, color: '#839cba', enemies: ['hound', 'mage', 'archer'], landmark: 'The Listening Spire', purpose: 'Follow the blue lanterns to the star seal.', boss: 'mirror' },
  { id: 'tundra', name: 'Pale Reach', level: [22, 28], center: [95, -265], radius: 110, color: '#c5d1d6', enemies: ['hollow', 'mage', 'sentinel'], landmark: 'The Frozen Pilgrims', purpose: 'Climb the ice road into the crown mountains.', boss: 'frostbound' },
  { id: 'crown', name: 'The Last Crown', level: [28, 35], center: [0, -370], radius: 85, color: '#afa796', enemies: ['sentinel', 'mage'], landmark: 'The Broken Halo', purpose: 'Return the seals. End the circling of the sun.', boss: 'last-king' },
];
export const LANDMARKS = [
  { id: 'hearth', name: 'Pilgrim’s Hearth', position: [0, 0, 20], region: 'meadow', kind: 'hearth' },
  { id: 'abbey', name: 'Abbey of the First Light', position: [0, 0, -48], region: 'meadow', kind: 'boss' },
  { id: 'cave', name: 'The Bellkeeper’s Hollow', position: [38, 0, -15], region: 'meadow', kind: 'cave' },
  { id: 'oak', name: 'The Widow Oak', position: [-125, 0, -47], region: 'wood', kind: 'boss' },
  { id: 'aqueduct', name: 'The Severed Aqueduct', position: [135, 0, -105], region: 'desert', kind: 'boss' },
  { id: 'spire', name: 'The Listening Spire', position: [-115, 0, -225], region: 'magic', kind: 'boss' },
  { id: 'pilgrims', name: 'The Frozen Pilgrims', position: [95, 0, -265], region: 'tundra', kind: 'boss' },
  { id: 'halo', name: 'The Broken Halo', position: [0, 0, -361], region: 'crown', kind: 'boss' },
];
export const ROUTES = [
  ['hearth', 'abbey'], ['hearth', 'cave'], ['cave', 'abbey'], ['abbey', 'oak'],
  ['abbey', 'aqueduct'], ['oak', 'spire'], ['aqueduct', 'pilgrims'],
  ['spire', 'pilgrims'], ['spire', 'halo'], ['pilgrims', 'halo'],
];
export function heightAt(x, z) {
  const rise = Math.max(0, -z - 110) * .16;
  return rise + Math.sin(x * .026) * 2.4 + Math.sin(z * .036) * 1.8 + Math.sin(x * .061 + z * .027) * .8;
}
export function regionAt(x, z) {
  return REGIONS.reduce((a, b) => Math.hypot(x - a.center[0], z - a.center[1]) < Math.hypot(x - b.center[0], z - b.center[1]) ? a : b);
}
export function landmarkPosition(id) {
  const p = LANDMARKS.find(l => l.id === id)?.position;
  if (!p) throw new Error(`Unknown landmark: ${id}`);
  return [p[0], heightAt(p[0], p[2]), p[2]];
}
export function pathDistance(x, z) {
  let best = Infinity;
  for (const [a, b] of ROUTES) {
    const p = landmarkPosition(a), q = landmarkPosition(b);
    const dx = q[0] - p[0], dz = q[2] - p[2];
    const t = Math.max(0, Math.min(1, ((x-p[0])*dx+(z-p[2])*dz)/(dx*dx+dz*dz)));
    best = Math.min(best, Math.hypot(x-p[0]-dx*t, z-p[2]-dz*t));
  }
  return best;
}
