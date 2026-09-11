import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {ModelStore} from './model-store.mjs';
import {WorldStream,propBounds,sceneryModel} from './world-stream.mjs';
import {WorldBanners} from './banners.mjs';
import {buildLayout} from '@old-circle/game/world/layout.mjs';
import {HEARTHS,heightAt} from '@old-circle/game/world/regions.mjs';
import {DUNGEONS,dungeonPoint,dungeonFloors,floorHeight} from '@old-circle/game/world/dungeons.mjs';
import {MeshShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/MeshShape3D.js';
import {Ray3} from '@woosh/meep-engine/src/core/geom/3d/ray/Ray3.js';
import {geometry_build_from_meshlet_geometry} from '@woosh/meep-engine/src/shade/renderer/geometry/geometry_build_from_meshlet_geometry.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {Animation} from '@woosh/meep-engine/src/engine/ecs/animation/Animation.js';

const base=new URL('../../public/assets/geometry/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
const materials=Object.fromEntries(Object.values(manifest.models).flat().map(c=>[c.material,{}]));
const read=async file=>{const bytes=await readFile(new URL(file,base));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);};

test.each(['','_distant'])('arch stones expose outward faces and normals at detail %s',async suffix=>{
  const store=new ModelStore({manifest,materials,read});
  const arches=[{name:'arch',center:[0,4.5,0],inner:1.7,outer:2.42,depth:.48,count:13,gap:.02},...DUNGEONS.map(d=>({
    name:'dungeon_'+d.id,center:[d.origin[0],floorHeight(dungeonFloors(d,heightAt).at(-1),0,-3)+3.9,d.origin[1]+3],inner:2.08,outer:2.6,depth:.35,count:11,gap:0,
  }))];
  for(const arch of arches){
    const counts=new Array(arch.count).fill(0),parts=await store.load(arch.name+suffix);
    for(const part of parts){
      const g=geometry_build_from_meshlet_geometry(part.geometry),p=g.getAttribute('position').data,n=g.getAttribute('normal').data,indices=g.index.data;
      for(let i=0;i<indices.length;i+=3){
        const ids=[indices[i],indices[i+1],indices[i+2]],v=ids.map(id=>arch.center.map((c,k)=>p[id*3+k]-c));
        if(!v.every(([x,y,z])=>y>-.001&&Math.abs(Math.abs(z)-arch.depth)<.001&&[arch.inner,arch.outer].some(r=>Math.abs(Math.hypot(x,y)-r)<.001)))continue;
        const angles=v.map(([x,y])=>Math.atan2(Math.max(0,y),x));
        // Adjacent dungeon wedges share their radial end caps. Check the four
        // exposed surfaces: front, back, the inner soffit and the outer crown.
        if(Math.max(...angles)-Math.min(...angles)<.001)continue;
        const stone=Math.min(arch.count-1,Math.floor(angles.reduce((a,b)=>a+b,0)/3*arch.count/Math.PI));
        const a=stone*Math.PI/arch.count,b=(stone+1)*Math.PI/arch.count-arch.gap,r=(arch.inner+arch.outer)/4;
        const center=[r*(Math.cos(a)+Math.cos(b)),r*(Math.sin(a)+Math.sin(b)),0];
        const u=v[1].map((x,k)=>x-v[0][k]),w=v[2].map((x,k)=>x-v[0][k]);
        const normal=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]],length=Math.hypot(...normal);
        const label=`${arch.name+suffix} stone ${stone} triangle ${i/3}`;
        expect(normal.reduce((sum,x,k)=>sum+x*(v[0][k]-center[k]),0),label+' winding').toBeGreaterThan(.001);
        for(const id of ids)expect(normal.reduce((sum,x,k)=>sum+x*n[id*3+k],0)/length,label+' normal').toBeGreaterThan(.99);
        counts[stone]++;
      }
    }
    expect(counts,arch.name+suffix+' exposed faces').toEqual(new Array(arch.count).fill(8));
  }
});

test('every distant terrain tile meets its full-detail perimeter without cracks',async()=>{
  const store=new ModelStore({manifest,materials,read});
  for(const name of Object.keys(manifest.lods).filter(n=>n.startsWith('terrain_'))){
    const [near,far]=await Promise.all([store.load(name),store.load(manifest.lods[name])]),b=manifest.bounds[name];
    const perimeter=parts=>{
      const points=new Map();
      for(const part of parts){const p=geometry_build_from_meshlet_geometry(part.geometry).getAttribute('position').data;
        for(let i=0;i<p.length;i+=3)if(p[i]===b[0]||p[i]===b[3]||p[i+2]===b[2]||p[i+2]===b[5])points.set(`${p[i]},${p[i+2]}`,p[i+1]);}
      return points;
    };
    expect(perimeter(far)).toEqual(perimeter(near));expect(far[0].geometry.primitive_count).toBeLessThan(near[0].geometry.primitive_count/4);
  }
});

