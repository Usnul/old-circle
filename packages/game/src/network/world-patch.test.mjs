import {expect,test} from 'vitest';
import {worldPatch,applyWorldPatch} from './world-patch.mjs';

test('world actions preserve precise changes, arrivals, departures and effect expiry without resending unchanged inventory',()=>{
  const before={version:1,tick:10,time:12,actors:[{id:'player',x:1,inventory:{arrows:30},targetId:'guard'},{id:'leaver',x:0}],projectiles:[{id:90,position:[1,2,3]}],events:[{key:'old'}]};
  const after={version:1,tick:12,time:12.00037,actors:[{id:'player',x:1.1234567891011,inventory:{arrows:30}},{id:'joiner',x:4}],projectiles:[{id:91,position:[3,2,1]}],events:[]};
  const patch=worldPatch(before,after);expect(patch.actors.changes[0].set.inventory).toBeUndefined();
  const result=structuredClone(before);applyWorldPatch(result,patch);expect(result).toEqual(after);
  applyWorldPatch(result,patch);expect(result).toEqual(after);
  expect(()=>applyWorldPatch({...before,tick:9},patch)).toThrow('World history gap');
  const corrected={...after,tick:14,actors:[{id:'player',x:2,inventory:{arrows:29}}]};
  applyWorldPatch(result,worldPatch(after,corrected,{replace:true}));expect(result).toEqual(corrected);
  // Applying an action must not leave its payload aliased to the live world.
  result.actors[0].x=20;expect(corrected.actors[0].x).toBe(2);expect(patch.actors.changes[1].create.x).toBe(4);
});
