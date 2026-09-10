import {expect,test} from 'vitest';
import {PresentationPoses} from './presentation-poses.mjs';
test('Meep pose interpolation gives continuous travel and shortest-arc facing',()=>{
  const poses=new PresentationPoses(),a={id:'player',x:0,y:1,z:0,yaw:Math.PI-.05};
  poses.accept({actors:[a]},0);const b={...a,x:.12,yaw:-Math.PI+.05};poses.accept({actors:[b]},1/30);
  const p=poses.sample(b,.05);expect(p.x).toBeCloseTo(.06);expect(Math.abs(p.yaw)).toBeCloseTo(Math.PI);
});
test('a respawn snaps without interpolating through the world',()=>{
  const poses=new PresentationPoses(),a={id:'player',x:0,y:1,z:0,yaw:0};poses.accept({actors:[a]},0);
  const b={...a,x:100};poses.accept({actors:[b]},1/30);expect(poses.sample(b,.04).x).toBe(100);
});
