import {expect,test} from 'vitest';
import {GeometryCache} from './geometry-cache.mjs';

const manifest={revision:'example',models:{a:[{file:'a.meep'}],b:[{file:'b.meep'}]}};
test('warming serialized geometry preserves unseen detail after loss of the server',async()=>{
  let online=true,calls=0;const disk=new Map(),storage={open:async()=>({match:async k=>disk.get(k)?.clone(),put:async(k,r)=>disk.set(k,r)})};
  const fetcher=async url=>{calls++;if(!online)throw new Error('Offline');return new Response(new Uint8Array([url.includes('a.meep')?1:2]));};
  const cache=new GeometryCache(manifest,{storage,fetcher});await cache.warm();online=false;
  const reopened=new GeometryCache(manifest,{storage,fetcher});expect([...new Uint8Array(await reopened.read('b.meep'))]).toEqual([2]);expect(calls).toBe(2);
});
test('denied browser storage retains a bounded session fallback and deduplicates concurrent reads',async()=>{
  let calls=0;const cache=new GeometryCache(manifest,{storage:{open:async()=>{throw new Error('Denied');}},fetcher:async()=>{calls++;return new Response(new Uint8Array([42]));}});
  await Promise.all([cache.read('a.meep'),cache.read('a.meep')]);await cache.warm();expect(calls).toBe(2);expect(cache.memory.size).toBe(2);
  const bytes=await cache.read('a.meep');new Uint8Array(bytes)[0]=0;expect(new Uint8Array(await cache.read('a.meep'))[0]).toBe(42);
});

test('geometry revisions never reuse stale bytes and successful warming retains the previous revision',async()=>{
  const namespaces=new Map(),storage={keys:async()=>[...namespaces.keys()],delete:async name=>namespaces.delete(name),open:async name=>{if(!namespaces.has(name))namespaces.set(name,new Map());const disk=namespaces.get(name);return {match:async key=>disk.get(key)?.clone(),put:async(key,r)=>disk.set(key,r)};}};
  for(const revision of ['one','two','three']){
    const cache=new GeometryCache({...manifest,revision},{storage,fetcher:async()=>new Response(revision)});await cache.warm();expect(new TextDecoder().decode(await cache.read('a.meep'))).toBe(revision);
  }
  expect([...namespaces.keys()]).toEqual(['old-circle-geometry-two','old-circle-geometry-three']);
  const failed=new GeometryCache({...manifest,revision:'failed'},{storage,fetcher:async()=>{throw new Error('Interrupted');}});await expect(failed.warm()).rejects.toThrow('Interrupted');expect(namespaces.has('old-circle-geometry-three')).toBe(true);
});
