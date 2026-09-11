/** Cache serialized native geometry before play so a lost server does not leave
 * unseen regions without their detailed assets. Decoding and GPU use stay local. */
export class GeometryCache {
  constructor(manifest,{storage=globalThis.caches,fetcher=globalThis.fetch.bind(globalThis)}={}){
    this.manifest=manifest;this.fetcher=fetcher;this.storage=storage;this.pending=new Map();this.memory=new Map();this.name='old-circle-geometry-'+manifest.revision;
    this.cache=storage?.open(this.name).catch(()=>null)??Promise.resolve(null);
  }
  read(file){
    if(this.pending.has(file))return this.pending.get(file);
    const pending=this.obtain(file).finally(()=>this.pending.delete(file));this.pending.set(file,pending);return pending;
  }
  async obtain(file){
    const cache=await this.cache,url='/assets/geometry/'+file;
    const cached=await cache?.match(url).catch(()=>null);if(cached)return cached.arrayBuffer();
    if(this.memory.has(file))return this.memory.get(file).slice(0);
    const response=await this.fetcher(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Missing asset ${file}`);
    const bytes=await response.arrayBuffer();
    // CacheStorage can be denied or run out of quota. The finite in-memory
    // fallback retains bytes, so offline travel still works for this session.
    let stored=false;if(cache)try{await cache.put(url,new Response(bytes));stored=true;}catch{}
    if(!stored)this.memory.set(file,bytes);return bytes.slice(0);
  }
  async warm(progress=()=>{}){
    const files=[...new Set(Object.values(this.manifest.models).flat().map(c=>c.file))];let cursor=0,done=0;
    await Promise.all(Array.from({length:4},async()=>{while(cursor<files.length){await this.read(files[cursor++]);progress(++done/files.length);}}));
    // Keep the current and previous complete revision, only within this game's
    // cache namespace. A failed warm never discards a previous offline copy.
    if(this.storage?.keys)try{const older=(await this.storage.keys()).filter(k=>k.startsWith('old-circle-geometry-')&&k!==this.name);for(const name of older.slice(0,-1))await this.storage.delete(name);}catch{}
  }
}
