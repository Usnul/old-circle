import {expect,test,vi} from 'vitest';
import {handleDialogKeydown,trapDialogFocus} from './dialog-focus.mjs';

function fixture(){
  const doc={activeElement:null},order=[];
  const node=(options={})=>({tabIndex:0,matches:()=>false,getClientRects:()=>[{}],focus:vi.fn(function(){doc.activeElement=this;}),compareDocumentPosition(other){const a=order.indexOf(this),b=order.indexOf(other);return a<0||b<0?1:a===b?0:b>a?4:2;},...options});
  const first=node(),last=node(),heading=node({tabIndex:-1});
  order.push(heading,first,last);
  const controls=[first,last];
  const dialog={ownerDocument:doc,querySelectorAll:()=>controls,querySelector:()=>heading,focus:vi.fn()};
  const key=(shiftKey=false,key='Tab')=>{const event={key,shiftKey,preventDefault:vi.fn()};trapDialogFocus(event,dialog);return event;};
  return {doc,node,first,last,heading,controls,dialog,key,order};
}

function menuKey(f,key,shortcut,close,options={}){
  const event={key,preventDefault:vi.fn(),stopPropagation:vi.fn(),...options};
  handleDialogKeydown(event,f.dialog,{shortcut,close});
  return event;
}

test('Tab and reverse Tab wrap menu edges and scroll the target into view',()=>{
  const f=fixture();f.doc.activeElement=f.last;
  expect(f.key().preventDefault).toHaveBeenCalled();expect(f.first.focus).toHaveBeenCalledWith();
  expect(f.key(true).preventDefault).toHaveBeenCalled();expect(f.doc.activeElement).toBe(f.last);
});
test('heading and focus outside the control list enter the correct edge',()=>{
  const f=fixture();f.doc.activeElement=f.heading;f.key(true);expect(f.doc.activeElement).toBe(f.last);
  f.doc.activeElement=f.heading;f.key();expect(f.doc.activeElement).toBe(f.first);
});
test('hidden, disabled and negative-tabindex controls do not become wrap targets',()=>{
  const f=fixture();f.controls.push(f.node({tabIndex:-1}),f.node({matches:()=>true}),f.node({getClientRects:()=>[]}));
  f.doc.activeElement=f.first;f.key(true);expect(f.doc.activeElement).toBe(f.last);
});
test('ordinary interior navigation and other keys retain native behavior',()=>{
  const f=fixture(),middle=f.node();f.controls.splice(1,0,middle);f.doc.activeElement=middle;
  expect(f.key().preventDefault).not.toHaveBeenCalled();expect(f.key(true).preventDefault).not.toHaveBeenCalled();
  expect(f.key(false,'Escape').preventDefault).not.toHaveBeenCalled();expect(f.doc.activeElement).toBe(middle);
});
test('a dialog without enabled controls retains focus on its heading or itself',()=>{
  const f=fixture();f.controls.length=0;expect(f.key().preventDefault).toHaveBeenCalled();expect(f.doc.activeElement).toBe(f.heading);
  f.dialog.querySelector=()=>null;f.key(true);expect(f.dialog.focus).toHaveBeenCalled();
});

