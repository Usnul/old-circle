import {expect,test,vi} from 'vitest';
import Signal from '@woosh/meep-engine/src/core/events/signal/Signal.js';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {InputDeviceSwitch} from '@woosh/meep-engine/src/engine/input/devices/InputDeviceSwitch.js';
import {KeyCodes} from '@woosh/meep-engine/src/engine/input/devices/KeyCodes.js';
import {GameInput} from './input.mjs';

test('native mouse edges survive a complete click between simulation samples and clear when suspended',async()=>{
  const element=new EventTarget();element.classList={remove(){}};
  const document=new EventTarget();document.body=element;document.exitPointerLock=()=>{};
  vi.stubGlobal('document',document);vi.stubGlobal('window',new EventTarget());
  const em=new EntityManager(),ecd=new EntityComponentDataset();em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));
  const pointer={buttons:Array.from({length:5},()=>new InputDeviceSwitch()),on:Object.fromEntries(['move','down','wheel'].map(k=>[k,new Signal()]))};
  const keyboard={keys:Object.fromEntries(Object.keys(KeyCodes).map(k=>[k,new InputDeviceSwitch()])),start(){},stop(){}};
  const input=new GameInput({devices:{pointer,keyboard},entityManager:em,viewStack:{el:element}},{action(){},look(){},captureChanged(){},error(){}});
  try{
    await input.start();pointer.buttons[0].press();pointer.buttons[0].release();expect(input.sample(0).buttons&8).toBe(0);
    input.freeLook=true;pointer.buttons[0].press();pointer.buttons[0].release();expect(input.map.isActive('attack')).toBe(false);expect(input.sample(0).buttons&8).toBe(8);
    input.pending.set('attack',performance.now()-1);expect(input.sample(0).buttons&8).toBe(0);
    pointer.buttons[0].press();expect(input.sample(0).buttons&8).toBe(8);pointer.buttons[0].release();input.suspend(true);expect(input.sample(0).buttons).toBe(0);
    input.suspend(false);input.freeLook=true;expect(input.sample(0).buttons&8).toBe(0);
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));vi.unstubAllGlobals();}
});
