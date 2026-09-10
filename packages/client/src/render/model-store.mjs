import {MeshletGeometry} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometry.js';
import {MeshletGeometrySerializationAdapter} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometrySerializationAdapter.js';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';

/** Bounded I/O and ownership for native Meep geometry. Only scenery with no live
 * ECS users may leave; character rigs and persistent distant silhouettes are pinned. */
export class ModelStore {
  constructor({manifest,materials,models=new Map(),read,dispose=()=>{},concurrency=4,idleSeconds=5,residentCache=false}){
    Object.assign(this,{manifest,materials,models,dispose,concurrency,idleSeconds,residentCache});this.cached=new Map();
    this.read=read??(async file=>{const r=await fetch('/assets/geometry/'+file);if(!r.ok)throw new Error(`Missing asset ${file}`);return r.arrayBuffer();});
    this.records=new Map();this.pending=new Map();this.queue=[];this.active=0;this.time=0;this.loadedBytes=0;
  }
  load(name,{pin=false}={}){
    let record=this.records.get(name);
    if(!record){if(!this.manifest.models[name])return Promise.reject(new Error(`Unknown Blender asset: ${name}`));record={refs:0,pinned:pin,lastUsed:this.time,bytes:0};this.records.set(name,record);}
    record.pinned||=pin;record.lastUsed=this.time;
    if(this.cached.has(name)){const parts=this.cached.get(name);this.cached.delete(name);this.models.set(name,parts);record.bytes=parts.reduce((n,c)=>n+c.bytes,0);this.loadedBytes+=record.bytes;}
    if(this.models.has(name))return Promise.resolve(this.models.get(name));
    if(this.pending.has(name))return this.pending.get(name);
    const promise=new Promise((resolve,reject)=>{this.queue.push({name,record,resolve,reject});});this.pending.set(name,promise);this.pump();return promise;
  }
  pump(){
    while(this.active<this.concurrency&&this.queue.length){
      const job=this.queue.shift();this.active++;
      const finish=()=>{this.active--;this.pending.delete(job.name);this.pump();};
      this.decode(job.name).then(parts=>{
        this.models.set(job.name,parts);job.record.bytes=parts.reduce((n,c)=>n+c.bytes,0);job.record.lastUsed=this.time;this.loadedBytes+=job.record.bytes;finish();job.resolve(parts);
      },error=>{finish();job.reject(error);});
    }
  }
  async decode(name){
    const parts=[];
    // A model is one queue job; its material chunks never multiply the I/O cap.
    for(const chunk of this.manifest.models[name]){
      const bytes=await this.read(chunk.file),buffer=new BinaryBuffer(),geometry=new MeshletGeometry();buffer.fromArrayBuffer(bytes);
      new MeshletGeometrySerializationAdapter().deserialize(buffer,geometry);
      const material=this.materials[chunk.material];if(!material)throw new Error(`Unknown material ${chunk.material}`);
      parts.push({geometry,material,bytes:bytes.byteLength});
    }return parts;
  }
  retain(name){const r=this.records.get(name);if(!r||!this.models.has(name))throw new Error(`Unloaded model ${name}`);r.refs++;r.lastUsed=this.time;}
  release(name){const r=this.records.get(name);if(!r||r.refs<1)throw new Error(`Unbalanced scenery release ${name}`);r.refs--;r.lastUsed=this.time;}
  update(dt){
    this.time+=dt;
    for(const [name,r] of this.records)if(!r.pinned&&!r.refs&&!this.pending.has(name)&&this.time-r.lastUsed>this.idleSeconds){
      const parts=this.models.get(name);
      // Meep 3.20's BLAS arena is append-only, including after remove(). Keep one
      // registered identity per visited model to bound repeat travel (MEEP-012).
      if(this.residentCache&&parts)this.cached.set(name,parts);
      else for(const part of parts??[])this.dispose(part.geometry);
      this.models.delete(name);this.records.delete(name);this.loadedBytes-=r.bytes;
    }
  }
  get stats(){return {models:this.models.size,bytes:this.loadedBytes,cachedBytes:[...this.cached.values()].flat().reduce((n,c)=>n+c.bytes,0),loading:this.pending.size,requests:this.active};}
}
