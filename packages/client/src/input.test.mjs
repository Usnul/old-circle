import {expect,test,vi} from 'vitest';
import Signal from '@woosh/meep-engine/src/core/events/signal/Signal.js';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {InputDeviceSwitch} from '@woosh/meep-engine/src/engine/input/devices/InputDeviceSwitch.js';
import {KeyCodes} from '@woosh/meep-engine/src/engine/input/devices/KeyCodes.js';
import {GameInput} from './input.mjs';

async function withInput(check){
  const element=new EventTarget();const classList={add:vi.fn(),remove:vi.fn()};element.classList=classList;
  element.requestPointerLock=()=>Promise.resolve();element.focus=()=>{};
  const document=new EventTarget();document.body=element;document.exitPointerLock=()=>{};
  const window=new EventTarget();vi.stubGlobal('document',document);vi.stubGlobal('window',window);
  const em=new EntityManager(),ecd=new EntityComponentDataset();em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));
  const pointer={buttons:Array.from({length:5},()=>new InputDeviceSwitch()),on:Object.fromEntries(['move','down','wheel'].map(k=>[k,new Signal()]))};
  const keyboard={keys:Object.fromEntries(Object.keys(KeyCodes).map(k=>[k,new InputDeviceSwitch()])),start(){},stop(){}};
  const action=vi.fn(),look=vi.fn();
  const input=new GameInput({devices:{pointer,keyboard},entityManager:em,viewStack:{el:element}},{action,look,captureChanged:()=>{},error:()=>{}});
  try{
    await input.start();await check({input,pointer,keyboard,action,look,element,window,document,classList});
  }finally{await new Promise((resolve,reject)=>em.shutdown(resolve,reject));vi.unstubAllGlobals();}
}

test('native mouse edges survive a complete click between simulation samples and clear when suspended',()=>withInput(({input,pointer})=>{
  pointer.buttons[0].press();pointer.buttons[0].release();expect(input.sample(0).buttons&8).toBe(0);
  input.freeLook=true;pointer.buttons[0].press();pointer.buttons[0].release();expect(input.map.isActive('attack')).toBe(false);expect(input.sample(0).buttons&8).toBe(8);
  input.pending.set('attack',performance.now()-1);expect(input.sample(0).buttons&8).toBe(0);
  pointer.buttons[0].press();expect(input.sample(0).buttons&8).toBe(8);pointer.buttons[0].release();input.suspend(true);expect(input.sample(0).buttons).toBe(0);
  input.suspend(false);input.freeLook=true;expect(input.sample(0).buttons&8).toBe(0);
}));

test('keyboard attacks and camera turning work without mouse capture',()=>withInput(({input,keyboard,look})=>{
  keyboard.keys.f.press();keyboard.keys.f.release();
  expect(input.activeLook).toBeFalsy();expect(input.sample(0).buttons&8).toBe(8);
  input.pending.set('strike',performance.now()-1);expect(input.sample(0).buttons&8).toBe(0);
  keyboard.keys.f.press();expect(input.sample(0).buttons&8).toBe(8);keyboard.keys.f.release();
  keyboard.keys.right_arrow.press();input.update(.1);expect(look).toHaveBeenCalled();keyboard.keys.right_arrow.release();
  input.suspend(true);input.suspend(false);expect(input.sample(0).buttons&8).toBe(0);
}));

test('suspended gameplay ignores menu shortcuts and action pulses',()=>withInput(({input,keyboard,action})=>{
  keyboard.keys.tab.press();keyboard.keys.tab.release();expect(action).toHaveBeenLastCalledWith('journal');
  action.mockClear();input.suspend(true);
  for(const key of ['tab','m','escape','f','q','r','1']){keyboard.keys[key].press();keyboard.keys[key].release();}
  expect(action).not.toHaveBeenCalled();expect(input.pending.size).toBe(0);expect(input.sample(0).buttons).toBe(0);
  input.suspend(false);keyboard.keys.m.press();keyboard.keys.m.release();expect(action).toHaveBeenCalledWith('map');
}));

test('samples carry signed camera pitch with movement, default to level aim, and retain aim while suspended',()=>withInput(({input,keyboard})=>{
  keyboard.keys.w.press();
  const level=input.sample(0);expect(level.pitch).toBe(0);expect(level.z).toBe(-1);
  for(const pitch of [-.45,.4])expect(input.sample(0,pitch)).toEqual({...level,pitch});
  input.suspend(true);
  expect(input.sample(-.2,.4)).toEqual({x:0,z:0,yaw:-.2,pitch:.4,buttons:0});
  expect(input.sample(-.2).pitch).toBe(0);
}));

