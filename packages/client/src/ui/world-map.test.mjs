import {afterEach,beforeEach,expect,test,vi} from 'vitest';

let installMapControls;
beforeEach(async()=>{
  vi.resetModules();
  ({installMapControls}=await import('./world-map.mjs'));
});
afterEach(()=>vi.unstubAllGlobals());

function mount(player={x:0,z:23},rect={width:480,height:640}){
  const attributes=new Map(),classes=new Set();
  let onResize;
  const observe=vi.fn(),disconnect=vi.fn();
  vi.stubGlobal('ResizeObserver',class{constructor(callback){onResize=callback;}observe=observe;disconnect=disconnect;});
  const svg={
    setAttribute:(name,value)=>attributes.set(name,value),
    getBoundingClientRect:()=>rect,
    style:{setProperty:vi.fn()},
    classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},
    focus:vi.fn(),setPointerCapture:vi.fn(),
  };
  const controls=Object.fromEntries(['in','out','all','you'].map(name=>[name,{}]));
  vi.stubGlobal('document',{querySelector:selector=>selector==='#world-map'?svg:controls[selector.slice(5)]});
  const cleanup=installMapControls(()=>player);
  const pointer=(type,options={})=>{
    const event={button:0,pointerId:1,clientX:200,clientY:200,preventDefault:vi.fn(),...options};
    svg[`onpointer${type}`](event);return event;
  };
  return {svg,player,classes,controls,pointer,cleanup,observe,disconnect,resize:next=>{rect=next;onResize();},box:()=>attributes.get('viewBox').split(' ').map(Number)};
}

test('first opening shows the player and nearby places at the Find me zoom',()=>{
  const f=mount();
  expect(f.box()).toEqual([144,375,192,256]);
  expect(f.classes.has('map-close')).toBe(true);
  f.controls.you.onclick();expect(f.box()).toEqual([144,375,192,256]);
});

test('reopening preserves explored zoom and pan even after the player moves',()=>{
  const f=mount();f.controls.in.onclick();
  f.pointer('down');f.pointer('move',{clientX:260,clientY:150});f.pointer('up');
  const explored=f.box();
  expect(explored).not.toEqual([144,375,192,256]);
  const reopened=mount({x:-100,z:-200});expect(reopened.box()).toEqual(explored);
  reopened.player.x=50;reopened.player.z=-120;
  reopened.controls.you.onclick();expect(reopened.box()).toEqual([194,232,192,256]);
});

test('All lands remains available and is preserved on reopening',()=>{
  const f=mount();f.controls.all.onclick();expect(f.box()).toEqual([0,0,480,640]);
  expect(f.classes.has('map-close')).toBe(false);
  const reopened=mount();expect(reopened.box()).toEqual([0,0,480,640]);
  reopened.controls.you.onclick();expect(reopened.box()).toEqual([144,375,192,256]);
});

test.each([
  [{x:-240,z:-480},[0,0,192,256]],
  [{x:240,z:160},[288,384,192,256]],
])('the initial view stays inside the map near world edges: %j',(player,box)=>{
  expect(mount(player).box()).toEqual(box);
});

test('dragging suppresses native selection, focuses the map and retains keyboard panning',()=>{
  const f=mount(),down=f.pointer('down');
  expect(down.preventDefault).toHaveBeenCalledOnce();
  expect(f.svg.focus).toHaveBeenCalledWith({preventScroll:true});
  expect(f.svg.setPointerCapture).toHaveBeenCalledWith(1);
  f.pointer('move',{clientX:250,clientY:250});expect(f.box()).toEqual([124,355,192,256]);
  f.pointer('up');
  f.pointer('move',{clientX:300});expect(f.box()).toEqual([124,355,192,256]);
  const key={key:'ArrowRight',preventDefault:vi.fn()};f.svg.onkeydown(key);
  expect(key.preventDefault).toHaveBeenCalledOnce();expect(f.box()).toEqual([136,355,192,256]);
});

test('secondary buttons and other pointers cannot start or take over a map drag',()=>{
  const f=mount(),original=f.box();
  expect(f.pointer('down',{button:2}).preventDefault).not.toHaveBeenCalled();
  f.pointer('move',{clientX:300});expect(f.box()).toEqual(original);
  f.pointer('down');f.pointer('down',{pointerId:2,clientX:300});
  f.pointer('move',{pointerId:2,clientX:350});f.pointer('up',{pointerId:2});
  expect(f.box()).toEqual(original);
  f.pointer('move',{clientX:250});expect(f.box()).toEqual([124,375,192,256]);
});

test.each(['pointercancel','lostpointercapture'])('%s ends the active drag',event=>{
  const f=mount();f.pointer('down');f.svg[`on${event}`]({pointerId:1});
  f.pointer('move',{clientX:300});expect(f.box()).toEqual([144,375,192,256]);
  f.pointer('down');f.pointer('move',{clientX:250});expect(f.box()).toEqual([124,375,192,256]);
});

test('a landscape viewport expands the visible area without shrinking the nearby map',()=>{
  const f=mount(undefined,{width:1200,height:800});
  expect(f.box()).toEqual([48,375,384,256]);
  expect(f.svg.style.setProperty).toHaveBeenLastCalledWith('--map-label','3.84px');
  f.controls.all.onclick();expect(f.box()).toEqual([-240,0,960,640]);
  const reopened=mount(undefined,{width:1200,height:800});expect(reopened.box()).toEqual([-240,0,960,640]);
});

test('landscape dragging follows the pointer at the rendered map scale',()=>{
  const f=mount(undefined,{width:1200,height:800});
  f.pointer('down');f.pointer('move',{clientX:250,clientY:250});
  expect(f.box()).toEqual([32,359,384,256]);
  f.pointer('up');f.controls.all.onclick();
  f.pointer('down');f.pointer('move',{clientX:300,clientY:300});
  expect(f.box()).toEqual([-240,0,960,640]);
});

test('resizing retains the explored zoom and center and cancels a stale drag',()=>{
  const f=mount();f.controls.in.onclick();
  f.pointer('down');f.pointer('move',{clientX:275,clientY:275});f.pointer('up');
  expect(f.box()[0]+f.box()[2]/2).toBe(220);
  f.pointer('down');f.resize({width:1200,height:800});
  const resized=f.box();
  expect(resized[0]).toBe(92);expect(resized[2]).toBe(256);
  expect(resized[1]+resized[3]/2).toBe(483);
  f.pointer('move',{clientX:350,clientY:350});expect(f.box()).toEqual(resized);
  expect(f.observe).toHaveBeenCalledWith(f.svg);
  f.cleanup();expect(f.disconnect).toHaveBeenCalledOnce();
});

test('a viewport wider than the world centers it until zooming makes horizontal panning possible',()=>{
  const f=mount(undefined,{width:1600,height:640}),box=f.box();
  expect(box).toEqual([-80,375,640,256]);
  f.pointer('down');f.pointer('move',{clientX:300});f.pointer('up');
  expect(f.box()).toEqual(box);
  f.controls.in.onclick();
  expect(f.box()[2]).toBeLessThan(480);
  f.pointer('down');f.pointer('move',{clientX:225});
  expect(f.box()[0]+f.box()[2]/2).toBeCloseTo(240-25/3.75);
});
