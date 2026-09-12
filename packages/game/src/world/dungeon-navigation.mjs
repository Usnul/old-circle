import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {Graph} from '@woosh/meep-engine/src/core/graph/v2/Graph.js';
import {bt_mesh_validate} from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/query/bt_mesh_validate.js';
import {bt_mesh_is_manifold} from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/query/bt_mesh_is_manifold.js';
import {bt_mesh_from_indexed_geometry} from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/io/bt_mesh_from_indexed_geometry.js';
import {bt_mesh_build_face_bvh} from '@woosh/meep-engine/src/core/geom/3d/topology/struct/binary/query/bt_mesh_build_face_bvh.js';
import {CapsuleShape3D} from '@woosh/meep-engine/src/core/geom/3d/shape/CapsuleShape3D.js';
import {Actor} from '../simulation/components.mjs';
import {DUNGEONS,dungeonPoint,dungeonFloors,floorHeight} from './dungeons.mjs';
import {WORLD_VERSION,heightAt} from './regions.mjs';
import {SpatialAtlas} from './spatial-atlas.mjs';

function atlasFor(id,geometry){
  const xs=geometry.positions.filter((_,i)=>i%3===0),zs=geometry.positions.filter((_,i)=>i%3===2);
  const atlas=new SpatialAtlas(null,{bounds:[Math.min(...xs)-1,Math.min(...zs)-1,Math.max(...xs)+1,Math.max(...zs)+1],spacing:.5});
  bt_mesh_from_indexed_geometry(atlas.nav.topology,geometry.indices,geometry.positions);bt_mesh_build_face_bvh(atlas.nav.bvh,atlas.nav.topology);
  atlas.geometry=geometry;atlas.faceCount=geometry.indices.length/3;atlas.id=id;return atlas;
}
/** Every authored layer is sampled independently; an upper floor never replaces
 * the lower floor at the same X/Z. Meep overlap rejects walls and low ceilings. */
export function bakeDungeonNavigation(world){
  const capsule=CapsuleShape3D.from(.42,1.05),hits=new Uint32Array(32),result=[];
  for(const d of DUNGEONS){
    const positions=[],indices=[],vertices=new Map(),triangles=new Set(),floors=dungeonFloors(d,heightAt);
    const clear=(x,n,y)=>world.physics.overlap(capsule,[d.origin[0]+x,y+1.02,d.origin[1]-n],[0,0,0,1],hits,0,(e,c)=>c.shape.is_convex!==false&&!world.ecd.getComponent(e,Actor))===0;
    const vertex=(x,n,y)=>{const p=[d.origin[0]+x,y,d.origin[1]-n],key=p.map(v=>v.toFixed(4)).join(',');if(!vertices.has(key)){vertices.set(key,positions.length/3);positions.push(...p);}return vertices.get(key);};
    for(const floor of floors){
      const [x0,n0,x1,n1]=floor.rect,s=.5,cols=Math.round((x1-x0)/s)+1,rows=Math.round((n1-n0)/s)+1,grid=[];
      for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const x=x0+i*s,n=n0+j*s,y=floorHeight(floor,x,n);grid.push(clear(x,n,y)?vertex(x,n,y):-1);}
      for(let j=0;j<rows-1;j++)for(let i=0;i<cols-1;i++){
        const corners=[grid[j*cols+i],grid[j*cols+i+1],grid[(j+1)*cols+i],grid[(j+1)*cols+i+1]];
        if(corners.includes(-1)||!clear(x0+(i+.5)*s,n0+(j+.5)*s,floorHeight(floor,x0+(i+.5)*s,n0+(j+.5)*s)))continue;
        for(const tri of [[corners[0],corners[1],corners[2]],[corners[1],corners[3],corners[2]]]){const key=[...tri].sort((a,b)=>a-b).join(',');if(!triangles.has(key)){triangles.add(key);indices.push(...tri);}}
      }
    }
    const atlas=atlasFor(d.id,{positions,indices}),defects=bt_mesh_validate(atlas.nav.topology);
    if(defects.length||!bt_mesh_is_manifold(atlas.nav.topology))throw new Error(`Invalid dungeon topology: ${d.id}`);
    result.push(atlas);
  }
  return result;
}

