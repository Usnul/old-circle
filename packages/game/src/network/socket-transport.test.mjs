import {expect,test} from 'vitest';
import {GameSocketTransport,MAX_QUEUED_BYTES} from './socket-transport.mjs';

test('queued socket payload survives immediate reuse of Meep packet scratch memory',()=>{
  const queued=[],socket={send:bytes=>queued.push(bytes),addEventListener(){},removeEventListener(){},close(){},readyState:1};
  const transport=new GameSocketTransport({socket}),scratch=new Uint8Array([1,2,3,4]);
  transport.send(scratch,3);scratch.fill(9);transport.send(scratch,2);scratch.fill(0);
  expect(Array.from(queued[0])).toEqual([1,2,3]);expect(Array.from(queued[1])).toEqual([9,9]);expect(transport.getStats().bytes_out).toBe(5);
});

test('a stalled socket closes once before its queued bytes exceed the connection budget',()=>{
  const sent=[],closed=[],socket={send:bytes=>sent.push(bytes),close:(...args)=>closed.push(args),addEventListener(){},removeEventListener(){},readyState:1,bufferedAmount:MAX_QUEUED_BYTES-3};
  const transport=new GameSocketTransport({socket});transport.send(new Uint8Array(4),4);transport.send(new Uint8Array(4),4);
  expect(sent).toHaveLength(0);expect(closed).toEqual([[4001,'Connection too slow; continuing locally']]);
});
