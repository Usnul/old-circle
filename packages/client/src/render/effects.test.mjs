import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {effect,AMBIENT_EFFECTS,FOOTSTEP_EFFECTS,HAZARD_EFFECTS} from './effects.mjs';
import {execute_particle_vm} from '@woosh/meep-engine/src/shade/renderer/particles/vm/ParticleVMReference.js';
import {PARTICLE_RECORD_WORD_COUNT} from '@woosh/meep-engine/src/shade/renderer/particles/ParticleConstants.js';
import {VM_BUILTIN} from '@woosh/meep-engine/src/shade/renderer/particles/isa/ParticleVMISA.js';
import {EMITTER_BLEND,EMITTER_FLAG,emitter_flags_blend} from '@woosh/meep-engine/src/shade/renderer/particles/data/PARTICLE_EMITTER_STRUCT.js';

function particle(kind,{scale=1,seed=73,position=[0,0,0],normal=[0,1,0]}={}){
  const component=effect(kind,0,scale),{layout,program}=component,record=new Uint32Array(PARTICLE_RECORD_WORD_COUNT),floats=new Float32Array(record.buffer),builtins=[];
  builtins[VM_BUILTIN.EMITTER_POSITION]=[...position,0];builtins[VM_BUILTIN.DELTA_TIME]=[0,0,0,0];
  builtins[VM_BUILTIN.EMITTER_DIRECTION]=[1,0,0,0];builtins[VM_BUILTIN.EMITTER_UP]=[...normal,0];
  const run=words=>{const result=execute_particle_vm({...program,words,record,builtins,rng_state:seed});seed=result.rng_state;return result;};
  run(program.init);
  return {component,floats,layout,read:(name,count=1)=>Array.from(floats.slice(layout.offsetOf(name),layout.offsetOf(name)+count)),
    update(dt=0){builtins[VM_BUILTIN.DELTA_TIME][0]=dt;return run(program.update);}};
}

test.each([['heal',1.4],['embers',1.9],['motes',6],['frost',1],['shockwave',1],...Object.entries(AMBIENT_EFFECTS).map(([kind,p])=>[kind,p.life]),...Object.entries(FOOTSTEP_EFFECTS).map(([kind,p])=>[kind,p.life]),...Object.keys(HAZARD_EFFECTS).map(kind=>[kind,1])])('%s fades its visible contribution before its GPU lifetime ends',(kind,life)=>{
  const p=particle(kind),step=FOOTSTEP_EFFECTS[kind],age=p.layout.offsetOf('age');expect(p.read('color',4)).toEqual([0,0,0,0]);
  p.floats[age]=life*.35;p.update();const visible=p.read('color',4);expect(visible[3]).toBeGreaterThan(.1);
  p.floats[age]=life-.001;expect(p.update().killed).toBe(false);const fading=p.read('color',4);expect(fading[3]).toBeLessThan(.0001);
  if(step){for(let i=0;i<3;i++){expect(visible[i]).toBeCloseTo(step.color[i],6);expect(fading[i]).toBe(visible[i]);}}
  else expect(fading.slice(0,3).every(v=>v<.0001)).toBe(true);
  p.floats[age]=life+.001;expect(p.update().killed).toBe(true);expect(p.read('color',4)[3]).toBe(0);
  if(step)expect(p.read('color',3)).toEqual(visible.slice(0,3));else expect(p.read('color',3)).toEqual([0,0,0]);
});

