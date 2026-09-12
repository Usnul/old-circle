import {expect,test,vi} from 'vitest';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {TransformAttachmentSystem} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachmentSystem.js';
import {MeshSystem} from '@woosh/meep-engine/src/engine/graphics3/MeshSystem.js';
import {Scene} from '@woosh/meep-engine/src/shade/renderer/scene/Scene.js';
import {Scenery} from './scenery.mjs';
import {readFile} from 'node:fs/promises';
import {ModelStore} from './model-store.mjs';
import {WorldStream,sceneryModel} from './world-stream.mjs';
import {WorldGround} from './ground.mjs';
import {encodeScenery,propBounds,propTransform} from './scenery-authoring.mjs';
import {decodeScenery} from './scenery-data.mjs';
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
import {Cloth} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/Cloth.js';
import {ClothRig} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothRig.js';
import {row_of_entity} from '@woosh/meep-engine/src/shade/renderer/scene/rows/GPUSceneRows.js';
import {BVH} from '@woosh/meep-engine/src/core/bvh2/bvh3/BVH.js';
import {ebvh_build_for_geometry_morton} from '@woosh/meep-engine/src/core/bvh2/bvh3/ebvh_build_for_geometry_morton.js';
import {ebvh_geometry_query_nearest_triangle_ray} from '@woosh/meep-engine/src/core/bvh2/bvh3/ebvh_geometry_query_nearest_triangle_ray.js';

// Exercise terrain row selection without initializing a GPU render pass.
vi.mock('@woosh/meep-engine/src/engine/graphics3/TerrainSystem.js',()=>({TerrainExtension:class{}}));
vi.mock('@woosh/meep-engine/src/engine/graphics3/terrain/GPUTerrainSplatRenderer.js',()=>({GPUTerrainSplatRenderer:class{}}));

const base=new URL('../../public/assets/geometry/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
const materials=Object.fromEntries(Object.values(manifest.models).flat().map(c=>[c.material,{name:c.material}]));
const read=async file=>{const bytes=await readFile(new URL(file,base));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);};

function raycastSurfaces(parts){
  const surfaces=parts.map(part=>{
    const geometry=geometry_build_from_meshlet_geometry(part.geometry),positions=geometry.getAttribute('position').data,normals=geometry.getAttribute('normal').data,uvs=geometry.getAttribute('uv0').data,indices=geometry.index.data,bvh=new BVH();
    ebvh_build_for_geometry_morton(bvh,indices,positions);return {positions,normals,uvs,indices,bvh,material:part.material};
  });
  return (origin,direction,max=2)=>{
    let nearest=null;const query=[];
    for(const s of surfaces){
      if(!ebvh_geometry_query_nearest_triangle_ray(query,0,s.bvh,s.bvh.root,[...origin,...direction],0,nearest?.distance??max,s.indices,s.positions))continue;
      const ids=Array.from(s.indices.slice(query[0]*3,query[0]*3+3)),v=ids.map(id=>Array.from(s.positions.slice(id*3,id*3+3))),a=v[1].map((x,k)=>x-v[0][k]),b=v[2].map((x,k)=>x-v[0][k]);
      const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...cross);
      const weights=[1-query[1]-query[2],query[1],query[2]];
      nearest={distance:query[3],normal:cross.map(v=>v/length),normals:ids.map(id=>Array.from(s.normals.slice(id*3,id*3+3))),material:s.material,
        uv:[0,1].map(k=>ids.reduce((sum,id,i)=>sum+s.uvs[id*2+k]*weights[i],0))};
    }
    return nearest;
  };
}

