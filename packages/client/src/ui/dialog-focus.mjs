const focusSelector='button, a[href], input, select, textarea, [tabindex]';
const editableSelector='input, select, textarea, [contenteditable]:not([contenteditable="false"])';

function dialogControls(dialog){
  return [...dialog.querySelectorAll(focusSelector)].filter(el=>
    el.tabIndex>=0&&!el.matches(':disabled')&&el.getClientRects().length>0);
}

function adjacentControl(dialog,controls,backward){
  const active=dialog.ownerDocument.activeElement,index=controls.indexOf(active);
  if(index>=0)return controls[(index+(backward?-1:1)+controls.length)%controls.length];
  // Equipment refreshes focus its article. Continue from that document position
  // even though the article itself is not part of the tab order.
  const ordered=backward?[...controls].reverse():controls;
  return ordered.find(control=>(active?.compareDocumentPosition?.(control)??0)&(backward?2:4))??ordered[0];
}

/** Menu shortcuts stay local so dismissing a menu cannot reopen it through
 * the body's gameplay key listener. Journal uses arrows when Tab is its toggle. */
export function handleDialogKeydown(event,dialog,{shortcut,close}={}){
  event.stopPropagation();
  // Escape can open the journal through gameplay input. Its held repeats must
  // not immediately trigger the native dialog cancellation.
  if(event.key==='Escape'&&event.repeat){event.preventDefault();return;}
  const unmodified=!event.ctrlKey&&!event.altKey&&!event.metaKey;
  const editing=event.target?.closest?.(editableSelector);
  if(unmodified&&shortcut&&event.key.toLowerCase()===shortcut.toLowerCase()
    &&!(shortcut==='Tab'&&event.shiftKey)&&(shortcut==='Tab'||!editing)){
    event.preventDefault();
    if(!event.repeat)close();
    return;
  }
  if(unmodified&&!event.shiftKey&&shortcut==='Tab'&&!editing&&['ArrowDown','ArrowUp'].includes(event.key)){
    event.preventDefault();
    const controls=dialogControls(dialog);
    const target=adjacentControl(dialog,controls,event.key==='ArrowUp')??dialog.querySelector('h2')??dialog;
    target.focus();
    return;
  }
  trapDialogFocus(event,dialog);
}

/** Native dialogs make the background inert, but browsers may still tab to
 * their chrome. Wrap the menu's edges and retain native navigation inside it. */
export function trapDialogFocus(event,dialog){
  if(event.key!=='Tab'||event.ctrlKey||event.altKey||event.metaKey)return;
  const controls=dialogControls(dialog);
  const index=controls.indexOf(dialog.ownerDocument.activeElement);
  let target;
  if(!controls.length)target=dialog.querySelector('h2')??dialog;
  else if(index<0)target=adjacentControl(dialog,controls,event.shiftKey);
  else if(event.shiftKey&&index===0)target=controls.at(-1);
  else if(!event.shiftKey&&index===controls.length-1)target=controls[0];
  if(target){event.preventDefault();target.focus();}
}
