import {Light} from '@woosh/meep-engine/src/engine/graphics/ecs/light/Light.js';
import {aabb3_unsigned_distance_sqr_to_point} from '@woosh/meep-engine/src/core/geom/3d/aabb/aabb3_unsigned_distance_sqr_to_point.js';
import {v3_distance} from '@woosh/meep-engine/src/core/geom/vec3/v3_distance.js';
import {countTask} from '@woosh/meep-engine/src/core/process/task/util/countTask.js';
import {runSceneryTask} from './scenery-data.mjs';

const plants=new Set(['groundcover','groundcover1','dryGrass','moorGrass','fern','bracken','grass','flowers']);
const trees=new Set(['tree','pine','magicTree','winterTree']);
const distance=(p,b)=>Math.sqrt(aabb3_unsigned_distance_sqr_to_point(...b,...p));
export function sceneryModel(record,focus,manifest){
  const {prop:p,bounds,model}=record,d=distance(focus,bounds);
  if(plants.has(p.model))return d<(model?62:50)?p.model:null;
  if(/^(rock|sandstone|frostRock)/.test(p.model)&&Math.max(...p.scale)<1)return d<(model?135:115)?p.model:null;
  const lod=manifest.lods[p.model];if(!lod)return p.model;
  const range=p.model.startsWith('terrain_')?120:trees.has(p.model)?80:105;
  return d<range+(model===p.model?25:0)?p.model:lod;
}

/** Chooses authored representations. Creation, culling, transforms and geometry
 * residency remain native Meep operations. A ready replacement precedes removal. */
export class WorldStream {
  constructor(view,layout,store,scenery){
    this.view=view;this.store=store;this.layout=layout;this.manifest=store.manifest;this.groundEntities=[];this.error=null;this.retry=new Map();this.loading=new Map();this.focus=[0,0,23];this.clock=0;this.refreshAt=0;
    this.records=scenery.records.map(record=>({...record,model:null,parts:[],opened:false}));this.lights=layout.lights.map(position=>({position}));
  }
  async start(focus,progress=()=>{}){
    this.focus=focus;this.plan();
    const names=[...new Set(this.records.map(r=>r.wanted).filter(Boolean))];let loaded=0;
    await Promise.all(names.map(name=>this.store.load(name,{pin:Object.values(this.manifest.lods).includes(name)}).then(()=>progress(++loaded/names.length))));
    await runSceneryTask(countTask(0,this.records.length,i=>{const r=this.records[i];if(r.wanted)this.replace(r,r.wanted);}));
    this.rebuildGround();return this;
  }
  plan(){
    for(const r of this.records){r.wanted=sceneryModel(r,this.focus,this.manifest);if(r.prop.relic&&r.opened)r.wanted='reliquarySpent';r.distance=distance(this.focus,r.bounds);}
    this.records.sort((a,b)=>(Number(!a.prop.model.startsWith('terrain_'))-Number(!b.prop.model.startsWith('terrain_')))||a.distance-b.distance);
    this.refreshAt=this.clock+.2;
  }
  replace(r,name){
    const parts=name?this.view.sceneryModel(name,r.transform):[];
    if(name)this.store.retain(name);
    this.view.remove(r.parts);if(r.model)this.store.release(r.model);
    r.parts=parts;r.model=name;
  }
  rebuildGround(){this.groundEntities.length=0;for(const r of this.records)if(r.prop.model.startsWith('terrain_'))for(const part of r.parts)this.groundEntities.push(part.id);}
  update(player,dt){
    this.clock+=dt;const focus=[player.x,player.y,player.z],moved=v3_distance(...focus,...this.focus);
    for(const r of this.records)if(r.prop.relic){const opened=(player.relics??[]).includes(r.prop.relic);if(r.opened!==opened){r.opened=opened;this.refreshAt=0;}}
    if(this.clock>=this.refreshAt||moved>15){this.focus=focus;this.plan();}
    const start=performance.now();let changes=0,groundChanged=false;
    for(const r of this.records){
      if(r.model===r.wanted)continue;
      if(r.wanted&&!this.store.models.has(r.wanted)){
        if(!this.loading.has(r.wanted)&&this.clock>=(this.retry.get(r.wanted)??0)){
          const name=r.wanted,promise=this.store.load(name);this.loading.set(name,promise);
          promise.catch(error=>{this.error=error;this.retry.set(name,this.clock+5);}).finally(()=>this.loading.delete(name));
        }continue;
      }
      this.replace(r,r.wanted);groundChanged||=r.prop.model.startsWith('terrain_');
      if(++changes>=16||performance.now()-start>3)break;
    }
    if(groundChanged)this.rebuildGround();this.store.update(dt);
    for(const [i,lamp] of this.lights.entries()){
      const d=v3_distance(...lamp.position,...focus);
      if(!lamp.light&&d<75){lamp.light=this.view.light(lamp.position,[1,.48,.13],42,Light.Type.POINT,i%5===0,8);lamp.emitter=this.view.emitter('embers',lamp.position,22);}
      else if(lamp.light&&d>90){this.view.ecd.removeEntity(lamp.light.id);this.view.ecd.removeEntity(lamp.emitter.id);lamp.light=null;lamp.emitter=null;}
    }
  }
  get stats(){return {...this.store.stats,props:this.records.filter(r=>r.model).length,nearTerrain:this.records.filter(r=>r.prop.model.startsWith('terrain_')&&r.model===r.prop.model).length,totalProps:this.records.length};}
}
