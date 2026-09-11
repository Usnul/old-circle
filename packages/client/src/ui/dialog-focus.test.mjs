import {expect,test,vi} from 'vitest';
import {trapDialogFocus} from './dialog-focus.mjs';

function fixture(){
  const doc={activeElement:null};
  const node=(options={})=>({tabIndex:0,matches:()=>false,getClientRects:()=>[{}],focus:vi.fn(function(){doc.activeElement=this;}),...options});
  const first=node(),last=node(),heading=node({tabIndex:-1});
  const controls=[first,last];
  const dialog={ownerDocument:doc,querySelectorAll:()=>controls,querySelector:()=>heading,focus:vi.fn()};
  const key=(shiftKey=false,key='Tab')=>{const event={key,shiftKey,preventDefault:vi.fn()};trapDialogFocus(event,dialog);return event;};
  return {doc,node,first,last,heading,controls,dialog,key};
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
