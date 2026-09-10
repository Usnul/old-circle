const equal=(a,b)=>a===b||(typeof a==='object'&&typeof b==='object'&&JSON.stringify(a)===JSON.stringify(b));

function recordChanges(before,after){
  const old=new Map(before.map(a=>[a.id,a])),changes=[];
  for(const record of after){
    const prior=old.get(record.id);old.delete(record.id);
    if(!prior){changes.push({id:record.id,create:record});continue;}
    const set={},unset=[];
    for(const [key,value] of Object.entries(record))if(!equal(prior[key],value)){if(value===undefined)unset.push(key);else set[key]=value;}
    for(const key of Object.keys(prior))if(!Object.hasOwn(record,key))unset.push(key);
    if(Object.keys(set).length||unset.length)changes.push({id:record.id,set,unset});
  }
  return {changes,removed:[...old.keys()]};
}

export function worldPatch(before,after,{replace=false}={}){
  if(replace)return {tick:after.tick,snapshot:after};
  const patch={fromTick:before.tick,tick:after.tick,time:after.time,actors:recordChanges(before.actors,after.actors),projectiles:recordChanges(before.projectiles??[],after.projectiles??[])};
  if(!equal(before.events,after.events))patch.events=after.events;
  return patch;
}

function applyRecords(records,patch){
  const current=new Map(records.map(a=>[a.id,a]));
  for(const id of patch.removed)current.delete(id);
  for(const change of patch.changes){
    if(change.create){current.set(change.id,structuredClone(change.create));continue;}
    const record=current.get(change.id);if(!record)throw new Error(`World update missing actor/projectile ${change.id}`);
    Object.assign(record,structuredClone(change.set));for(const key of change.unset)delete record[key];
  }
  return [...current.values()];
}

/** Applied by a Meep SimAction, so its full prior state belongs to rollback
 * history while the wire carries only the changes since the preceding frame.
 */
export function applyWorldPatch(snapshot,patch){
  // A fresh initial-sync snapshot can overtake retained historical actions.
  if(patch.tick<=snapshot.tick)return;
  if(patch.snapshot){Object.assign(snapshot,structuredClone(patch.snapshot));return;}
  if(patch.fromTick!==snapshot.tick)throw new Error(`World history gap: have ${snapshot.tick}, need ${patch.fromTick}`);
  snapshot.tick=patch.tick;snapshot.time=patch.time;
  snapshot.actors=applyRecords(snapshot.actors,patch.actors);snapshot.projectiles=applyRecords(snapshot.projectiles??[],patch.projectiles);
  if(patch.events)snapshot.events=structuredClone(patch.events);
}
