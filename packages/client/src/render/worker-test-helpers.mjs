import {SystemWorkerHost} from '@woosh/meep-engine/src/engine/ecs/async/SystemWorkerHost.js';
import {ClothWorkerCore} from '@woosh/meep-engine/src/engine/physics/cloth/ecs/ClothWorkerCore.js';
import {FluidWorkerCore} from '@woosh/meep-engine/src/engine/physics/fluid/ecs/FluidWorkerCore.js';

const workers=new Set();

// Exercise the real shared-memory protocol and solver while letting tests decide
// when a worker completes.
function worker(core){
  const host=new SystemWorkerHost(core);
  const scope={postMessage:data=>facade.onmessage?.({data})};
  const facade={
    host,onmessage:null,onerror:null,terminated:false,
    postMessage(data){if(!this.terminated)scope.onmessage({data:structuredClone(data)});},
    terminate(){this.terminated=true;workers.delete(this);},
  };
  host.attach(scope);workers.add(facade);return facade;
}

export const clothWorker=()=>worker(new ClothWorkerCore());
export const fluidWorker=()=>worker(new FluidWorkerCore());

export function stepWorker(system,dt=1/60){
  system.entityManager.fixedStepTick++;
  system.fixedUpdate(dt);
  for(const facade of workers)facade.host.runPendingStep();
  // A zero-duration collection skips dispatch, exposing joined state to asserts.
  system.fixedUpdate(0);
}
