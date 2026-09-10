import {expect,test} from 'vitest';
import {JourneyStore} from './journey-store.mjs';

const character={version:1,level:7,embers:450,inventory:{weapons:['sword','staff']}};
function storageFixture(){
  const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
}
const createId=()=> 'new-pilgrim-id';

test('saved characters and their identity survive a new page session',()=>{
  const storage=storageFixture(),first=new JourneyStore({getStorage:()=>storage,createId});
  expect(first.save(character)).toBe(true);
  const second=new JourneyStore({getStorage:()=>storage,createId:()=> 'different-pilgrim'});
  expect(second.playerId).toBe(first.playerId);expect(second.character).toEqual(character);expect(second.warning).toBe('');
});

test('denied storage access still supplies a stable identity and keeps this tab’s latest character',()=>{
  const store=new JourneyStore({getStorage:()=>{throw new DOMException('Denied','SecurityError');},createId});
  expect(store.playerId).toBe('new-pilgrim-id');expect(store.character).toBeNull();expect(store.warning).toContain('unavailable');
  const latest=structuredClone(character);expect(store.save(latest)).toBe(false);latest.embers=0;
  expect(store.character.embers).toBe(450);expect(store.playerId).toBe('new-pilgrim-id');
});

test('quota failure preserves the last disk save and retries the latest character when space returns',()=>{
  const storage=storageFixture(),store=new JourneyStore({getStorage:()=>storage,createId});store.save(character);
  const write=storage.setItem;storage.setItem=(key,value)=>{if(key==='old-circle-character-v1')throw new DOMException('Full','QuotaExceededError');write(key,value);};
  const latest={...character,embers:900};expect(store.save(latest)).toBe(false);expect(store.character).toEqual(latest);
  expect(JSON.parse(storage.data.get('old-circle-character-v1'))).toEqual(character);
  storage.setItem=write;expect(store.save(store.character)).toBe(true);expect(store.warning).toBe('');
  expect(new JourneyStore({getStorage:()=>storage,createId}).character).toEqual(latest);
});

test('storage becoming available persists the same identity used during temporary play',()=>{
  const storage=storageFixture();let allowed=false;
  const store=new JourneyStore({getStorage:()=>{if(!allowed)throw new Error('Denied');return storage;},createId});
  store.save(character);allowed=true;expect(store.save(store.character)).toBe(true);
  expect(new JourneyStore({getStorage:()=>storage,createId:()=> 'another-id'}).playerId).toBe('new-pilgrim-id');
});

test('an empty autosave cannot replace the last valid character',()=>{
  const storage=storageFixture(),store=new JourneyStore({getStorage:()=>storage,createId});store.save(character);
  expect(store.save(null)).toBe(false);expect(store.character).toEqual(character);
  expect(new JourneyStore({getStorage:()=>storage,createId}).character).toEqual(character);
});

test.each(['{','null','42','{"version":2}'])('an unreadable save %s is preserved until a new journey is deliberately saved',raw=>{
  const storage=storageFixture();storage.data.set('old-circle-character-v1',raw);
  const store=new JourneyStore({getStorage:()=>storage,createId});
  expect(store.character).toBeNull();expect(store.warning).toContain('could not be read');
  expect(storage.data.get('old-circle-character-v1')).toBe(raw);
  expect(store.save(character)).toBe(true);expect(store.warning).toBe('');
});
