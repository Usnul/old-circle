import {expect,test} from 'vitest';
import {Worker} from 'node:worker_threads';
import {GameWorld} from '@old-circle/game/simulation/world.mjs';

test('the simulation announces its installed handler before accepting the start that produces a player snapshot',async()=>{
  // Exercise the actual module and its asynchronous baked-asset imports. Node's
  // worker transport only supplies the browser worker globals used by the entry.
  const entry=new URL('./simulation.worker.mjs',import.meta.url);
  const source=`
    import {parentPort} from 'node:worker_threads';
    globalThis.self=globalThis;
    globalThis.postMessage=message=>parentPort.postMessage({message,handlerInstalled:typeof self.onmessage==='function'});
    parentPort.on('message',data=>self.onmessage?.({data}));
    await import(${JSON.stringify(entry.href)});
  `;
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source)));
  let initialized=0,timeout;
  try{
    const ready=await new Promise((resolve,reject)=>{
      timeout=setTimeout(()=>reject(new Error('Simulation startup did not complete')),10000);
      worker.on('error',reject);
      worker.on('exit',code=>reject(new Error(`Simulation exited before readiness (${code})`)));
      worker.on('message',({message,handlerInstalled})=>{
        try{
          if(message.type==='initialized'){
            expect(handlerInstalled).toBe(true);expect(++initialized).toBe(1);
            worker.postMessage({type:'start',playerId:'startup-player',origin:'pilgrim',url:null});
          }else if(message.type==='error')reject(new Error(message.message));
          else if(message.type==='ready')resolve(message);
        }catch(error){reject(error);}
      });
    });
    expect(initialized).toBe(1);expect(ready.mode).toBe('offline');
    expect(ready.snapshot.actors.find(actor=>actor.id==='startup-player')).toMatchObject({kind:'player',origin:'pilgrim'});
    expect(ready.snapshot.actors.length).toBeGreaterThan(1);
  }finally{clearTimeout(timeout);await worker.terminate();}
});

test('a wounded saved character stays still and offline until the loading screen admits the player',async()=>{
  const world=await new GameWorld().start({populate:false,navigation:false});
  let saved;
  try{
    const player=world.addPlayer('returning-player');
    saved=world.exportCharacter(player.id);saved.stats.vigor=14;saved.hp=114;saved.motion.hurtTime=.35;
  }finally{await world.stop();}
  const entry=new URL('./simulation.worker.mjs',import.meta.url);
  const source=`
    import {parentPort} from 'node:worker_threads';
    globalThis.self=globalThis;
    globalThis.postMessage=message=>parentPort.postMessage(message);
    globalThis.WebSocket=class {
      constructor(url){postMessage({type:'connection-attempt',url});}
      addEventListener(){}
      close(){}
    };
    parentPort.on('message',data=>self.onmessage?.({data}));
    await import(${JSON.stringify(entry.href)});
  `;
  const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(source))),messages=[];
  worker.on('message',message=>messages.push(message));
  const receive=(type,send)=>new Promise((resolve,reject)=>{
    const finish=(error,message)=>{clearTimeout(timeout);worker.off('message',onMessage);worker.off('error',onError);error?reject(error):resolve(message);};
    const onError=error=>finish(error),onMessage=message=>{
      if(message.type==='error')finish(new Error(message.message));
      else if(message.type===type)finish(null,message);
    };
    const timeout=setTimeout(()=>finish(new Error(`Simulation did not produce ${type}`)),10000);
    worker.on('message',onMessage);worker.on('error',onError);if(send)worker.postMessage(send);
  });
  try{
    await receive('initialized');
    const ready=await receive('ready',{type:'start',playerId:'returning-player',origin:'pilgrim',saved,url:'ws://loading-regression.invalid'});
    const initial=ready.snapshot.actors.find(actor=>actor.id==='returning-player');
    expect(initial).toMatchObject({hp:114,healthMax:140,hurtTime:.35});expect(ready.snapshot.events).toEqual([]);
    worker.postMessage({type:'input',intent:{x:0,z:1,yaw:0,buttons:0}});
    await new Promise(resolve=>setTimeout(resolve,160));
    const frozen=await receive('save',{type:'save'});
    expect(messages.filter(message=>message.type==='snapshot'||message.type==='connection-attempt'||message.type==='error')).toEqual([]);
    expect(frozen.character).toMatchObject({hp:114,x:saved.x,y:saved.y,z:saved.z,motion:{hurtTime:.35}});
    const resumed=await receive('snapshot',{type:'enter-world'}),player=resumed.snapshot.actors.find(actor=>actor.id==='returning-player');
    expect(resumed.snapshot.tick).toBeGreaterThan(ready.snapshot.tick);
    expect(player).toMatchObject({hp:114,healthMax:140});expect(player.hurtTime).toBeLessThan(.35);
    expect(resumed.snapshot.events.some(event=>event.type==='hit'&&event.id===player.id)).toBe(false);
    expect(messages.filter(message=>message.type==='connection-attempt')).toEqual([{type:'connection-attempt',url:'ws://loading-regression.invalid'}]);
    expect((await receive('save',{type:'save'})).character.hp).toBe(114);
  }finally{await worker.terminate();}
});
