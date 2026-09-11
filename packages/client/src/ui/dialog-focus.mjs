const focusSelector='button, a[href], input, select, textarea, [tabindex]';

/** Native dialogs make the background inert, but browsers may still tab to
 * their chrome. Wrap the menu's edges and retain native navigation inside it. */
export function trapDialogFocus(event,dialog){
  if(event.key!=='Tab')return;
  const controls=[...dialog.querySelectorAll(focusSelector)].filter(el=>
    el.tabIndex>=0&&!el.matches(':disabled')&&el.getClientRects().length>0);
  const index=controls.indexOf(dialog.ownerDocument.activeElement);
  let target;
  if(!controls.length)target=dialog.querySelector('h2')??dialog;
  else if(index<0)target=event.shiftKey?controls.at(-1):controls[0];
  else if(event.shiftKey&&index===0)target=controls.at(-1);
  else if(!event.shiftKey&&index===controls.length-1)target=controls[0];
  if(target){event.preventDefault();target.focus();}
}