test.each(['','_distant'])('bevelled arches have continuous outward-facing surfaces at detail %s',async suffix=>{
  const store=new ModelStore({manifest,materials,read});
  const arches=[{name:'arch',center:[0,4.55,0],inner:1.69,outer:2.41,depth:.45,count:13},...DUNGEONS.map(d=>({
    name:'dungeon_'+d.id,center:[d.origin[0],floorHeight(dungeonFloors(d,heightAt).at(-1),0,-3)+4.2,d.origin[1]+3],inner:2.05,outer:2.65,depth:.425,count:11,
  }))];
  for(const arch of arches){
    const cast=raycastSurfaces(await store.load(arch.name+suffix)),half=Math.PI/arch.count/2;
    const check=(local,direction,expected,label)=>{
      const hit=cast(local.map((v,k)=>v+arch.center[k]),direction);
      expect(hit,`${arch.name+suffix} ${label} missing surface`).not.toBeNull();
      expect(Math.abs(hit.distance-expected),`${arch.name+suffix} ${label} surface depth`).toBeLessThan(.085);
      expect(hit.normal.reduce((sum,v,k)=>sum+v*direction[k],0),`${arch.name+suffix} ${label} winding`).toBeLessThan(-.1);
      for(const n of hit.normals)expect(n.reduce((sum,v,k)=>sum+v*hit.normal[k],0),`${arch.name+suffix} ${label} shading normal`).toBeGreaterThan(.65);
    };
    // Probe faces and both sides of every joint, including the joint itself.
    // Bevels may recess a seam but may never leave a ray-sized hole through it.
    for(let stone=0;stone<arch.count;stone++)for(const f of [0,.005,.5,.995]){
      if(stone===0&&f===0)continue;
      const angle=(stone+f)*Math.PI/arch.count,c=Math.cos(angle),s=Math.sin(angle),factor=Math.cos(half)/Math.cos((f-.5)*2*half),radius=(arch.inner+arch.outer)/2;
      for(const side of [-1,1])check([radius*c,radius*s,side*(arch.depth+.5)],[0,0,-side],.5,`stone ${stone}/${f} ${side<0?'back':'front'}`);
      check([(arch.outer+.5)*c,(arch.outer+.5)*s,0],[-c,-s,0],arch.outer+.5-arch.outer*factor,`stone ${stone}/${f} crown`);
      check([(arch.inner-.5)*c,(arch.inner-.5)*s,0],[c,s,0],arch.inner*factor-(arch.inner-.5),`stone ${stone}/${f} soffit`);
    }
  }
});

test.each(['','_distant'])('the bronze bell has an open mouth, curved waist and supported yoke at detail %s',async suffix=>{
  const store=new ModelStore({manifest,materials,read}),parts=await store.load('bellTower'+suffix),bronze=parts.filter(p=>p.material===materials.bronze);
  expect(bronze.length).toBeGreaterThan(0);const bell=raycastSurfaces(bronze),tower=raycastSurfaces(parts);
  // Rays enter the downward-facing mouth and reach the inner shoulder, rather
  // than striking a cone cap. Stay off the clapper and its central attachment.
  for(const angle of [.2,1.7,3.2,4.7]){
    const c=Math.cos(angle),s=Math.sin(angle),inside=bell([.65*c,15,.65*s],[0,1,0],3);
    expect(inside).not.toBeNull();expect(inside.distance).toBeGreaterThan(1.3);expect(inside.distance).toBeLessThan(2);
    expect(inside.normal[1]).toBeLessThan(-.1);
  }
  const radiusAt=y=>{const hit=bell([2,y,0],[-1,0,0],2);expect(hit).not.toBeNull();expect(hit.normal[0]).toBeGreaterThan(.2);return 2-hit.distance;};
  const lip=radiusAt(15.43),waist=radiusAt(16.30),shoulder=radiusAt(17.20);
  expect(lip).toBeGreaterThan(1.3);expect(waist).toBeGreaterThan(.77);expect(waist).toBeLessThan(.91);expect(shoulder).toBeLessThan(.7);
  // The frame's axle bears on both side beams, and the maintenance landing
  // exists beneath it. Those supports must survive the distant representation.
  for(const x of [-2.5,2.5])expect(tower([x,19.5,0],[0,-1,0],1)?.distance).toBeLessThan(.7);
  expect(tower([0,13.5,0],[0,-1,0],1)?.distance).toBeLessThan(.6);
});

