import {expect,test} from 'vitest';
import {Worker} from 'node:worker_threads';

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
