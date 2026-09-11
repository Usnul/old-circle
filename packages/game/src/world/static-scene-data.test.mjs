import {expect,test} from 'vitest';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {RigidBody} from '@woosh/meep-engine/src/engine/physics/ecs/RigidBody.js';
import {Collider} from '@woosh/meep-engine/src/engine/physics/ecs/Collider.js';
import {Name} from '@woosh/meep-engine/src/engine/ecs/name/Name.js';
import {BodyKind} from '@woosh/meep-engine/src/engine/physics/ecs/BodyKind.js';
import {loadStaticScene} from './static-scene-data.mjs';
import {staticGeometry} from './static-geometry.mjs';
import {buildLayout} from './layout.mjs';

test('baked native static entities preserve authored collision geometry and contact surfaces',async()=>{
  const dataset=new EntityComponentDataset(),scene=await loadStaticScene(dataset),authored=[...staticGeometry(buildLayout())];
  expect(dataset.entityCount).toBe(authored.length);expect(scene.solids).toHaveLength(authored.length-1);
  for(let entity=0;entity<authored.length;entity++){
    const source=authored[entity],transform=dataset.getComponent(entity,Transform64),body=dataset.getComponent(entity,RigidBody),collider=dataset.getComponent(entity,Collider);
    expect(dataset.getComponent(entity,Name).getValue()).toBe(source.model);
    expect(Array.from(transform.translation)).toEqual(source.position);
    expect(body.kind).toBe(BodyKind.Static);expect(collider.friction).toBe(.8);
    expect(collider.shape.equals(source.shape),`shape ${entity} (${source.model})`).toBe(true);
    if(source.model==='terrain')expect(scene.terrainEntity).toBe(entity);
    else expect(scene.solids[entity-1]).toEqual({position:source.position,size:source.size});
  }
  expect([...scene.contactSurfaces.values()]).toContain('wood');
  expect([...scene.contactSurfaces.values()]).toContain('snow');
});

test('parallel loads share immutable shapes but own every mutable ECS component and solid',async()=>{
  const first=new EntityComponentDataset(),second=new EntityComponentDataset();
  const [a,b]=await Promise.all([loadStaticScene(first),loadStaticScene(second)]);
  for(const type of [Transform64,RigidBody,Collider,Name])expect(first.getComponent(1,type)).not.toBe(second.getComponent(1,type));
  expect(first.getComponent(1,Collider).shape).toBe(second.getComponent(1,Collider).shape);
  const body=second.getComponent(1,RigidBody),position=Array.from(second.getComponent(1,Transform64).translation);
  first.getComponent(1,RigidBody).linearVelocity[0]=10;first.getComponent(1,Collider).friction=0;first.getComponent(1,Transform64).setTranslation(0,0,0);
  a.solids[0].position[0]=1e6;a.solids[0].size[0]=1e6;a.contactSurfaces.clear();
  expect(body.linearVelocity[0]).toBe(0);expect(second.getComponent(1,Collider).friction).toBe(.8);
  expect(Array.from(second.getComponent(1,Transform64).translation)).toEqual(position);
  expect(b.solids[0].position).toEqual(position);expect(b.solids[0].size[0]).toBeLessThan(1e6);expect(b.contactSurfaces.size).toBeGreaterThan(0);
  await expect(loadStaticScene(first)).rejects.toThrow('empty dataset');
});
