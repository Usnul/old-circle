import {expect,test} from 'vitest';
import {sh9,travelSample} from './spatial-atlas.mjs';
import {loadNavigation,decodeNavigation} from './navigation-data.mjs';
import {landmarkPosition} from './regions.mjs';
test('SH flow retains two opposing directions in its second band',()=>{
  const a=sh9([0,0,1]),b=sh9([0,0,-1]);expect(a).toHaveLength(9);expect(a[1]+b[1]).toBe(0);expect(a[8]+b[8]).not.toBe(0);
});
test('SH flow keeps the Y-up coefficient convention used by baked samples and inspector arrows',()=>{
  const east=sh9([1,0,0]),up=sh9([0,1,0]),north=sh9([0,0,1]);
  expect(east.slice(1,4)).toEqual([0,0,expect.closeTo(.4886025119,9)]);
  expect(up.slice(1,4)).toEqual([0,expect.closeTo(.4886025119,9),0]);
  expect(north.slice(1,4)).toEqual([expect.closeTo(.4886025119,9),0,0]);
  expect(up[6]).toBeCloseTo(.6307831305,9);expect(north[8]).toBeCloseTo(-.5462742153,9);
});
test('occupancy is three-dimensional and concentrated on the authored routes',()=>{
  const p=landmarkPosition('hearth'),road=travelSample([p[0],p[1]+.9,p[2]]),above=travelSample([p[0],p[1]+40,p[2]]);
  expect(road.occupancy).toBeGreaterThan(.5);expect(above.occupancy).toBeLessThan(.01);expect(road.flow.every(Number.isFinite)).toBe(true);
});

test('baked Meep navigation routes locally, reuses prepared tiles and rejects distant endpoints',async()=>{
  const data=await loadNavigation(),home=landmarkPosition('hearth'),tile=data.tile(home);
  expect(tile.path(home,landmarkPosition('cave')).reachable).toBe(true);
  expect(data.tile(home)).toBe(tile);expect(tile.faceCount).toBeLessThan(data.faceCount/8);
  expect(tile.path(home,landmarkPosition('halo'))).toMatchObject({reachable:false,points:[]});
  expect(()=>decodeNavigation(new ArrayBuffer(20))).toThrow('Navigation needs rebuilding');
});
