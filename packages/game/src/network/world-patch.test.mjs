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

test('world changes compare nested snapshot values independent of object field order',()=>{
  const before={tick:1,time:12,actors:[{id:'player',inventory:{weapons:['sword','bow'],reinforcements:{sword:2,bow:1}}}],events:[{key:'hit',position:[1,2,3]}]};
  const reordered={tick:2,time:12,actors:[{id:'player',inventory:{reinforcements:{bow:1,sword:2},weapons:['sword','bow']}}],events:[{position:[1,2,3],key:'hit'}]};
  const unchanged=worldPatch(before,reordered);
  expect(unchanged.actors.changes).toEqual([]);expect(unchanged.events).toBeUndefined();
  const after=structuredClone(reordered);after.actors[0].inventory.reinforcements.sword=3;after.actors[0].inventory.weapons.reverse();after.events[0].position[1]=4;
  const patch=worldPatch(before,after),result=structuredClone(before);applyWorldPatch(result,patch);
  expect(result.actors).toEqual(after.actors);expect(result.events).toEqual(after.events);
});

test.each([[{},[]],[[],{}],[{'0':'sword'},['sword']],[['sword'],{'0':'sword'}]])('world changes preserve nested wire array and record types (%j to %j)',(prior,next)=>{
  const before={tick:1,time:12,actors:[{id:'player',inventory:{value:prior}}],events:[]},after={tick:2,time:12,actors:[{id:'player',inventory:{value:next}}],events:[]};
  const patch=worldPatch(before,after);expect(patch.actors.changes).toHaveLength(1);
  const result=structuredClone(before);applyWorldPatch(result,patch);expect(result.actors).toEqual(after.actors);
});
