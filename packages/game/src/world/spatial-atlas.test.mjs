import {expect,test} from 'vitest';
import {sh9,travelSample} from './spatial-atlas.mjs';
import {landmarkPosition} from './regions.mjs';
test('SH flow retains two opposing directions in its second band',()=>{
  const a=sh9([0,0,1]),b=sh9([0,0,-1]);expect(a).toHaveLength(9);expect(a[1]+b[1]).toBe(0);expect(a[8]+b[8]).not.toBe(0);
});
test('occupancy is three-dimensional and concentrated on the authored routes',()=>{
  const p=landmarkPosition('hearth'),road=travelSample([p[0],p[1]+.9,p[2]]),above=travelSample([p[0],p[1]+40,p[2]]);
  expect(road.occupancy).toBeGreaterThan(.5);expect(above.occupancy).toBeLessThan(.01);expect(road.flow.every(Number.isFinite)).toBe(true);
});
