import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {decodeNavigation} from './navigation-data.mjs';
import {decodeDungeonNavigation} from './dungeon-navigation.mjs';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {DUNGEONS} from './dungeons.mjs';
import {WORLD_VERSION} from './regions.mjs';

async function asset(name) {
  const data = await readFile(new URL(`../content/${name}.bin`, import.meta.url));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

test('authored outdoor navigation contains finite vertices and complete indexed triangles', async () => {
  const bytes = await asset('navigation');
  const buffer = new BinaryBuffer();
  buffer.fromArrayBuffer(bytes);
  expect(buffer.readUint32()).toBe(1);
  expect(buffer.readUint32()).toBe(WORLD_VERSION);
  expect(buffer.readFloat32()).toBeGreaterThan(0);
  const positions = new Float32Array(buffer.readUint32());
  const indices = new Uint32Array(buffer.readUint32());
  buffer.readFloat32Array(positions, 0, positions.length);
  buffer.readUint32Array(indices, 0, indices.length);
  expect(positions.length % 3).toBe(0);
  expect(indices.length % 3).toBe(0);
  expect(positions.every(Number.isFinite)).toBe(true);
  expect(indices.every(index => index < positions.length / 3)).toBe(true);
  expect(buffer.position).toBe(bytes.byteLength);
  expect(decodeNavigation(bytes).faceCount).toBe(indices.length / 3);
});

test('authored dungeon navigation contains each dungeon and valid indexed geometry', async () => {
  const atlases = decodeDungeonNavigation(await asset('dungeon-navigation'));
  expect([...atlases.keys()]).toEqual(DUNGEONS.map(dungeon => dungeon.id));
  for (const atlas of atlases.values()) {
    const {positions, indices} = atlas.geometry;
    expect(positions.length % 3).toBe(0);
    expect(indices.length % 3).toBe(0);
    expect(positions.every(Number.isFinite)).toBe(true);
    expect(indices.every(index => index < positions.length / 3)).toBe(true);
    expect(atlas.faceCount).toBeGreaterThan(0);
    expect(atlas.nav.topology.faces.count()).toBe(indices.length / 3);
  }
});

test.each([
  ['navigation', decodeNavigation],
  ['dungeon-navigation', decodeDungeonNavigation]
])('%s retains its format and world compatibility checks', async (name, decode) => {
  const bytes = await asset(name);
  for (const offset of [0, 4]) {
    const incompatible = bytes.slice(0);
    const buffer = new BinaryBuffer();
    buffer.fromArrayBuffer(incompatible);
    buffer.position = offset;
    buffer.writeUint32(0);
    expect(() => decode(incompatible)).toThrow('rebuilding');
  }
});

test('navigation rejects invalid runtime cache budgets', async () => {
  const bytes = await asset('navigation');
  for (const maxTiles of [0, -1, 1.5, NaN]) {
    expect(() => decodeNavigation(bytes, {maxTiles})).toThrow('Invalid navigation cache budget');
  }
});

test('the native navigation tile cache stays bounded while evicted routes can be rebuilt',async()=>{
  const data=await readFile(new URL('../content/navigation.bin',import.meta.url)),navigation=decodeNavigation(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),{maxTiles:4});
  const first=navigation.tile([0,0,20]),faces=first.faceCount;
  expect(navigation.tile([0,0,20])).toBe(first);
  for(let z=-400;z<0;z+=40)navigation.tile([0,0,z]);
  expect(navigation.cacheStats().tiles).toBe(4);
  const rebuilt=navigation.tile([0,0,20]);expect(rebuilt).not.toBe(first);expect(rebuilt.faceCount).toBe(faces);expect(first.nav.topology.faces.count()).toBe(rebuilt.nav.topology.faces.count());
});

test('navigation retains recently read tiles when its LRU cache reaches capacity',async()=>{
  const data=await readFile(new URL('../content/navigation.bin',import.meta.url)),navigation=decodeNavigation(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),{maxTiles:2});
  const first=navigation.tile([0,0,20]),second=navigation.tile([0,0,-40]);
  expect(navigation.tile([0,0,20])).toBe(first);
  navigation.tile([0,0,-80]);
  expect(navigation.cacheStats().tiles).toBe(2);
  expect(navigation.tile([0,0,20])).toBe(first);
  expect(navigation.tile([0,0,-40])).not.toBe(second);
});
