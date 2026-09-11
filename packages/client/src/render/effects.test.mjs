import {expect,test} from 'vitest';
import {effect,AMBIENT_EFFECTS,FOOTSTEP_EFFECTS,HAZARD_EFFECTS} from './effects.mjs';
import {execute_particle_vm} from '@woosh/meep-engine/src/shade/renderer/particles/vm/ParticleVMReference.js';
import {PARTICLE_RECORD_WORD_COUNT} from '@woosh/meep-engine/src/shade/renderer/particles/ParticleConstants.js';
import {VM_BUILTIN} from '@woosh/meep-engine/src/shade/renderer/particles/isa/ParticleVMISA.js';
test.each([['embers',1.9],['motes',6],['frost',1],['shockwave',1],...Object.entries(AMBIENT_EFFECTS).map(([kind,p])=>[kind,p.life]),...Object.keys(FOOTSTEP_EFFECTS).map(kind=>[kind,.6]),...Object.keys(HAZARD_EFFECTS).map(kind=>[kind,1])])('%s fades light to zero before its GPU lifetime ends',(kind,life)=>{
  const {layout,program}=effect(kind),record=new Uint32Array(PARTICLE_RECORD_WORD_COUNT),floats=new Float32Array(record.buffer),builtins=[];
  builtins[VM_BUILTIN.EMITTER_POSITION]=[0,0,0,0];builtins[VM_BUILTIN.DELTA_TIME]=[0,0,0,0];
  builtins[VM_BUILTIN.EMITTER_DIRECTION]=[1,0,0,0];
  const run=words=>execute_particle_vm({...program,words,record,builtins,rng_state:73});
  run(program.init);const color=layout.offsetOf('color'),age=layout.offsetOf('age');expect(floats[color]).toBe(0);
  floats[age]=life*.35;run(program.update);expect(floats[color]).toBeGreaterThan(.2);
  floats[age]=life-.001;expect(run(program.update).killed).toBe(false);expect(floats[color]).toBeLessThan(.0001);
  floats[age]=life+.001;expect(run(program.update).killed).toBe(true);expect(floats[color]).toBe(0);
});
