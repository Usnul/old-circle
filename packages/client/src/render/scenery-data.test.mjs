import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {ShadedGeometry} from '@woosh/meep-engine/src/engine/graphics/ecs/mesh-v2/ShadedGeometry.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {buildLayout} from '@old-circle/game/world/layout.mjs';
import {bakedPropTransform} from '@old-circle/game/world/prop-transform.mjs';
import {encodeScenery,propTransform} from './scenery-authoring.mjs';
import {decodeScenery,attachScenery} from './scenery-data.mjs';

const manifest={revision:'scenery-test',models:{tree:[],reliquary:[]},bounds:{tree:[-1,-2,-3,4,5,6],reliquary:[-1,0,-1,1,2,1]}};
const arrayBuffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const props=[{model:'tree',position:[10.1234567890123,3,-8],scale:[-2,.7,3],yaw:1.234,up:[.2,Math.sqrt(.91),-.3]},{model:'reliquary',position:[5,2,6],scale:[1,1,1],yaw:0,relic:'root'}];

test('native scenery decoding preserves authored transforms, relic identity and sloped world bounds',async()=>{
  const scene=await decodeScenery(arrayBuffer(encodeScenery({props},manifest)),manifest);
  expect(scene.dataset.entityCount).toBe(2);expect(scene.records[1].prop.relic).toBe('root');
  for(let i=0;i<props.length;i++){
    const prop=props[i],record=scene.records[i],original=propTransform(prop);
    expect(record.transform).toBeInstanceOf(Transform64);expect(record.mesh.url).toBe(prop.model);
    expect([...record.transform.translation]).toEqual(prop.position);
    for(let k=0;k<16;k++)expect(Math.abs(record.transform[k]-original[k])).toBeLessThan(.01);
    const b=manifest.bounds[prop.model],corners=[];
    for(const x of [b[0],b[3]])for(const y of [b[1],b[4]])for(const z of [b[2],b[5]])corners.push([...new Vector3(x,y,z).applyMatrix4(record.transform)]);
    const expected=[0,1,2].map(k=>Math.min(...corners.map(p=>p[k]))).concat([0,1,2].map(k=>Math.max(...corners.map(p=>p[k]))));
    for(let k=0;k<6;k++)expect(record.bounds[k]).toBeCloseTo(expected[k],8);
  }
});

test('scenery LOD attachments reuse decoded native transforms without overwriting live entity IDs',async()=>{
  const scene=await decodeScenery(arrayBuffer(encodeScenery({props},manifest)),manifest),transform=scene.records[0].transform;
  const ecd=new EntityComponentDataset();ecd.setComponentTypeMap([Transform64,ShadedGeometry]);
  const existing=ecd.createEntity(),camera=new Transform64();camera.setTranslation(7,8,9);ecd.addComponentToEntity(existing,camera);
  const view={ecd,models:new Map([['near',[{geometry:{},material:{}},{geometry:{},material:{}}]],['far',[{geometry:{},material:{}}]]])};
  for(let i=0;i<8;i++){
    const parts=attachScenery(ecd,view.models.get(i%2?'far':'near'),transform);
    expect(ecd.getComponent(existing,Transform64)).toBe(camera);
    for(const part of parts){expect(part.id).not.toBe(existing);expect(part.t).toBe(transform);expect(ecd.getComponent(part.id,Transform64)).toBe(transform);}
    for(const part of parts)ecd.removeEntity(part.id);
    expect(ecd.entityCount).toBe(1);
  }
});

test('scenery rejects stale geometry revisions and trailing bytes',async()=>{
  const bytes=arrayBuffer(encodeScenery({props},manifest));
  await expect(decodeScenery(bytes,{...manifest,revision:'different'})).rejects.toThrow('needs rebuilding');
  const trailing=new Uint8Array(bytes.byteLength+1);trailing.set(new Uint8Array(bytes));
  await expect(decodeScenery(trailing.buffer,manifest)).rejects.toThrow('Malformed scenery dataset');
});

test('shipped scenery includes every authored prop as a native entity with the current geometry revision',async()=>{
  const root=new URL('../../public/assets/geometry/',import.meta.url),current=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  const scene=await decodeScenery(arrayBuffer(await readFile(new URL('scenery.bin',root))),current),layout=buildLayout();
  expect(scene.records).toHaveLength(layout.props.length);
  expect(scene.records.map(record=>record.mesh.url)).toEqual(layout.props.map(prop=>prop.model));
  expect(scene.records.filter(record=>record.prop.relic).map(record=>record.prop.relic)).toEqual(layout.props.filter(prop=>prop.relic).map(prop=>prop.relic));
  for(let i=0;i<layout.props.length;i++)expect([...scene.records[i].transform]).toEqual([...bakedPropTransform(layout.props[i])]);
});