test.each(['','_distant'])('reliquary doorways have bearing lintels and complete masonry jamb courses at detail %s',async suffix=>{
  const dungeon=DUNGEONS.find(d=>d.id==='reliquary'),store=new ModelStore({manifest,materials,read}),cast=raycastSurfaces(await store.load('dungeon_reliquary'+suffix));
  for(const [index,wall] of dungeon.partitions.entries()){
    const axis=wall.a[0]!==wall.b[0]?0:1,[center,width]=wall.door,label=`door ${index}${suffix}`;
    const point=(along,height,offset=0)=>{const p=wall.a.slice();p[axis]=along;p[1-axis]+=offset;return dungeonPoint(dungeon,[...p,wall.level+height]);};
    const face=(along,height,side=1)=>cast(point(along,height,side),axis===0?[0,0,side]:[-side,0,0],1.5);
    // Probe the real bearing volume at mid-depth, not a thin decorative strip
    // above the opening. Its ends must overlap both jambs and carry the header.
    const soffit=cast(point(center,2.5),[0,1,0],1);
    expect(soffit,label+' soffit').not.toBeNull();expect(soffit.distance).toBeCloseTo(.4,3);expect(soffit.normal[1]).toBeLessThan(-.9);
    for(const along of [center-width/2-.15,center,center+width/2+.15])for(const height of [2.94,3.16,3.38])for(const side of [-1,1]){
      const hit=face(along,height,side);expect(hit,label+' lintel bearing').not.toBeNull();expect(hit.material).toBe(materials.stoneLight);expect(hit.distance).toBeLessThan(.65);
    }
    const headerLow=face(center,3.55),headerHigh=face(center,4.25);
    for(const hit of [headerLow,headerHigh]){expect(hit,label+' supported header').not.toBeNull();expect(hit.material).toBe(materials[dungeon.materials.wall]);}
    const headerSlope=(headerHigh.uv[1]-headerLow.uv[1])/.7,headerCourseAt=y=>(headerLow.uv[1]+(y-3.55)*headerSlope)*4;
    expect(headerSlope,label+' upright header courses').toBeGreaterThan(.3);
    for(const y of [3.42,4.4])expect(Math.abs(headerCourseAt(y)-Math.round(headerCourseAt(y))),label+' complete header end course').toBeLessThan(.005);
    // The wall must close against each shaft, not stop at the wider capital
    // footprint and leave a seven-centimetre slot beside the upright masonry.
    for(const along of [center-width/2-.40,center+width/2+.40])for(const height of [.3,1.45,2.6])for(const side of [-1,1]){
      const hit=face(along,height,side);expect(hit,label+' closed jamb-to-wall joint').not.toBeNull();expect(hit.material).toBe(materials[dungeon.materials.wall]);expect(hit.distance).toBeCloseTo(.725,3);
    }
    for(const along of [center-width/2,center+width/2]){
      const low=face(along,.5),high=face(along,2.4);
      for(const hit of [low,high]){expect(hit,label+' masonry jamb').not.toBeNull();expect(hit.material).toBe(materials[dungeon.materials.wall]);expect(hit.distance).toBeCloseTo(.64,3);}
      // Both dressed caps stand proud of the shaft. The lower cap covers the
      // floor contact so the masonry does not start with a sliced bottom row.
      for(const height of [.11,2.79]){const hit=face(along,height);expect(hit,label+' jamb base/capital').not.toBeNull();expect(hit.material).toBe(materials.stoneLight);expect(hit.distance).toBeCloseTo(.57,3);}
      // The texture has four courses per tile. Extrapolate through the small
      // edge bevels to the shaft ends: each end must fall on a bed joint.
      const slope=(high.uv[1]-low.uv[1])/1.9,courseAt=y=>(low.uv[1]+(y-.5)*slope)*4;
      expect(slope,label+' upright courses').toBeGreaterThan(.3);expect(slope).toBeLessThan(.7);
      for(const y of [.22,2.68])expect(Math.abs(courseAt(y)-Math.round(courseAt(y))),label+' full end course').toBeLessThan(.005);
    }
  }
});

