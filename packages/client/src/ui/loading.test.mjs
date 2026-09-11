import {expect,test,vi} from 'vitest';
import Signal from '@woosh/meep-engine/src/core/events/signal/Signal.js';
import {LoadingScreen} from './loading.mjs';

function fixture(){
  let complete,reject;
  const animation={finished:new Promise((resolve,fail)=>{complete=resolve;reject=fail;}),cancel:vi.fn(()=>reject(new Error('cancelled')))};
  const progress={style:{width:'100%'}};
  const postRender=new Signal();
  const element={hidden:true,style:{},animate:vi.fn(()=>animation),querySelector:vi.fn(()=>progress)};
  const engine={renderingEnabled:false,graphics:{on:{postRender,contextLost:new Signal(),contextFailed:new Signal()}}};
  return {loading:new LoadingScreen(element),engine,element,postRender,animation,complete,progress};
}

test('keeps the card visible until three world renders and the fade finish',async()=>{
  const f=fixture();f.loading.show();
  expect(f.element.hidden).toBe(false);expect(f.engine.renderingEnabled).toBe(false);
  expect(f.progress.style.width).toBe('0%');
  const revealed=f.loading.reveal(f.engine);
  expect(f.engine.renderingEnabled).toBe(true);
  await Promise.resolve();expect(f.element.animate).not.toHaveBeenCalled();
  for(let i=0;i<2;i++){f.postRender.dispatch();expect(f.element.animate).not.toHaveBeenCalled();}
  f.postRender.dispatch();expect(f.element.animate).toHaveBeenCalledOnce();
  expect(f.element.animate.mock.calls[0][0]).toEqual([{opacity:1},{opacity:0}]);
  expect(f.element.hidden).toBe(false);
  f.postRender.dispatch();expect(f.element.animate).toHaveBeenCalledOnce();
  f.complete();expect(await revealed).toBe(true);expect(f.element.hidden).toBe(true);
});

test('new load attempts clear stale progress to 0, while reveal preserves completed progress',async()=>{
  const f=fixture();
  f.progress.style.width='100%';
  f.loading.show();
  expect(f.progress.style.width).toBe('0%');

  f.progress.style.width='100%';
  const revealed=f.loading.reveal(f.engine);
  expect(f.progress.style.width).toBe('100%');
  for(let i=0;i<3;i++)f.postRender.dispatch();
  expect(f.element.animate).toHaveBeenCalledOnce();
  expect(f.progress.style.width).toBe('100%');
  f.complete();
  expect(await revealed).toBe(true);
});

test('an error during warmup leaves a solid card and prevents a later reveal',async()=>{
  const f=fixture(),revealed=f.loading.reveal(f.engine);
  f.postRender.dispatch();f.loading.show();
  expect(await revealed).toBe(false);expect(f.engine.renderingEnabled).toBe(false);
  for(let i=0;i<4;i++)f.postRender.dispatch();
  expect(f.element.animate).not.toHaveBeenCalled();expect(f.element.hidden).toBe(false);
});

test('an error during the fade cancels it and cannot hide the error backdrop',async()=>{
  const f=fixture(),revealed=f.loading.reveal(f.engine);
  for(let i=0;i<3;i++)f.postRender.dispatch();
  f.loading.show();expect(await revealed).toBe(false);
  expect(f.animation.cancel).toHaveBeenCalledOnce();expect(f.engine.renderingEnabled).toBe(false);
  await Promise.resolve();expect(f.element.hidden).toBe(false);
});

test.each(['contextLost','contextFailed'])('a graphics %s cannot count failed draws or strand the loading card',async signal=>{
  const f=fixture(),revealed=f.loading.reveal(f.engine);
  f.engine.graphics.on[signal].dispatch({message:'Graphics unavailable'});
  for(let i=0;i<3;i++)f.postRender.dispatch();
  await expect(revealed).rejects.toThrow('Graphics unavailable');
  expect(f.element.animate).not.toHaveBeenCalled();expect(f.element.hidden).toBe(false);
  expect(f.engine.renderingEnabled).toBe(false);
});
