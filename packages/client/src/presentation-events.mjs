// A new authority snapshot establishes current state. Its retained event history
// is not live feedback; later rollback events still play if they occurred after entry.
export class PresentationEvents {
  constructor(){this.seen=new Set();}
  read(snapshot){
    const baseline=this.baselineTick===undefined||this.epoch!==snapshot.presentationEpoch;
    if(baseline){this.epoch=snapshot.presentationEpoch;this.baselineTick=snapshot.tick;this.seen.clear();}
    const events=[];
    for(const event of snapshot.events??[]){
      const key=event.key??`${event.tick}:${event.id}:${event.type}`;
      if(this.seen.has(key))continue;this.seen.add(key);
      if(!baseline&&event.tick>this.baselineTick)events.push(event);
    }
    while(this.seen.size>2048)this.seen.delete(this.seen.values().next().value);
    return events;
  }
}
