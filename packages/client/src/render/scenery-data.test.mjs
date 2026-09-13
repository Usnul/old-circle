import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {TransformAttachment} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachment.js';
import {TransformAttachmentSystem} from '@woosh/meep-engine/src/engine/ecs/transform-attachment/TransformAttachmentSystem.js';
import {ParentEntity} from '@woosh/meep-engine/src/engine/ecs/parent/ParentEntity.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {RigidBody} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import {Camera} from '@woosh/meep-engine/src/engine/graphics/ecs/camera/Camera.js';
import {SGMesh} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/aggregate/SGMesh.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import {MeshSystem} from '@woosh/meep-engine/src/engine/graphics3/MeshSystem.js';
import {Scene} from '@woosh/meep-engine/src/shade/renderer/scene/Scene.js';
import {SceneBundle} from '@woosh/meep-engine/src/shade/renderer/loader/SceneBundle.js';
import {SceneNode} from '@woosh/meep-engine/src/shade/renderer/loader/SceneNode.js';
import {MeshletGeometry} from '@woosh/meep-engine/src/shade/renderer/geometry/MeshletGeometry.js';
import {StandardShadeMaterial} from '@woosh/meep-engine/src/shade/renderer/material/StandardShadeMaterial.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {buildLayout} from '@old-circle/game/world/layout.mjs';
import {bakedPropTransform} from '@old-circle/game/world/prop-transform.mjs';
import {loadStaticScene,loadStaticSceneAssets} from '@old-circle/game/world/static-scene-data.mjs';
import {encodeScenery,propTransform} from './scenery-authoring.mjs';
import {decodeScenery} from './scenery-data.mjs';
import {Scenery} from './scenery.mjs';

const manifest={
  revision:'scenery-test',
  models:{tree:[],reliquary:[]},
  bounds:{tree:[-1,-2,-3,4,5,6],reliquary:[-1,0,-1,1,2,1]}
};
const arrayBuffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const props=[
  {model:'tree',position:[10.1234567890123,3,-8],scale:[-2,.7,3],yaw:1.234,up:[.2,Math.sqrt(.91),-.3]},
  {model:'reliquary',position:[5,2,6],scale:[1,1,1],yaw:0,relic:'root'}
];

test('native scenery decoding preserves authored transforms, relic identity and sloped world bounds',async()=>{
  const dataset=new EntityComponentDataset();
  expect(await decodeScenery(arrayBuffer(encodeScenery({props},manifest)),manifest,dataset)).toBe(dataset);
  expect(dataset.entityCount).toBe(2);
  expect(dataset.getComponent(1,Scenery).relic).toBe('root');

  for(let entity=0;entity<props.length;entity++){
    const prop=props[entity];
    const transform=dataset.getComponent(entity,Transform64);
    const scenery=dataset.getComponent(entity,Scenery);
    expect(transform).toBeInstanceOf(Transform64);
    expect(dataset.getComponent(entity,SGMesh).url).toBe(prop.model);
    expect(scenery.model).toBe(prop.model);
    expect([...transform.translation]).toEqual(prop.position);
    const original=propTransform(prop);
    for(let k=0;k<16;k++)expect(Math.abs(transform[k]-original[k])).toBeLessThan(.01);

    const bounds=manifest.bounds[prop.model];
    const corners=[];
    for(const x of [bounds[0],bounds[3]]){
      for(const y of [bounds[1],bounds[4]]){
        for(const z of [bounds[2],bounds[5]])corners.push([...new Vector3(x,y,z).applyMatrix4(transform)]);
      }
    }
    const expected=[0,1,2].map(k=>Math.min(...corners.map(p=>p[k])))
      .concat([0,1,2].map(k=>Math.max(...corners.map(p=>p[k]))));
    for(let k=0;k<6;k++)expect(scenery.bounds[k]).toBeCloseTo(expected[k],8);
  }
});

test('native mesh systems consume decoded roots and clean their children without replacing authored entities',async()=>{
  const dataset=await decodeScenery(arrayBuffer(encodeScenery({props},manifest)),manifest);
  const roots=props.map((_,entity)=>({entity,transform:dataset.getComponent(entity,Transform64),scenery:dataset.getComponent(entity,Scenery)}));
  const geometry=new MeshletGeometry();
  const material=new StandardShadeMaterial();
  const bundle=new SceneBundle();
  bundle.add_node(SceneNode.from({name:'primitive',geometry,material}));
  const scene=new Scene();
  const meshes=new MeshSystem({scene_context:()=>null,set_scene:()=>{}},scene,async()=>bundle);
  const manager=new EntityManager();
  manager.addSystem(new TransformAttachmentSystem());
  manager.addSystem(meshes);
  manager.attachDataset(dataset);

  try{
    await new Promise((resolve,reject)=>manager.startup(resolve,reject));
    await expect.poll(()=>roots.every(root=>meshes.instance_of(root.entity)!==null)).toBe(true);
    expect(scene.dataset).toBe(dataset);
    dataset.registerComponentType(Camera);
    const camera=dataset.createEntity();
    const cameraTransform=new Transform64();
    dataset.addComponentToEntity(camera,new Camera());
    dataset.addComponentToEntity(camera,cameraTransform);
    expect(roots.map(root=>root.entity)).not.toContain(camera);

    for(const root of roots){
      expect(dataset.getComponent(root.entity,Transform64)).toBe(root.transform);
      expect(dataset.getComponent(root.entity,Scenery)).toBe(root.scenery);
      const instance=meshes.instance_of(root.entity);
      expect(instance.root).toBe(root.entity);
      expect(instance.entities[0]).toBe(root.entity);
      expect(instance.mesh_entities).toHaveLength(1);
      const child=instance.mesh_entities[0];
      expect(child).not.toBe(root.entity);
      expect(dataset.getComponent(child,ParentEntity).entity).toBe(root.entity);
      expect(dataset.getComponent(child,TransformAttachment).parent).toBe(root.entity);
      expect(dataset.getComponent(child,ShadedGeometry).geometry).toBe(geometry);
      expect(dataset.getComponent(child,ShadedGeometry).material).toBe(material);
      const childTransform=dataset.getComponent(child,Transform64);
      for(let index=0;index<16;index++)expect(childTransform[index]).toBeCloseTo(root.transform[index],12);
      const children=[...instance.entities].slice(1);
      dataset.removeEntity(root.entity);
      for(const entity of children)expect(dataset.entityExists(entity)).toBe(false);
      expect(meshes.instance_of(root.entity)).toBeNull();
    }
    expect(dataset.entityCount).toBe(1);
    expect(dataset.getComponent(camera,Transform64)).toBe(cameraTransform);
  }finally{
    await new Promise((resolve,reject)=>manager.shutdown(resolve,reject));
  }
});

