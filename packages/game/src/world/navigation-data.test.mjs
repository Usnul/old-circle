import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {decodeNavigation} from './navigation-data.mjs';

test('the native navigation tile cache stays bounded while evicted routes can be rebuilt',async()=>{
  const data=await readFile(new URL('../content/navigation.bin',import.meta.url)),navigation=decodeNavigation(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),{maxTiles:4});
  const first=navigation.tile([0,0,20]),faces=first.faceCount;
  expect(navigation.tile([0,0,20])).toBe(first);
  for(let z=-400;z<0;z+=40)navigation.tile([0,0,z]);
  expect(navigation.cacheStats().tiles).toBe(4);
  const rebuilt=navigation.tile([0,0,20]);expect(rebuilt).not.toBe(first);expect(rebuilt.faceCount).toBe(faces);expect(first.nav.topology.face_count).toBe(rebuilt.nav.topology.face_count);
});