test('the map shortcut closes from a focused control without reaching gameplay',()=>{
  const f=fixture(),close=vi.fn();f.doc.activeElement=f.last;
  const event=menuKey(f,'M','m',close);
  expect(close).toHaveBeenCalledTimes(1);expect(event.preventDefault).toHaveBeenCalled();
  expect(event.stopPropagation.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
  menuKey(f,'Escape','m',close);expect(close).toHaveBeenCalledTimes(1);
});

test('holding a menu shortcut cannot immediately dismiss the menu it opened',()=>{
  for(const shortcut of ['m','Tab']){
    const f=fixture(),close=vi.fn();
    const event=menuKey(f,shortcut,shortcut,close,{repeat:true});
    expect(close).not.toHaveBeenCalled();expect(event.preventDefault).toHaveBeenCalled();
    menuKey(f,shortcut,shortcut,close);expect(close).toHaveBeenCalledTimes(1);
  }
});

test('held Escape cannot natively cancel the journal opened by the same press',()=>{
  const f=fixture(),close=vi.fn();
  expect(menuKey(f,'Escape','Tab',close,{repeat:true}).preventDefault).toHaveBeenCalled();
  expect(menuKey(f,'Escape','Tab',close).preventDefault).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

test('journal Tab dismisses from its heading or any focused control',()=>{
  const f=fixture(),close=vi.fn();
  for(const target of [f.heading,f.first,f.last]){
    f.doc.activeElement=target;
    expect(menuKey(f,'Tab','Tab',close).preventDefault).toHaveBeenCalled();
    expect(f.doc.activeElement).toBe(target);
  }
  expect(close).toHaveBeenCalledTimes(3);
});

test('journal arrows and reverse Tab retain keyboard access to every control',()=>{
  const f=fixture(),close=vi.fn(),middle=f.node();f.controls.splice(1,0,middle);f.order.splice(2,0,middle);f.doc.activeElement=f.heading;
  menuKey(f,'ArrowDown','Tab',close);expect(f.doc.activeElement).toBe(f.first);
  menuKey(f,'ArrowDown','Tab',close);expect(f.doc.activeElement).toBe(middle);
  menuKey(f,'ArrowDown','Tab',close,{repeat:true});expect(f.doc.activeElement).toBe(f.last);
  menuKey(f,'ArrowDown','Tab',close);expect(f.doc.activeElement).toBe(f.first);
  menuKey(f,'ArrowUp','Tab',close);expect(f.doc.activeElement).toBe(f.last);
  f.doc.activeElement=f.first;menuKey(f,'Tab','Tab',close,{shiftKey:true});expect(f.doc.activeElement).toBe(f.last);
  f.doc.activeElement=f.heading;menuKey(f,'ArrowUp','Tab',close);expect(f.doc.activeElement).toBe(f.last);
  expect(close).not.toHaveBeenCalled();
});

test('journal arrow navigation skips unavailable controls and handles empty menus',()=>{
  const f=fixture(),close=vi.fn();f.doc.activeElement=f.last;
  f.controls.push(f.node({tabIndex:-1}),f.node({matches:()=>true}),f.node({getClientRects:()=>[]}));
  menuKey(f,'ArrowDown','Tab',close);expect(f.doc.activeElement).toBe(f.first);
  f.controls.length=0;menuKey(f,'ArrowDown','Tab',close);expect(f.doc.activeElement).toBe(f.heading);
  f.dialog.querySelector=()=>null;menuKey(f,'ArrowUp','Tab',close);expect(f.dialog.focus).toHaveBeenCalled();
});

test('equipment refresh preserves document position for arrows and reverse Tab',()=>{
  const f=fixture(),close=vi.fn(),article=f.node({tabIndex:-1}),reinforce=f.node();
  f.order.splice(2,0,article,reinforce);f.controls.splice(1,0,article,reinforce);
  f.doc.activeElement=article;menuKey(f,'ArrowDown','Tab',close);expect(f.doc.activeElement).toBe(reinforce);
  f.doc.activeElement=article;menuKey(f,'ArrowUp','Tab',close);expect(f.doc.activeElement).toBe(f.first);
  f.doc.activeElement=article;menuKey(f,'Tab','Tab',close,{shiftKey:true});expect(f.doc.activeElement).toBe(f.first);
  f.doc.activeElement=article;f.key();expect(f.doc.activeElement).toBe(reinforce);
  expect(close).not.toHaveBeenCalled();
});

test('equipment navigation skips disabled actions after a restored article',()=>{
  const f=fixture(),close=vi.fn(),article=f.node({tabIndex:-1}),disabled=f.node({matches:()=>true});
  f.order.splice(2,0,article,disabled);f.controls.splice(1,0,article,disabled);
  f.doc.activeElement=article;menuKey(f,'ArrowDown','Tab',close);expect(f.doc.activeElement).toBe(f.last);
  f.order.push(article);f.order.splice(2,1);
  f.doc.activeElement=article;menuKey(f,'ArrowDown','Tab',close);expect(f.doc.activeElement).toBe(f.first);
});

test('map and ordinary dialogs retain normal Tab navigation and native Escape dismissal',()=>{
  const f=fixture(),close=vi.fn();
  for(const shortcut of ['m',undefined]){
    f.doc.activeElement=f.last;
    menuKey(f,'Tab',shortcut,close);expect(f.doc.activeElement).toBe(f.first);
    expect(menuKey(f,'Escape',shortcut,close).preventDefault).not.toHaveBeenCalled();
    expect(menuKey(f,'ArrowDown',shortcut,close).preventDefault).not.toHaveBeenCalled();
  }
  expect(close).not.toHaveBeenCalled();
});

test('modified shortcuts and typing retain native behavior',()=>{
  const f=fixture(),close=vi.fn();f.doc.activeElement=f.last;
  for(const modifier of ['ctrlKey','altKey','metaKey']){
    expect(menuKey(f,'m','m',close,{[modifier]:true}).preventDefault).not.toHaveBeenCalled();
    expect(menuKey(f,'Tab','Tab',close,{[modifier]:true}).preventDefault).not.toHaveBeenCalled();
  }
  const target={closest:()=>({})};
  expect(menuKey(f,'m','m',close,{target}).preventDefault).not.toHaveBeenCalled();
  expect(menuKey(f,'ArrowDown','Tab',close,{target}).preventDefault).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();expect(f.doc.activeElement).toBe(f.last);
});
