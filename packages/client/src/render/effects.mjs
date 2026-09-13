import { NodeGraph } from '@woosh/meep-engine/src/core/model/node-graph/NodeGraph.js';
import { particle_node as node, particle_wire as wire } from '@woosh/meep-engine/src/shade/renderer/particles/graph/particle_graph_authoring.js';
import { ParticleLayout } from '@woosh/meep-engine/src/shade/renderer/particles/layout/ParticleLayout.js';
import { create_particle_effect } from '@woosh/meep-engine/src/shade/renderer/particles/runtime/create_particle_effect.js';
import { VM_BUILTIN } from '@woosh/meep-engine/src/shade/renderer/particles/isa/ParticleVMISA.js';
import { ParticleEffect } from '@woosh/meep-engine/src/engine/graphics/ecs/particles/ParticleEffect.js';
import { EMITTER_BLEND } from '@woosh/meep-engine/src/shade/renderer/particles/data/PARTICLE_EMITTER_STRUCT.js';
import {PARTICLE_LAYERS,layerEffect} from './particle-layers.mjs';

const programs=new Map();
export const FOOTSTEP_EFFECTS={
  'step-grass':{texture:'step-leaf',color:[.28,.34,.13,.85],size:.065,life:.55,lift:.85,spread:.30,gravity:2.4,growth:0,count:4},
  'step-gravel':{texture:'step-grit',color:[.43,.39,.31,.85],size:.055,life:.5,lift:.9,spread:.40,gravity:3,growth:0,count:5},
  'step-sand':{texture:'step-dust',color:[.60,.46,.29,.62],size:.16,life:.7,lift:.65,spread:.27,gravity:.65,growth:.18,count:4},
  'step-snow':{texture:'step-dust',color:[.86,.91,.95,.8],size:.13,life:.65,lift:.8,spread:.35,gravity:1.2,growth:.14,count:5},
  'step-stone':{texture:'step-dust',color:[.49,.46,.40,.35],size:.105,life:.45,lift:.60,spread:.18,gravity:1,growth:.09,count:2},
  'step-wood':{texture:'step-leaf',color:[.44,.32,.19,.6],size:.045,life:.4,lift:.65,spread:.22,gravity:2.4,growth:0,count:2},
};
export const AMBIENT_EFFECTS={
  pollen:{life:7,color:[.7,.74,.36,.55],size:.033,fall:-.02,speed:.65},
  fireflies:{life:6,color:[.45,.8,.20,.8],size:.025,fall:.03,speed:.18,glow:true},
  dust:{life:5,color:[.55,.40,.23,.20],size:.08,fall:.025,speed:1.3},
  glass:{life:6,color:[.22,.65,1.2,.7],size:.035,fall:-.04,speed:.3,glow:true},
  snow:{life:5.5,color:[.78,.86,.92,.85],size:.07,fall:-.7,speed:1.1},
  ash:{life:6,color:[.48,.43,.37,.45],size:.035,fall:-.16,speed:.9},
};
// Every visual particle is simulated on Meep's GPU VM, including ambient motes.
export function effect(kind='fire-ember',rate=35,scale=1){
  if(PARTICLE_LAYERS[kind])return layerEffect(kind,rate,scale);
  if(!FOOTSTEP_EFFECTS[kind]&&!AMBIENT_EFFECTS[kind]&&!['motes','levitation'].includes(kind))throw new Error(`Unknown particle effect: ${kind}`);
  const step=FOOTSTEP_EFFECTS[kind],key=step?`${kind}:${scale}`:kind;
  if(!programs.has(key))programs.set(key,compile(kind,scale));
  const natural=FOOTSTEP_EFFECTS[kind]||AMBIENT_EFFECTS[kind]&&!AMBIENT_EFFECTS[kind].glow;
  return ParticleEffect.from({...programs.get(key),texture:`/assets/vfx/${step?.texture??'mote'}.png`,spawn_rate:rate,flags:{blend:natural?EMITTER_BLEND.ALPHA:EMITTER_BLEND.ADDITIVE,lighting:!!natural,soft_depth:true},render:{position:'position',size:'size',color:'color',...(step?{rotation:'rotation'}:{})},prewarm:kind==='motes'?2:0});
}
function compile(kind,scale){
  const profile=AMBIENT_EFFECTS[kind],step=FOOTSTEP_EFFECTS[kind],ambient=!!profile||kind==='motes',levitation=kind==='levitation';
  const lifetime=step?.life??(levitation?1.4:profile?.life??6),color=step?.color??profile?.color??[2.4,1.8,.7,.9];
  const layout=new ParticleLayout([{name:'position',components:3},{name:'velocity',components:3},{name:'age',components:1},{name:'size',components:1},{name:'color',components:4},...(step?[{name:'rotation',components:1},{name:'normal',components:3}]:[])]);
  const init=new NodeGraph(),update=new NodeGraph();
  const op=(g,type,inputs,params={})=>{const n=node(g,type,params);for(const [k,v] of Object.entries(inputs??{}))wire(g,n,k,v);return n;};
  const set=(g,name,value)=>op(g,'setAttribute',{value},{name});
  const random=op(init,'random',{}, {components:3});
  const signed=op(init,'mad',{a:random,b:[2,2,2],c:[-1,-1,-1]});
  const normal=step?op(init,'builtin',{}, {id:VM_BUILTIN.EMITTER_UP}):null;
  // Scatter in the contact plane, then lift along its normal, including on slopes.
  const tangent=step?op(init,'sub',{a:signed,b:op(init,'scale',{v:normal,s:op(init,'dot',{a:signed,b:normal})})}):null;
  const jitter=step?op(init,'scale',{v:tangent,s:[.065*scale]}):op(init,'mul',{a:signed,b:levitation?[.045,.045,.045]:kind==='snow'?[12,4,12]:[16,2,16]});
  set(init,'position',op(init,'add',{a:op(init,'builtin',{}, {id:VM_BUILTIN.EMITTER_POSITION}),b:jitter}));
  let velocity=step?op(init,'scale',{v:tangent,s:[step.spread*scale]}):op(init,'mul',{a:signed,b:levitation?[.025,.025,.025]:[.15,.10,.15]});
  velocity=op(init,'add',{a:velocity,b:step?op(init,'scale',{v:normal,s:[step.lift*scale]}):levitation?[0,0,0]:[.15,.02,.08]});
  set(init,'velocity',velocity);set(init,'age',[0]);set(init,'size',step?op(init,'mad',{a:op(init,'random',{}, {components:1}),b:[step.size*scale*.5],c:[step.size*scale*.75]}):[profile?.size??(levitation?.23:.035)]);
  if(step){set(init,'normal',normal);set(init,'rotation',op(init,'mul',{a:op(init,'random',{}, {components:1}),b:[Math.PI*2]}));}
  set(init,'color',[0,0,0,0]);
  const dt=op(update,'builtin',{}, {id:VM_BUILTIN.DELTA_TIME});
  const age=op(update,'add',{a:op(update,'attribute',{}, {name:'age'}),b:dt});set(update,'age',age);
  const fadeIn=op(update,'smoothstep',{e0:[0],e1:[ambient?.65:.08],x:age});
  const fadeOut=op(update,'sub',{a:[1],b:op(update,'smoothstep',{e0:[lifetime*.45],e1:[lifetime],x:age})});
  const envelope=op(update,'mul',{a:fadeIn,b:fadeOut});
  // Lit alpha particles keep their albedo as coverage fades; additive light must fade RGB too.
  set(update,'color',step?op(update,'mul',{a:color,b:op(update,'vec4',{x:[1],y:[1],z:[1],w:envelope})}):op(update,'scale',{v:color,s:envelope}));
  op(update,'kill',{condition:op(update,'compare',{a:age,b:[lifetime]},{op:'ge'})});
  const pos=op(update,'attribute',{}, {name:'position'});let vel=op(update,'attribute',{}, {name:'velocity'});
  if(step){
    const gravity=op(update,'scale',{v:op(update,'attribute',{}, {name:'normal'}),s:[-step.gravity*scale]});
    vel=op(update,'add',{a:vel,b:op(update,'scale',{v:gravity,s:dt})});set(update,'velocity',vel);
    set(update,'size',op(update,'add',{a:op(update,'attribute',{}, {name:'size'}),b:op(update,'mul',{a:dt,b:[step.growth*scale]})}));
    set(update,'rotation',op(update,'add',{a:op(update,'attribute',{}, {name:'rotation'}),b:op(update,'mul',{a:dt,b:[step.growth? .25:3]})}));
  }
  if(profile){
    const wind=op(update,'scale',{v:op(update,'builtin',{}, {id:VM_BUILTIN.EMITTER_DIRECTION}),s:[profile.speed]});
    const target=op(update,'add',{a:wind,b:[0,profile.fall,0]});
    vel=op(update,'add',{a:vel,b:op(update,'scale',{v:op(update,'sub',{a:target,b:vel}),s:dt})});set(update,'velocity',vel);
  }
  set(update,'position',op(update,'add',{a:pos,b:op(update,'scale',{v:vel,s:dt})}));
  return create_particle_effect({layout,init,update});
}