test('scenery rejects populated datasets before altering their existing entities',async()=>{
  const dataset=new EntityComponentDataset();
  dataset.registerComponentType(Transform64);
  const entity=dataset.createEntity();
  const transform=new Transform64();
  transform.setTranslation(7,8,9);
  dataset.addComponentToEntity(entity,transform);
  const before=[...transform];
  const bytes=arrayBuffer(encodeScenery({props},manifest));
  await expect(decodeScenery(bytes,manifest,dataset)).rejects.toThrow('empty dataset');
  expect(dataset.entityCount).toBe(1);
  expect(dataset.getComponent(entity,Transform64)).toBe(transform);
  expect([...transform]).toEqual(before);
});

test('scenery rejects stale geometry revisions',async()=>{
  const bytes=arrayBuffer(encodeScenery({props},manifest));
  await expect(decodeScenery(bytes,{...manifest,revision:'different'})).rejects.toThrow('needs rebuilding');
});

test('the presentation bake includes existing static entities and binds their shared shape assets',async()=>{
  const source=new EntityComponentDataset();
  await loadStaticScene(source);
  const count=source.entityCount;
  const assets=await loadStaticSceneAssets();
  const dataset=await decodeScenery(arrayBuffer(encodeScenery({props},manifest,source)),manifest,undefined,assets);
  expect(dataset.entityCount).toBe(count+props.length);
  expect(dataset.computeComponentCount(RigidBody)).toBe(0);
  for(let entity=0;entity<count;entity++){
    expect(dataset.getComponent(entity,Collider).shape).toBe(assets.shapes[assets.bindings[entity].shape]);
    expect([...dataset.getComponent(entity,Transform64)]).toEqual([...source.getComponent(entity,Transform64)]);
  }
  expect(dataset.getComponent(count,Scenery).model).toBe(props[0].model);
});

test('shipped scenery contains every authored placement and static collider in one native dataset',async()=>{
  const root=new URL('../../public/assets/geometry/',import.meta.url);
  const current=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  const assets=await loadStaticSceneAssets();
  const dataset=await decodeScenery(arrayBuffer(await readFile(new URL('scenery.bin',root))),current,undefined,assets);
  const layout=buildLayout();
  expect(assets.bindings).toHaveLength(7093);
  expect(layout.props).toHaveLength(3719);
  expect(dataset.entityCount).toBe(10812);
  expect(dataset.computeComponentCount(RigidBody)).toBe(0);
  // Presentation deliberately strips rigid bodies; lanterns must index the
  // remaining native colliders, including terrain, before animated proxies exist.
  const {LanternScenery}=await import('./lantern-chain.mjs');
  const lanternScenery=new LanternScenery(dataset);
  expect(lanternScenery.colliders).toHaveLength(assets.bindings.length);
  expect(lanternScenery.nearby([0,1,23],4).length).toBeGreaterThan(0);
  const placements=[];
  dataset.traverseEntities([Scenery,Transform64,SGMesh],(scenery,transform,mesh)=>placements.push({scenery,transform,mesh}));
  expect(placements).toHaveLength(layout.props.length);
  expect(placements.map(({mesh})=>mesh.url)).toEqual(layout.props.map(prop=>prop.model));
  expect(placements.filter(({scenery})=>scenery.relic).map(({scenery})=>scenery.relic))
    .toEqual(layout.props.filter(prop=>prop.relic).map(prop=>prop.relic));
  for(let index=0;index<layout.props.length;index++){
    const {scenery, transform} = placements[index];
    expect(scenery.model).toBe(layout.props[index].model);
    expect(Object.hasOwn(current.models, scenery.model)).toBe(true);
    expect([...transform]).toEqual([...bakedPropTransform(layout.props[index])]);
    expect([...scenery.bounds, ...transform].every(Number.isFinite)).toBe(true);
    expect(scenery.bounds.x0).toBeLessThanOrEqual(scenery.bounds.x1);
    expect(scenery.bounds.y0).toBeLessThanOrEqual(scenery.bounds.y1);
    expect(scenery.bounds.z0).toBeLessThanOrEqual(scenery.bounds.z1);
  }
  let colliders=0;
  dataset.traverseEntities([Collider],(collider,entity)=>{
    expect(collider.shape).toBe(assets.shapes[assets.bindings[entity].shape]);
    colliders++;
  });
  expect(colliders).toBe(assets.bindings.length);
});