test('pointer lock denial falls back to free-look capture mode',async()=>withInput(async({input,element})=>{
  const error=vi.fn(),captureChanged=vi.fn();input.captureChanged=captureChanged;input.error=error;
  let reject;
  element.requestPointerLock=()=>new Promise((_,r)=>{reject=r;});
  const capture=input.capture();
  reject(new Error('NotAllowedError'));
  await capture;
  expect(captureChanged).toHaveBeenCalledWith(true);
  expect(error).toHaveBeenCalledTimes(1);
  expect(input.capturePending).toBe(false);
  expect(input.enabled).toBeTruthy();
}));

test('late pointer-lock rejection after suspension stays out of free-look',async()=>withInput(async({input,element})=>{
  let reject;element.requestPointerLock=()=>new Promise((_,r)=>{reject=r;});
  const capture=input.capture();
  input.suspend(true);
  reject(new Error('NotAllowedError'));
  await capture;
  expect(input.freeLook).toBe(false);
  expect(input.capturePending).toBe(false);
  expect(input.enabled).toBe(false);
}));

test('late pointer-lock rejection after blur keeps free-look disabled',async()=>withInput(async({input,element,window})=>{
  let reject;element.requestPointerLock=()=>new Promise((_,r)=>{reject=r;});
  const capture=input.capture();
  window.dispatchEvent(new Event('blur'));
  reject(new Error('NotAllowedError'));
  await capture;
  expect(input.freeLook).toBe(false);
  expect(input.capturePending).toBe(false);
  expect(input.enabled).toBe(true);
}));

test('late pointer-lock success after suspension is ignored and immediately released',async()=>withInput(async({input,element,document})=>{
  let resolve;element.requestPointerLock=()=>new Promise(r=>{resolve=r;});
  const captureChanged=vi.fn();
  const exitPointerLock=vi.fn();document.exitPointerLock=exitPointerLock;
  input.captureChanged=captureChanged;
  const request=input.capture();
  input.suspend(true);
  resolve();
  document.pointerLockElement=element;
  document.dispatchEvent(new Event('pointerlockchange'));
  await request;
  expect(input.freeLook).toBe(false);
  expect(input.capturePending).toBe(false);
  expect(captureChanged).not.toHaveBeenCalledWith(true);
  expect(captureChanged).toHaveBeenCalledWith(false);
  expect(exitPointerLock).toHaveBeenCalled();
}));

test('late pointer-lock success after blur keeps capture disabled',async()=>withInput(async({input,element,window,document})=>{
  let resolve;element.requestPointerLock=()=>new Promise(r=>{resolve=r;});
  const captureChanged=vi.fn();
  const exitPointerLock=vi.fn();document.exitPointerLock=exitPointerLock;
  input.captureChanged=captureChanged;
  const request=input.capture();
  window.dispatchEvent(new Event('blur'));
  resolve();
  document.pointerLockElement=element;
  document.dispatchEvent(new Event('pointerlockchange'));
  await request;
  expect(input.capturePending).toBe(false);
  expect(captureChanged).not.toHaveBeenCalledWith(true);
  expect(captureChanged).toHaveBeenCalledWith(false);
  expect(exitPointerLock).toHaveBeenCalledTimes(1);
}));

test('late pointer-lock success can be discarded and a fresh capture still starts',async()=>withInput(async({input,element,document})=>{
  let staleResolve,freshResolve;
  const exitPointerLock=vi.fn(()=>{document.pointerLockElement=null;});
  input.captureChanged=vi.fn();
  element.requestPointerLock=()=>new Promise((resolve)=>{
    if(!staleResolve){staleResolve=resolve;return;}
    freshResolve=resolve;
  });
  document.exitPointerLock=exitPointerLock;

  const staleCapture=input.capture();
  input.suspend(true);
  staleResolve();
  document.pointerLockElement=element;
  document.dispatchEvent(new Event('pointerlockchange'));
  await staleCapture;

  input.suspend(false);
  const freshCapture=input.capture();
  document.pointerLockElement=document; // not locked yet
  freshResolve();
  document.pointerLockElement=element;
  document.dispatchEvent(new Event('pointerlockchange'));
  await freshCapture;
  expect(input.captureChanged).toHaveBeenCalledTimes(2);
  expect(input.capturePending).toBe(false);
  expect(input.captureChanged).toHaveBeenCalledWith(true);
  expect(exitPointerLock).toHaveBeenCalled();
}));

test('capture() returns immediately while disabled',async()=>withInput(async({input,element})=>{
  input.suspend(true);
  const requestPointerLock=vi.fn(()=>Promise.resolve());
  element.requestPointerLock=requestPointerLock;
  await input.capture();
  expect(requestPointerLock).not.toHaveBeenCalled();
  expect(input.capturePending).toBe(false);
}));