test.each(Object.keys(FOOTSTEP_EFFECTS))('%s uses a shipped alpha sprite with lit, soft-depth coverage',(kind)=>{
  const c=effect(kind,0);expect(emitter_flags_blend(c.flags)).toBe(EMITTER_BLEND.ALPHA);
  expect(c.flags&EMITTER_FLAG.LIGHTING).toBe(EMITTER_FLAG.LIGHTING);expect(c.flags&EMITTER_FLAG.SOFT_DEPTH).toBe(EMITTER_FLAG.SOFT_DEPTH);
  expect(c.texture).toMatch(/\/step-(dust|grit|leaf)\.png$/);expect(c.render_rotation).toBe(c.layout.offsetOf('rotation'));
  const png=readFileSync(new URL('../../public'+c.texture,import.meta.url));
  expect(Array.from(png.subarray(0,8))).toEqual([137,80,78,71,13,10,26,10]);expect(png.toString('ascii',12,16)).toBe('IHDR');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);expect(width).toBe(128);expect(height).toBe(128);
  expect(png[24]).toBe(8);expect(png[25]).toBe(6);expect(png[28]).toBe(0);
  const chunks=[];
  for(let offset=8;offset<png.length;){const size=png.readUInt32BE(offset);expect(offset+size+12).toBeLessThanOrEqual(png.length);if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+size));offset+=size+12;}
  expect(inflateSync(Buffer.concat(chunks)).length).toBe(height*(width*4+1));
});

test.each(Object.entries(FOOTSTEP_EFFECTS))('%s varies debris size and orientation without leaving its contact plane at spawn',(kind,profile)=>{
  const normal=[.4,Math.sqrt(.75),-.3],position=[3,2,7],sizes=[],rotations=[];
  for(const seed of [1,17,73,819,941,2810]){
    const p=particle(kind,{seed,normal,position}),size=p.read('size')[0],rotation=p.read('rotation')[0],offset=p.read('position',3).map((v,i)=>v-position[i]);
    expect(size).toBeGreaterThan(profile.size*.5);expect(size).toBeLessThan(profile.size*1.5);sizes.push(size);
    expect(rotation).toBeGreaterThanOrEqual(0);expect(rotation).toBeLessThan(Math.PI*2);rotations.push(rotation);
    expect(offset.reduce((sum,v,i)=>sum+v*normal[i],0)).toBeCloseTo(0,5);
  }
  expect(new Set(sizes).size).toBe(6);expect(Math.max(...sizes)-Math.min(...sizes)).toBeGreaterThan(profile.size*.1);
  expect(new Set(rotations).size).toBe(6);expect(Math.max(...rotations)-Math.min(...rotations)).toBeGreaterThan(2);
});

test.each(Object.entries(FOOTSTEP_EFFECTS))('%s stays above a sloped contact plane throughout its live trajectory',(kind,profile)=>{
  const normal=[.4,Math.sqrt(.75),-.3],contact=[3,2,7],position=contact.map((v,i)=>v+normal[i]*.05);
  for(const dt of [1/60,1/20])for(const seed of [73,941]){
    const p=particle(kind,{seed,normal,position});let peak=0,killed=false;
    for(let time=0;time<profile.life+dt;time+=dt){
      const height=p.read('position',3).reduce((sum,v,i)=>sum+(v-contact[i])*normal[i],0);
      expect(height).toBeGreaterThanOrEqual(-.00001);peak=Math.max(peak,height);
      if(p.update(dt).killed){killed=true;break;}
    }
    expect(killed).toBe(true);expect(peak).toBeGreaterThan(.1);
  }
});

test.each(Object.keys(FOOTSTEP_EFFECTS))('%s scales debris size, scatter and motion with a larger actor',(kind)=>{
  const scale=1.85,position=[3,2,7],normal=[.4,Math.sqrt(.75),-.3],small=particle(kind,{position,normal}),large=particle(kind,{scale,position,normal});
  const compare=()=>{
    expect(large.read('size')[0]).toBeCloseTo(small.read('size')[0]*scale,5);
    expect(large.read('rotation')[0]).toBeCloseTo(small.read('rotation')[0],5);
    for(let i=0;i<3;i++){
      expect(large.read('position',3)[i]-position[i]).toBeCloseTo((small.read('position',3)[i]-position[i])*scale,5);
      expect(large.read('velocity',3)[i]).toBeCloseTo(small.read('velocity',3)[i]*scale,5);
    }
  };
  compare();for(let frame=0;frame<12;frame++){small.update(1/60);large.update(1/60);}compare();
});
