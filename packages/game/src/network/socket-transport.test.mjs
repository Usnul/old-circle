import {expect,test} from 'vitest';
import {GameSocketTransport} from './socket-transport.mjs';

test('queued socket payload survives immediate reuse of Meep packet scratch memory',()=>{
  const queued=[],socket={send:bytes=>queued.push(bytes),addEventListener(){},removeEventListener(){},close(){},readyState:1};
  const transport=new GameSocketTransport({socket}),scratch=new Uint8Array([1,2,3,4]);
  transport.send(scratch,3);scratch.fill(9);transport.send(scratch,2);scratch.fill(0);
  expect(Array.from(queued[0])).toEqual([1,2,3]);expect(Array.from(queued[1])).toEqual([9,9]);expect(transport.getStats().bytes_out).toBe(5);
});
