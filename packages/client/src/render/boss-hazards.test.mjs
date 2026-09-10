import {expect,test} from 'vitest';
import {BossHazards} from './boss-hazards.mjs';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Decal} from '@woosh/meep-engine/src/engine/graphics/ecs/decal/v2/Decal.js';

test('native warnings retain their projector through replay, burst once, fade and release all entities',()=>{
  const ecd=new EntityComponentDataset();for(const c of [Transform64,Decal])ecd.registerComponentType(c);
  let bursts=0;const view={ecd,transients:[],particles:{burst(){bursts++;}},emitter(){this.transients.push({});return {id:0};}},hazards=new BossHazards(view);
  const p={id:12,key:'cast:1',kind:'sigil',effect:'roots',radius:2.3,position:[0,2,24],delay:1.4,life:1.85,age:.2};
  hazards.update([p],null,1,.02);const mark=hazards.marks.get(p.key);expect(mark.t.matrix[9]).toBeLessThan(0);expect(mark.t.scale[0]).toBeCloseTo(4.6);expect(bursts).toBe(0);
  hazards.update([{...p,id:59,age:1.41}],null,1,.02);expect(hazards.marks.get(p.key)).toBe(mark);expect(bursts).toBe(1);
  hazards.update([{...p,id:61,age:1.42}],null,1,.02);expect(bursts).toBe(1);
  hazards.update([{...p,age:1.84}],null,1,.02);expect(mark.decal.color.a).toBeLessThan(.1);expect(mark.decal.emissive_intensity).toBeLessThan(.1);
  hazards.update([],null,1,.02);expect(hazards.marks.size).toBe(0);expect(ecd.entityExists(mark.id)).toBe(false);
  hazards.update(Array.from({length:100},(_,i)=>({...p,key:'cast:'+i})),null,1,.02);expect(hazards.marks.size).toBe(64);
  hazards.update([],null,2,.02);expect(hazards.marks.size).toBe(0);
});
