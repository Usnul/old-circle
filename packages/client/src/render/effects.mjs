import { NodeGraph } from '@woosh/meep-engine/src/core/model/node-graph/NodeGraph.js';
import { particle_node as node, particle_wire as wire } from '@woosh/meep-engine/src/shade/renderer/particles/graph/particle_graph_authoring.js';
import { ParticleLayout } from '@woosh/meep-engine/src/shade/renderer/particles/layout/ParticleLayout.js';
import { create_particle_effect } from '@woosh/meep-engine/src/shade/renderer/particles/runtime/create_particle_effect.js';
import { VM_BUILTIN } from '@woosh/meep-engine/src/shade/renderer/particles/isa/ParticleVMISA.js';
import { ParticleEffect } from '@woosh/meep-engine/src/engine/graphics/ecs/particles/ParticleEffect.js';
import { EMITTER_BLEND } from '@woosh/meep-engine/src/shade/renderer/particles/data/PARTICLE_EMITTER_STRUCT.js';

const programs=new Map();
export const AMBIENT_EFFECTS={
  pollen:{life:7,color:[.7,.74,.36,.55],size:.033,fall:-.02,speed:.65},
  fireflies:{life:6,color:[.45,.8,.20,.8],size:.025,fall:.03,speed:.18,glow:true},
  dust:{life:5,color:[.55,.40,.23,.20],size:.08,fall:.025,speed:1.3},
  glass:{life:6,color:[.22,.65,1.2,.7],size:.035,fall:-.04,speed:.3,glow:true},
  snow:{life:5.5,color:[.78,.86,.92,.85],size:.07,fall:-.7,speed:1.1},
  ash:{life:6,color:[.48,.43,.37,.45],size:.035,fall:-.16,speed:.9},
};
// Every visual particle is simulated on Meep's GPU VM, including ambient motes.
export function effect(kind='embers',rate=35){
  if(!programs.has(kind))programs.set(kind,compile(kind));
  const natural=AMBIENT_EFFECTS[kind]&&!AMBIENT_EFFECTS[kind].glow;
  return ParticleEffect.from({...programs.get(kind),texture:'/assets/vfx/mote.png',spawn_rate:rate,flags:{blend:natural?EMITTER_BLEND.ALPHA:EMITTER_BLEND.ADDITIVE,lighting:!!natural,soft_depth:true},render:{position:'position',size:'size',color:'color'},prewarm:kind==='motes'?2:0});
}
function compile(kind){
  const profile=AMBIENT_EFFECTS[kind],ambient=!!profile||kind==='motes',frost=kind==='frost',shock=kind==='shockwave';
  const lifetime=profile?.life??(ambient?6:shock||frost?1:1.9),color=profile?.color??(frost?[.35,.85,1.6,.75]:[1.5,.75,.22,.7]);
  const layout=new ParticleLayout([{name:'position',components:3},{name:'velocity',components:3},{name:'age',components:1},{name:'size',components:1},{name:'color',components:4}]);
  const init=new NodeGraph(),update=new NodeGraph();
  const op=(g,type,inputs,params={})=>{const n=node(g,type,params);for(const [k,v] of Object.entries(inputs??{}))wire(g,n,k,v);return n;};
  const set=(g,name,value)=>op(g,'setAttribute',{value},{name});
  const random=op(init,'random',{}, {components:3});
  const signed=op(init,'mad',{a:random,b:[2,2,2],c:[-1,-1,-1]});
  const jitter=op(init,'mul',{a:signed,b:kind==='snow'?[12,4,12]:ambient?[16,2,16]:[.2,.1,.2]});
  set(init,'position',op(init,'add',{a:op(init,'builtin',{}, {id:VM_BUILTIN.EMITTER_POSITION}),b:jitter}));
  let velocity=op(init,'mul',{a:signed,b:ambient?[.15,.10,.15]:frost||shock?[7,.2,7]:[.5,1,.5]});
  velocity=op(init,'add',{a:velocity,b:ambient?[.15,.02,.08]:shock||frost?[0,.1,0]:[0,1.4,0]});
  set(init,'velocity',velocity);set(init,'age',[0]);set(init,'size',[profile?.size??(ambient?.035:shock||frost?.09:.11)]);
  set(init,'color',[0,0,0,0]);
  const dt=op(update,'builtin',{}, {id:VM_BUILTIN.DELTA_TIME});
  const age=op(update,'add',{a:op(update,'attribute',{}, {name:'age'}),b:dt});set(update,'age',age);
  const fadeIn=op(update,'smoothstep',{e0:[0],e1:[ambient?.65:.08],x:age});
  const fadeOut=op(update,'sub',{a:[1],b:op(update,'smoothstep',{e0:[lifetime*.45],e1:[lifetime],x:age})});
  const envelope=op(update,'mul',{a:fadeIn,b:fadeOut});
  // Fade RGB as well as alpha: additive light must approach zero before recycle.
  set(update,'color',op(update,'scale',{v:color,s:envelope}));
  op(update,'kill',{condition:op(update,'compare',{a:age,b:[lifetime]},{op:'ge'})});
  const pos=op(update,'attribute',{}, {name:'position'});let vel=op(update,'attribute',{}, {name:'velocity'});
  if(profile){
    const wind=op(update,'scale',{v:op(update,'builtin',{}, {id:VM_BUILTIN.EMITTER_DIRECTION}),s:[profile.speed]});
    const target=op(update,'add',{a:wind,b:[0,profile.fall,0]});
    vel=op(update,'add',{a:vel,b:op(update,'scale',{v:op(update,'sub',{a:target,b:vel}),s:dt})});set(update,'velocity',vel);
  }
  set(update,'position',op(update,'add',{a:pos,b:op(update,'scale',{v:vel,s:dt})}));
  return create_particle_effect({layout,init,update});
}
