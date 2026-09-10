import {expect,test} from 'vitest';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {FrameAdapter} from './frame-adapter.mjs';

test('Meep LZ4 records preserve precise simulation state across consecutive binary records',()=>{
  class Frame{}
  const adapter=new FrameAdapter(Frame),buffer=new BinaryBuffer();
  const value={actors:Array.from({length:80},(_,i)=>({id:`enemy-${i}`,x:Math.sin(i)*100,y:Math.PI,z:-123.4567891011,home:[0,0,20],phase:'patrol',name:'The Roadbound',inventory:{weapons:['sword'],arrows:30}}))};
  adapter.serialize(buffer,value);const boundary=buffer.position;adapter.serialize(buffer,{tick:24387});buffer.position=0;
  const result=new Frame();adapter.deserialize(buffer,result);expect(result).toEqual(value);expect(buffer.position).toBe(boundary);
  expect(boundary).toBeLessThan(JSON.stringify(value).length*.35);
  const next=new Frame();adapter.deserialize(buffer,next);expect(next.tick).toBe(24387);
});

test('compressed records reject excessive allocation requests and truncated blocks',()=>{
  const adapter=new FrameAdapter(Object),buffer=new BinaryBuffer();buffer.writeUintVar(3*1024*1024);buffer.writeUintVar(4);buffer.position=0;
  expect(()=>adapter.deserialize(buffer,{})).toThrow('Malformed gameplay record size');
  const valid=new BinaryBuffer();adapter.serialize(valid,{tick:10});const truncated=new BinaryBuffer();truncated.fromArrayBuffer(valid.data.slice(0,valid.position-1));
  expect(()=>adapter.deserialize(truncated,{})).toThrow();
});