test('distant dungeon geometry preserves the floors and walls visible in the detailed model',async()=>{
  const store=new ModelStore({manifest,materials,read}),ray=new Ray3(),hit=new Float32Array(6);
  const surfaces=parts=>parts.map(part=>{const g=geometry_build_from_meshlet_geometry(part.geometry),s=new MeshShape3D();s.positions=g.getAttribute('position').data;s.indices=g.index.data;return s;});
  const nearest=shapes=>{let distance=Infinity;for(const shape of shapes)if(shape.raycast(hit,ray))distance=Math.min(distance,Math.hypot(hit[0]-ray[0],hit[1]-ray[1],hit[2]-ray[2]));return distance;};
  for(const d of DUNGEONS){
    const name='dungeon_'+d.id,[near,far]=await Promise.all([store.load(name),store.load(manifest.lods[name])]),a=surfaces(near),b=surfaces(far);
    for(const room of d.rooms)for(const u of [.2,.5,.8])for(const v of [.2,.5,.8]){
      const [x0,n0,x1,n1]=room.rect,p=dungeonPoint(d,[x0+(x1-x0)*u,n0+(n1-n0)*v,room.level+(room.rise??0)*v]);
      for(const direction of [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){
        ray.set([p[0],p[1]+.7,p[2],...direction,direction[1]?1:25]);const close=nearest(a);
        if(Number.isFinite(close))expect(Math.abs(nearest(b)-close),`${d.id}/${room.id} ${u},${v} along ${direction}`).toBeLessThan(.15);
      }
    }
  }
});

test('travel selects local detail while preserving the complete terrain and landmark silhouettes',()=>{
  const records=buildLayout().props.map(prop=>({prop,bounds:propBounds(prop,manifest),model:null}));
  for(const hearth of HEARTHS){
    const chosen=records.map(r=>sceneryModel(r,hearth.position,manifest));
    expect(records.filter((r,i)=>r.prop.model.startsWith('terrain_')&&chosen[i])).toHaveLength(48);
    expect(records.filter((r,i)=>r.prop.model.startsWith('terrain_')&&chosen[i]===r.prop.model).length).toBeLessThan(24);
    expect(chosen.filter(Boolean).length).toBeLessThan(records.length*.55);
    expect(records.filter(r=>r.prop.model==='halo').every(r=>sceneryModel(r,hearth.position,manifest))).toBe(true);
  }
  const r=records.find(r=>r.prop.model==='terrain_0_0');r.model=r.prop.model;
  expect(sceneryModel(r,[210,20,40],manifest)).toBe(r.prop.model);
  expect(sceneryModel({...r,model:null},[210,20,40],manifest)).toBe(manifest.lods[r.prop.model]);
});

test('native model loading deduplicates requests, bounds I/O and releases only unreferenced scenery',async()=>{
  let active=0,peak=0,reads=0;const disposed=[];
  const store=new ModelStore({manifest,materials,dispose:g=>disposed.push(g),read:async file=>{reads++;peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,2));const data=await read(file);active--;return data;},concurrency:2});
  const first=store.load('terrain_0_0'),duplicate=store.load('terrain_0_0');expect(first).toBe(duplicate);
  await Promise.all([first,store.load('terrain_1_0'),store.load('sword',{pin:true})]);expect(peak).toBe(2);expect(reads).toBe(2+manifest.models.sword.length);
  store.retain('terrain_0_0');store.update(6);expect(store.models.has('terrain_0_0')).toBe(true);expect(store.models.has('sword')).toBe(true);expect(store.models.has('terrain_1_0')).toBe(false);
  store.release('terrain_0_0');store.update(4);expect(store.models.has('terrain_0_0')).toBe(true);store.update(2);expect(store.models.has('terrain_0_0')).toBe(false);expect(disposed).toHaveLength(2);
  await store.load('terrain_0_0');expect(store.models.has('terrain_0_0')).toBe(true);
});

test('an in-flight replacement never removes the existing surface and stale travel loads are reclaimed',async()=>{
  const prop={model:'terrain_0_0',position:[0,0,0],scale:[1,1,1],yaw:0},store=new ModelStore({manifest,materials,read});let id=0;const live=new Set();
  const view={model:name=>{expect(store.models.has(name)).toBe(true);const part={id:++id};live.add(part);return [part];},remove:parts=>{for(const p of parts)live.delete(p);},ecd:{getComponent:()=>({node:{}})}};
  const stream=new WorldStream(view,{props:[prop],lights:[]},store);await stream.start([0,10,0]);
  stream.update({x:400,y:20,z:400},.1);expect(live.size).toBe(1);expect(stream.records[0].model).toBe(prop.model);
  await Promise.all(stream.loading.values());stream.update({x:400,y:20,z:400},.1);expect(stream.records[0].model).toBe(manifest.lods[prop.model]);expect(live.size).toBe(1);
  for(let i=0;i<60;i++)stream.update({x:400,y:20,z:400},.1);
  expect(store.models.has(prop.model)).toBe(false);expect(stream.groundMeshes).toHaveLength(1);
});

test('repeated travel reuses registered geometry identities with the append-only native BLAS arena',async()=>{
  let reads=0;const store=new ModelStore({manifest,materials,residentCache:true,read:async file=>{reads++;return read(file);},dispose:()=>{throw new Error('Resident identity must not be re-registered');}});
  const first=await store.load('terrain_0_0');
  for(let i=0;i<20;i++){store.retain('terrain_0_0');store.release('terrain_0_0');store.update(6);expect(store.models.size).toBe(0);expect(await store.load('terrain_0_0')).toBe(first);}
  expect(reads).toBe(1);expect(store.stats.cachedBytes).toBe(0);expect(store.cached.size).toBe(0);
});

test('wind-driven banners pause and reuse their native skin when the player travels away',()=>{
  const ecd=new EntityComponentDataset();ecd.setComponentTypeMap([Transform64,SGMesh,Animation]);
  const view={ecd,wind:{sample:out=>out.fill(0)},animations:{playbacks_of:()=>[]}},banners=new WorldBanners(view,[{position:[0,0,0],yaw:0,phase:0}]);
  banners.update(.1,{x:0,y:0,z:0});const first=banners.banners[0].id;expect(ecd.entityExists(first)).toBe(true);
  banners.update(.1,{x:200,y:0,z:0});expect(ecd.getComponent(first,Animation)).toBeUndefined();expect(banners.banners[0].active).toBe(false);
  banners.update(.1,{x:0,y:0,z:0});expect(banners.banners[0].id).toBe(first);expect(ecd.getComponent(first,Animation)).toBeDefined();
});