export function encodeDungeonNavigation(atlases){
  const b=new BinaryBuffer();b.writeUint32(1);b.writeUint32(WORLD_VERSION);b.writeUint32(atlases.length);
  for(const atlas of atlases){const {positions,indices}=atlas.geometry;b.writeUTF8String(atlas.id);b.writeUint32(positions.length);b.writeUint32(indices.length);b.writeFloat32Array(Float32Array.from(positions),0,positions.length);b.writeUint32Array(Uint32Array.from(indices),0,indices.length);}
  return new Uint8Array(b.data,0,b.position);
}
export function decodeDungeonNavigation(bytes) {
  const buffer = new BinaryBuffer();
  buffer.fromArrayBuffer(bytes);
  if (buffer.readUint32() !== 1 || buffer.readUint32() !== WORLD_VERSION) {
    throw new Error('Dungeon navigation needs rebuilding');
  }
  const count = buffer.readUint32();
  const atlases = new Map();
  for (let index = 0; index < count; index++) {
    const id = buffer.readUTF8String();
    const vertexValues = buffer.readUint32();
    const indexValues = buffer.readUint32();
    const positions = new Float32Array(vertexValues);
    const indices = new Uint32Array(indexValues);
    buffer.readFloat32Array(positions, 0, vertexValues);
    buffer.readUint32Array(indices, 0, indexValues);
    atlases.set(id, atlasFor(id, {positions: Array.from(positions), indices: Array.from(indices)}));
  }
  return atlases;
}

export function withDungeonNavigation(outdoors,atlases){
  const floors=new Map(DUNGEONS.map(d=>[d.id,dungeonFloors(d,heightAt)])),tiles=new WeakMap();
  const roomAt=(d,p)=>floors.get(d.id).find(f=>{const y=floorHeight(f,p[0]-d.origin[0],d.origin[1]-p[2]);return y!==null&&Math.abs(p[1]-y)<1.5;});
  const containing=p=>DUNGEONS.find(d=>roomAt(d,p));
  const entry=d=>{const p=dungeonPoint(d,d.entrance);p[1]=floorHeight(floors.get(d.id).at(-1),...d.entrance);return p;};
  const graphs=new Map(DUNGEONS.map(d=>{const graph=new Graph();for(const f of floors.get(d.id))graph.addNode(f.id);for(const [a,b] of d.connections)graph.createEdge(a,b);return [d.id,graph];}));
  const join=paths=>paths.find(p=>!p.reachable)??{reachable:true,points:paths.flatMap(p=>p.points),length:paths.reduce((sum,p)=>sum+p.length,0),resolution:.5};
  const inside=(d,from,to)=>{
    const atlas=atlases.get(d.id),direct=atlas.path(from,to);if(direct.reachable)return direct;
    // Split long folded-surface queries at authored room connections. The native
    // graph selects the rooms; every physical leg still uses Meep's navmesh.
    const a=roomAt(d,from),b=roomAt(d,to);if(!a||!b)return direct;
    const rooms=graphs.get(d.id).findPath(a.id,b.id);if(!rooms||rooms.length<2)return direct;
    const points=[from];for(let i=1;i<rooms.length;i++){const link=d.connections.find(([a,b])=>a===rooms[i-1]&&b===rooms[i]||b===rooms[i-1]&&a===rooms[i]);points.push(dungeonPoint(d,link[2]));}points.push(to);
    return join(points.slice(1).map((p,i)=>atlas.path(points[i],p)));
  };
  return {...outdoors,inDungeon:p=>!!containing(p),tile(home){
    const outer=outdoors.tile(home);
    if(tiles.has(outer))return tiles.get(outer);
    const tile={...outer,path(from,to){
      const a=containing(from),b=containing(to);if(a?.id===b?.id)return a?inside(a,from,to):outer.path(from,to);
      const paths=[];if(a)paths.push(inside(a,from,entry(a)));
      paths.push(outer.path(a?entry(a):from,b?entry(b):to));if(b)paths.push(inside(b,entry(b),to));
      return join(paths);
    }};tiles.set(outer,tile);return tile;
  }};
}
