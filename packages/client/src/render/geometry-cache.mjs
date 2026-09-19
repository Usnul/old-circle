const COMPLETION_KEY='/assets/geometry/.cache-complete';

/** Cache serialized native geometry before play so a lost server does not leave
 * unseen regions without their detailed assets. Decoding and GPU use stay local. */
export class GeometryCache {
  constructor(manifest,{storage=globalThis.caches,fetcher=globalThis.fetch.bind(globalThis)}={}){
    this.manifest=manifest;this.fetcher=fetcher;this.storage=storage;this.pending=new Map();this.memory=new Map();this.persisted=new Set();this.name='old-circle-geometry-'+manifest.revision;
    this.cache=storage?.open(this.name).catch(()=>null)??Promise.resolve(null);
  }
  read(file){
    if(this.pending.has(file))return this.pending.get(file);
    const pending=this.obtain(file).finally(()=>this.pending.delete(file));this.pending.set(file,pending);return pending;
  }
  async obtain(file){
    const cache=await this.cache,url='/assets/geometry/'+file;
    const cached=await cache?.match(url).catch(()=>null);if(cached){this.persisted.add(file);return cached.arrayBuffer();}
    if(this.memory.has(file))return this.memory.get(file).slice(0);
    const response=await this.fetcher(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Missing asset ${file}`);
    const bytes=await response.arrayBuffer();
    // CacheStorage can be denied or run out of quota. The finite in-memory
    // fallback retains bytes, so offline travel still works for this session.
    let stored=false;if(cache)try{await cache.put(url,new Response(bytes));stored=true;this.persisted.add(file);}catch{}
    if(!stored)this.memory.set(file,bytes);return bytes.slice(0);
  }
  async warm(progress=()=>{}){
    const files=[...new Set(Object.values(this.manifest.models).flat().map(c=>c.file))];let cursor=0,done=0;
    await Promise.all(Array.from({length:4},async()=>{while(cursor<files.length){await this.read(files[cursor++]);progress(++done/files.length);}}));
    await this.prune(files);
  }
  async prune(files){
    // Only a fully persisted warm may replace an offline revision. A successful
    // session-memory fallback is not available after the browser closes.
    const cache=await this.cache;
    if(!cache||!this.storage?.keys||files.some(file=>!this.persisted.has(file)))return;
    try{
      await cache.put(COMPLETION_KEY,new Response(String(Date.now())));
      const older=(await this.storage.keys()).filter(name=>name.startsWith('old-circle-geometry-')&&name!==this.name);
      const completed=[];
      for(const name of older){
        const previous=await this.storage.open(name),marker=await previous.match(COMPLETION_KEY);
        if(marker)completed.push({name,time:Number(await marker.text())});
      }
      completed.sort((a,b)=>a.time-b.time);
      const keep=completed.at(-1)?.name;
      // Older clients did not record completion. Preserve their unknown caches
      // until a later warm has a marked predecessor that is safe to retain.
      if(!keep)return;
      for(const name of older)if(name!==keep)await this.storage.delete(name);
    }catch{}
  }
}