test.each(['','_distant'])('a freestanding gallery pier has complete courses and bears fully beneath its perimeter beam at detail %s',async suffix=>{
  const dungeon=DUNGEONS.find(d=>d.id==='reliquary'),bridge=dungeon.rooms.find(r=>r.id==='bridge'),store=new ModelStore({manifest,materials,read}),parts=await store.load('dungeon_reliquary'+suffix),cast=raycastSurfaces(parts),stone=raycastSurfaces(parts.filter(p=>p.material===materials.stoneLight));
  // The first interior support on the western side of the Bell Walk stands in
  // the open vestibule, making its floor contact visible from all sides.
  const beamDepth=.36,beamTop=dungeon.elevation+bridge.level-.30,x=bridge.rect[0],n=3.5,bottom=dungeon.elevation,top=beamTop-beamDepth;
  const face=y=>cast(dungeonPoint(dungeon,[x-1,n,y-dungeon.elevation]),[1,0,0],1.5);
  const low=face(bottom+.5),high=face(top-.5);
  for(const hit of [low,high]){expect(hit).not.toBeNull();expect(hit.material).toBe(materials[dungeon.materials.wall]);expect(hit.distance).toBeCloseTo(.64,3);}
  for(const y of [bottom+.11,top-.11]){const hit=face(y);expect(hit).not.toBeNull();expect(hit.material).toBe(materials.stoneLight);expect(hit.distance).toBeCloseTo(.57,3);}
  // A ray beside the narrower shaft lands on the base's top, .22m above the
  // floor. Without the base it falls straight through to the room pavement.
  const ledge=cast(dungeonPoint(dungeon,[x-.4,n,.5]),[0,-1,0],1);
  expect(ledge).not.toBeNull();expect(ledge.material).toBe(materials.stoneLight);expect(ledge.distance).toBeCloseTo(.28,3);
  const slope=(high.uv[1]-low.uv[1])/(top-bottom-1),courseAt=y=>(low.uv[1]+(y-bottom-.5)*slope)*4;
  expect(slope).toBeGreaterThan(.3);expect(slope).toBeLessThan(.7);
  for(const y of [bottom+.22,top-.22])expect(Math.abs(courseAt(y)-Math.round(courseAt(y))),'complete course at plinth/capital').toBeLessThan(.005);
  // Probe the stone beam independently from the floor slab. All four capital
  // corners must lie beneath it, including the half outside the walking floor.
  for(const dx of [-.4,0,.4])for(const dn of [-.4,0,.4]){
    const hit=stone(dungeonPoint(dungeon,[x+dx,n+dn,beamTop-dungeon.elevation+.1]),[0,-1,0],.8);
    expect(hit,'full beam coverage above capital').not.toBeNull();expect(hit.distance).toBeCloseTo(.1,3);
  }
  // Beyond the capital, the same beam continues to the next support and has
  // a real soffit at the pier head instead of being a thin decorative ledge.
  for(const dn of [-.8,.8])for(const dx of [-.4,0,.4]){
    const hit=stone(dungeonPoint(dungeon,[x+dx,n+dn,top-dungeon.elevation-.2]),[0,1,0],.8);
    expect(hit,'continuous bearing beam soffit').not.toBeNull();expect(hit.distance).toBeCloseTo(.2,3);expect(hit.normal[1]).toBeLessThan(-.9);
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
  const records=buildLayout().props.map(prop=>({scenery:{model:prop.model,bounds:propBounds(prop,manifest)},transform:propTransform(prop),model:null}));
  for(const hearth of HEARTHS){
    const chosen=records.map(r=>sceneryModel(r,hearth.position,manifest));
    expect(records.filter((r,i)=>r.scenery.model.startsWith('terrain_')&&chosen[i])).toHaveLength(48);
    expect(records.filter((r,i)=>r.scenery.model.startsWith('terrain_')&&chosen[i]===r.scenery.model).length).toBeLessThan(24);
    expect(chosen.filter(Boolean).length).toBeLessThan(records.length*.55);
    expect(records.filter(r=>r.scenery.model==='halo').every(r=>sceneryModel(r,hearth.position,manifest))).toBe(true);
  }
  const r=records.find(r=>r.scenery.model==='terrain_0_0');r.model=r.scenery.model;
  expect(sceneryModel(r,[210,20,40],manifest)).toBe(r.scenery.model);
  expect(sceneryModel({...r,model:null},[210,20,40],manifest)).toBe(manifest.lods[r.scenery.model]);
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

async function startStream(prop, store, extraView = {}) {
  const layout = {props: [prop], lights: []};
  const bytes = encodeScenery(layout, manifest);
  const ecd = await decodeScenery(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), manifest);
  const em = new EntityManager();
  em.attachDataset(ecd);
  em.addSystem(new TransformAttachmentSystem());
  const graphics = {set_scene() {}, scene_context: () => null};
  const meshSystem = new MeshSystem(graphics, new Scene(), async name => store.bundle(name));
  const view = {ecd, meshSystem, ...extraView};
  const stream = new WorldStream(view, layout, store);
  em.addSystem(stream);
  await new Promise((resolve, reject) => em.startup(resolve, reject));
  await stream.start(prop.position);
  await em.addSystem(meshSystem);
  await new Promise(resolve => setTimeout(resolve, 0));
  stream.rebuildGround();
  return {stream, ecd, em, meshSystem};
}

const stopManager = em => new Promise((resolve, reject) => em.shutdown(resolve, reject));

test('detaching scenery consumers preserves authored components and reattaches native meshes', async () => {
  const prop = {model: 'terrain_0_0', position: [0, 0, 0], scale: [1, 1, 1], yaw: 0};
  const store = new ModelStore({manifest, materials, read, residentCache: true});
  const {stream, ecd, em, meshSystem} = await startStream(prop, store);
  const root = stream.records[0].entity;
  const scenery = ecd.getComponent(root, Scenery);
  const transform = ecd.getComponent(root, Transform64);
  const mesh = ecd.getComponent(root, SGMesh);
  mesh.flags = 0;
  try {
    expect(store.records.get(prop.model).refs).toBe(1);
    em.detachDataset();
    expect(stream.records).toHaveLength(0);
    expect(store.records.get(prop.model).refs).toBe(0);
    expect(meshSystem.mesh_entities_of(root)).toHaveLength(0);
    expect(ecd.getComponent(root, Scenery)).toBe(scenery);
    expect(ecd.getComponent(root, Transform64)).toBe(transform);
    expect(ecd.getComponent(root, SGMesh)).toBe(mesh);
    expect(mesh.flags).toBe(0);

    em.attachDataset(ecd);
    await stream.start(prop.position);
    await new Promise(resolve => setTimeout(resolve, 0));
    stream.rebuildGround();
    expect(stream.records).toHaveLength(1);
    expect(stream.records[0].scenery).toBe(scenery);
    expect(stream.records[0].transform).toBe(transform);
    expect(ecd.getComponent(root, SGMesh)).toBe(mesh);
    expect(mesh.flags).toBe(0);
    expect(store.records.get(prop.model).refs).toBe(1);
    expect(stream.groundEntities).toHaveLength(1);

    const instance = meshSystem.instance_of(root);
    await em.removeSystem(stream);
    expect(ecd.getComponent(root, SGMesh)).toBe(mesh);
    expect(meshSystem.instance_of(root)).toBe(instance);
    expect(store.records.get(prop.model).refs).toBe(0);
    await em.addSystem(stream);
    await stream.start(prop.position);
    expect(store.records.get(prop.model).refs).toBe(1);
    expect(meshSystem.instance_of(root)).toBe(instance);
  } finally {
    await stopManager(em);
  }
});

test('LOD loading preserves the live placement and keeps the old surface until its replacement is available', async () => {
  const prop = {model: 'terrain_0_0', position: [0, 0, 0], scale: [1, 1, 1], yaw: 0};
  const store = new ModelStore({manifest, materials, read, residentCache: true});
  const {stream, ecd, em, meshSystem} = await startStream(prop, store);
  try {
    const record = stream.records[0];
    const root = record.entity;
    const transform = ecd.getComponent(root, Transform64);
    const scenery = ecd.getComponent(root, Scenery);
    const entities = stream.groundEntities;
    const firstInstance = meshSystem.instance_of(root);
    expect(entities).toHaveLength(1);
    const first = entities[0];
    const ground = new WorldGround();
    ground.getEntities = () => stream.rebuildGround();
    ground.rows = new Uint32Array(0);
    ground.data = {};
    let renderedRows = [];
    ground.pass = {graph_draw({rows, row_count}) {
      renderedRows = Array.from(rows.subarray(0, row_count)).flatMap((value, row) => value ? [row] : []);
    }};
    const packedRows = () => {
      renderedRows = [];
      ground.record({});
      return renderedRows;
    };
    expect(packedRows()).toEqual([row_of_entity(first)]);

    const far = {x: 400, y: 20, z: 400};
    stream.updateView(far, .1);
    expect(meshSystem.instance_of(root)).toBe(firstInstance);
    expect(ecd.getComponent(root, SGMesh).url).toBe(prop.model);
    await Promise.all(stream.loading.values());
    stream.updateView(far, .1);
    await new Promise(resolve => setTimeout(resolve, 0));
    // The native children arrive between presentation updates. Rendering must
    // discover them without another updateView or an explicit terrain rebuild.
    expect(packedRows()).toEqual([...meshSystem.mesh_entities_of(root)].map(row_of_entity));
    expect(meshSystem.instance_of(root)).not.toBe(firstInstance);
    expect(ecd.getComponent(root, SGMesh).url).toBe(manifest.lods[prop.model]);
    expect(ecd.getComponent(root, Transform64)).toBe(transform);
    expect(ecd.getComponent(root, Scenery)).toBe(scenery);
    expect(record.entity).toBe(root);
    expect(stream.groundEntities).toBe(entities);
    expect(entities).toHaveLength(1);
    expect(packedRows()).toEqual([row_of_entity(entities[0])]);
    for (let i = 0; i < 60; i++) stream.updateView(far, .1);
    expect(store.models.has(prop.model)).toBe(false);
    stream.replace(record, null);
    expect(packedRows()).toEqual([]);
    expect(entities).toEqual([]);
    expect(ecd.entityExists(root)).toBe(true);
    expect(ecd.getComponent(root, Transform64)).toBe(transform);
  } finally {
    await stopManager(em);
  }
});

test('repeated travel reuses registered geometry identities with the append-only native BLAS arena',async()=>{
  let reads=0;const store=new ModelStore({manifest,materials,residentCache:true,read:async file=>{reads++;return read(file);},dispose:()=>{throw new Error('Resident identity must not be re-registered');}});
  const first=await store.load('terrain_0_0');
  for(let i=0;i<20;i++){store.retain('terrain_0_0');store.release('terrain_0_0');store.update(6);expect(store.models.size).toBe(0);expect(await store.load('terrain_0_0')).toBe(first);}
  expect(reads).toBe(1);expect(store.stats.cachedBytes).toBe(0);expect(store.cached.size).toBe(0);
});

test('wind-driven banners pause and reuse their native skin when the player travels away',()=>{
  const ecd=new EntityComponentDataset();ecd.setComponentTypeMap([Transform64,SGMesh,Cloth,ClothRig]);
  const view={ecd},banners=new WorldBanners(view,[{position:[0,0,0],yaw:0,phase:0}]);
  banners.update(.1,{x:0,y:0,z:0});const first=banners.banners[0].id;expect(ecd.entityExists(first)).toBe(true);
  banners.update(.1,{x:200,y:0,z:0});expect(ecd.getComponent(first,Cloth)).toBeUndefined();expect(banners.banners[0].active).toBe(false);
  banners.update(.1,{x:0,y:0,z:0});expect(banners.banners[0].id).toBe(first);expect(ecd.getComponent(first,Cloth)).toBeDefined();
});

test('suspended halo trails follow their persistent placement and release distant emitters', async () => {
  const prop = {model: 'halo', position: [20, 45, -10], scale: [2, 2, 2], yaw: Math.PI / 2};
  const store = new ModelStore({manifest, materials, read, residentCache: true});
  let ecd;
  const view = {emitter(kind, position, rate) {
    expect(kind).toBe('levitation');
    expect(rate).toBe(30);
    const t = new Transform64();
    t.setTranslation(...position);
    const id = ecd.createEntity();
    ecd.addComponentToEntity(id, t);
    return {id, t};
  }};
  const active = await startStream(prop, store, view);
  ecd = active.ecd;
  const {stream, em} = active;
  try {
    const baseCount = ecd.entityCount;
    stream.updateView({x: 20, y: 40, z: -10}, .1);
    const halo = stream.halos[0], emitters = halo.emitters;
    const first = Array.from(emitters[0].t.translation);
    expect(emitters).toHaveLength(6);
    expect(ecd.entityCount).toBe(baseCount + 6);
    for (const e of emitters) {
      const [x, y, z] = e.t.translation;
      expect(Math.abs(x - 20)).toBeCloseTo(.68, 3);
      expect(Math.hypot(y - 45, z + 10)).toBeCloseTo(9.24, 3);
    }
    stream.updateView({x: 20, y: 40, z: -10}, 1);
    expect(Array.from(emitters[0].t.translation)).not.toEqual(first);
    expect(halo.emitters).toBe(emitters);
    stream.updateView({x: 1000, y: 0, z: 0}, .1);
    expect(halo.emitters).toBeNull();
    expect(ecd.entityCount).toBe(baseCount);
  } finally {
    await stopManager(em);
  }
});
