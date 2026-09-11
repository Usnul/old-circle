import {expect,test} from 'vitest';
import {PresentationEvents} from './presentation-events.mjs';

const hit=(tick,key=`hit:${tick}`)=>({type:'hit',id:'self',tick,key,damage:26,position:[0,1,23]});
const snapshot=(tick,events=[],presentationEpoch=1)=>({tick,events,presentationEpoch});

test('initial and reconnected state consume history silently, including events received later from before entry',()=>{
  const events=new PresentationEvents();
  expect(events.read(snapshot(100,[hit(95),hit(100)]))).toEqual([]);
  expect(events.read(snapshot(101,[hit(95),hit(99,'late-history'),hit(100)]))).toEqual([]);
  expect(events.read(snapshot(102,[hit(102)]))).toEqual([hit(102)]);
  expect(events.read(snapshot(102,[hit(102)]))).toEqual([]);
  expect(events.read(snapshot(800,[hit(795),hit(800)],2))).toEqual([]);
  expect(events.read(snapshot(801,[hit(799,'late-reconnect'),hit(801)],2))).toEqual([hit(801)]);
  // Switching back to local simulation establishes another baseline, even at a lower tick.
  expect(events.read(snapshot(50,[hit(50)],3))).toEqual([]);
  expect(events.read(snapshot(51,[hit(51)],3))).toEqual([hit(51)]);
});

test('late genuine hits after entry still play once, without requiring a health change',()=>{
  const events=new PresentationEvents();events.read(snapshot(100));events.read(snapshot(110));
  expect(events.read(snapshot(111,[hit(105)]))).toEqual([hit(105)]);
  expect(events.read(snapshot(112,[hit(105),hit(112)]))).toEqual([hit(112)]);
});

test('history remains suppressed after its key is evicted from the bounded seen set',()=>{
  const events=new PresentationEvents();events.read(snapshot(100,[hit(99)]));
  const many=Array.from({length:2100},(_,i)=>hit(101+i));
  expect(events.read(snapshot(2200,many))).toHaveLength(2100);expect(events.seen.size).toBe(2048);
  expect(events.read(snapshot(2201,[hit(99)]))).toEqual([]);
});
