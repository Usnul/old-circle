import {expect,test} from 'vitest';
import {staticGeometry} from './static-geometry.mjs';

test('arch collision stones contain their interiors and leave the doorway open',()=>{
  const layout={props:[{model:'arch',position:[0,0,0],scale:[1,1,1],yaw:0}]};
  const stones=[...staticGeometry(layout)].filter(body=>body.model==='arch');
  expect(stones).toHaveLength(27);
  for(const {position,shape} of stones){
    // Each convex body is centred inside its own bounds. Inward face planes
    // reject this point even though the visible solid surrounds it.
    expect(shape.contains_point([0,0,0]),`stone at ${position}`).toBe(true);
    expect(shape.contains_point(position.map((v,i)=>[0,2,0][i]-v))).toBe(false);
  }
});
