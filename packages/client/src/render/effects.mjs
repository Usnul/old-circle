import { NodeGraph } from '@woosh/meep-engine/src/core/model/node-graph/NodeGraph.js';
import { particle_node as node, particle_wire as wire } from '@woosh/meep-engine/src/shade/renderer/particles/graph/particle_graph_authoring.js';
import { ParticleLayout } from '@woosh/meep-engine/src/shade/renderer/particles/layout/ParticleLayout.js';
import { create_particle_effect } from '@woosh/meep-engine/src/shade/renderer/particles/runtime/create_particle_effect.js';
import { VM_BUILTIN } from '@woosh/meep-engine/src/shade/renderer/particles/isa/ParticleVMISA.js';
import { ParticleEffect } from '@woosh/meep-engine/src/engine/graphics/ecs/particles/ParticleEffect.js';
import { EMITTER_BLEND } from '@woosh/meep-engine/src/shade/renderer/particles/data/PARTICLE_EMITTER_STRUCT.js';

const programs=new Map();
// Every visual particle is simulated on Meep's GPU VM, including ambient motes.
export function effect(kind='embers',rate=35){
  if(!programs.has(kind))programs.set(kind,compile(kind));
  return ParticleEffect.from({...programs.get(kind),texture:'/assets/vfx/mote.png',spawn_rate:rate,flags:{blend:EMITTER_BLEND.ADDITIVE,soft_depth:true},render:{position:'position',size:'size',color:'color'},prewarm:kind==='motes'?2:0});
}
function compile(kind){
  const ambient=kind==='motes',frost=kind==='frost',shock=kind==='shockwave';
  const layout=new ParticleLayout([{name:'position',components:3},{name:'velocity',components:3},{name:'age',components:1},{name:'size',components:1},{name:'color',components:4}]);
  const init=new NodeGraph(),update=new NodeGraph();
  const op=(g,type,inputs,params={})=>{const n=node(g,type,params);for(const [k,v] of Object.entries(inputs??{}))wire(g,n,k,v);return n;};
  const set=(g,name,value)=>op(g,'setAttribute',{value},{name});
  const random=op(init,'random',{}, {components:3});
  const signed=op(init,'mad',{a:random,b:[2,2,2],c:[-1,-1,-1]});
  const jitter=op(init,'mul',{a:signed,b:ambient?[24,5,24]:shock||frost?[.2,.1,.2]:[.2,.1,.2]});
  set(init,'position',op(init,'add',{a:op(init,'builtin',{}, {id:VM_BUILTIN.EMITTER_POSITION}),b:jitter}));
  let velocity=op(init,'mul',{a:signed,b:ambient?[.15,.10,.15]:frost||shock?[7,.2,7]:[.5,1,.5]});
  velocity=op(init,'add',{a:velocity,b:ambient?[.15,.02,.08]:shock||frost?[0,.1,0]:[0,1.4,0]});
  set(init,'velocity',velocity);set(init,'age',[0]);set(init,'size',[ambient?.035:shock||frost?.09:.11]);
  set(init,'color',frost?[.35,.85,1.6,.75]:[1.5,.75,.22,.7]);
  const dt=op(update,'builtin',{}, {id:VM_BUILTIN.DELTA_TIME});
  const age=op(update,'add',{a:op(update,'attribute',{}, {name:'age'}),b:dt});set(update,'age',age);
  op(update,'kill',{condition:op(update,'compare',{a:age,b:[ambient?6:shock||frost?1:1.9]},{op:'ge'})});
  const pos=op(update,'attribute',{}, {name:'position'}),vel=op(update,'attribute',{}, {name:'velocity'});
  set(update,'position',op(update,'add',{a:pos,b:op(update,'scale',{v:vel,s:dt})}));
  return create_particle_effect({layout,init,update});
}
