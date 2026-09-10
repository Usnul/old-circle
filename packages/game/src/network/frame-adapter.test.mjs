import {expect,test} from 'vitest';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {FrameAdapter} from './frame-adapter.mjs';
import {readRecord} from './record-codec.mjs';
import {Actor} from '../simulation/components.mjs';
import {projectWorld} from './interest.mjs';

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

test('packed records preserve exact numeric limits, Unicode and unknown fields without altering component prototypes',()=>{
  class Frame{}const adapter=new FrameAdapter(Frame),buffer=new BinaryBuffer();
  const value={values:[0,1,-1,4294967295,-4294967295,4294967296,Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER,Math.PI,Number.MIN_VALUE,1e250],title:'The keeper’s flame ✦ 雪',future:{ready:true,empty:null},absent:undefined};
  Object.defineProperty(value,'__proto__',{value:{safe:'ordinary data'},enumerable:true});adapter.serialize(buffer,value);buffer.position=0;
  const result=new Frame();adapter.deserialize(buffer,result);expect(result).toEqual(JSON.parse(JSON.stringify(value)));expect(Object.getPrototypeOf(result)).toBe(Frame.prototype);
  expect(()=>adapter.serialize(new BinaryBuffer(),{invalid:Infinity})).toThrow('Non-finite');
});

test('packed records reject hostile collection sizes, excessive depth, unknown tags and trailing bytes',()=>{
  const oversized=new BinaryBuffer();oversized.writeUint8(8);oversized.writeUintVar(1000000);const end=oversized.position;oversized.position=0;
  expect(()=>readRecord(oversized,end)).toThrow('budget');
  const unknown=new BinaryBuffer();unknown.writeUint8(255);unknown.position=0;expect(()=>readRecord(unknown,1)).toThrow('Unknown');
  const extra=new BinaryBuffer();extra.writeUint8(0);extra.writeUint8(0);extra.position=0;expect(()=>readRecord(extra,2)).toThrow('Trailing');
  let deep={};for(let i=0;i<40;i++)deep={child:deep};expect(()=>new FrameAdapter(Object).serialize(new BinaryBuffer(),deep)).toThrow('structure budget');
  const overflow=new BinaryBuffer();overflow.fromArrayBuffer(new Uint8Array([3,255,255,255,255,15]).buffer);expect(()=>readRecord(overflow,6)).toThrow('integer');
});

test('a saturated recipient snapshot stays below the native fragment receiver budget',()=>{
  const actors=Array.from({length:120},(_,i)=>Object.assign(new Actor(),{id:`actor-${i}`,name:`Roadbound ${i}`,x:Math.sin(i)*70,y:3.1,z:Math.cos(i)*50,path:Array.from({length:200},(_,j)=>[j,Math.sin(j),j*.7])}));
  actors.unshift(Object.assign(new Actor(),{id:'you',kind:'player',x:0,y:3,z:0}));
  const projectiles=Array.from({length:180},(_,id)=>({id,owner:`actor-${id%40}`,position:[Math.sin(id)*40,4,Math.cos(id)*40],age:id/37,life:4,velocity:[3.1,0,-19.6],hitIds:[]}));
  const events=Array.from({length:180},(_,tick)=>({tick,id:`actor-${tick%40}`,position:[5,4,6],type:'hit',amount:17.4}));
  const snapshot=projectWorld({version:1,contentVersion:4,tick:900,time:17.3,actors,projectiles,events},'you'),buffer=new BinaryBuffer();
  new FrameAdapter(Object).serialize(buffer,{snapshot});expect(snapshot.actors).toHaveLength(96);expect(snapshot.projectiles).toHaveLength(128);expect(buffer.position).toBeLessThan(48*1024);
});
