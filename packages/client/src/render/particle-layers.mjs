import {NodeGraph} from '@woosh/meep-engine/src/core/model/node-graph/NodeGraph.js';
import {particle_node as node,particle_wire as wire} from '@woosh/meep-engine/src/shade/renderer/particles/graph/particle_graph_authoring.js';
import {ParticleLayout} from '@woosh/meep-engine/src/shade/renderer/particles/layout/ParticleLayout.js';
import {create_particle_effect} from '@woosh/meep-engine/src/shade/renderer/particles/runtime/create_particle_effect.js';
import {VM_BUILTIN} from '@woosh/meep-engine/src/shade/renderer/particles/isa/ParticleVMISA.js';
import {ParticleEffect} from '@woosh/meep-engine/src/engine/graphics/ecs/particles/ParticleEffect.js';
import {EMITTER_BLEND,EMITTER_PROJECTION} from '@woosh/meep-engine/src/shade/renderer/particles/data/PARTICLE_EMITTER_STRUCT.js';

// Each layer is an independently authored GPU program, sprite and envelope.
// Sizes are world-space billboard half-widths; life is the maximum, with 25% variation.
export const PARTICLE_LAYERS={
  'fire-core':{texture:'flame',life:.32,size:.23,endSize:.07,color:[2.5,1.3,.3,.65],endColor:[1.3,.25,.025,0],spread:[.16,.02,.16],velocity:[.08,.12,.08],lift:.75,offset:.1,spin:.4,fadeIn:.025},
  'fire-flame':{texture:'flame',life:.7,size:.15,endSize:.025,color:[1.8,.46,.055,.5],endColor:[.7,.055,.006,0],spread:[.18,.025,.18],velocity:[.12,.25,.12],lift:1.15,offset:.15,stretched:true,flutter:.18,fadeIn:.055},
  'fire-smoke':{texture:'smoke',life:2.6,size:.2,endSize:.7,color:[.21,.19,.17,.15],spread:[.1,.06,.1],velocity:[.1,.1,.1],lift:.6,offset:.65,accel:[.06,.1,.025],alpha:true,spin:.25,fadeIn:.3},
  'fire-ember':{texture:'step-grit',life:1.7,size:.022,endSize:.006,color:[3,1.1,.15,.85],endColor:[.8,.09,.01,0],spread:[.18,.03,.18],velocity:[.4,.55,.4],lift:1.1,accel:[.08,-.2,0],flutter:.5,spin:5},
  'fire-ash':{texture:'step-leaf',life:2.6,size:.04,endSize:.02,color:[.32,.28,.23,.5],spread:[.16,.08,.16],velocity:[.3,.3,.3],lift:.9,offset:.4,accel:[.1,-.25,.03],alpha:true,spin:3,flutter:.5},
  'hit-flash':{texture:'impact',life:.13,size:.35,endSize:.525,color:[3.5,2.2,1.2,.9],spread:[.015,.015,.015],velocity:[0,0,0]},
  'hit-spark':{texture:'step-grit',life:.38,size:.025,endSize:.006,color:[3,1.7,.55,1],endColor:[.8,.18,.02,0],spread:[.025,.025,.025],velocity:[2.5,2.5,2.5],push:2.3,accel:[0,-6,0],drag:2,stretched:true},
  'hit-chips':{texture:'step-grit',life:.6,size:.05,endSize:.02,color:[.35,.27,.2,.85],spread:[.035,.035,.035],velocity:[1.3,1.3,1.3],push:1.8,lift:.5,accel:[0,-5,0],alpha:true,spin:9},
  'hit-dust':{texture:'smoke',life:.48,size:.2,endSize:.75,color:[.42,.35,.28,.3],spread:[.055,.055,.055],velocity:[.3,.3,.3],push:.6,drag:3,alpha:true,spin:.5,fadeIn:.03},
  'hit-blood':{texture:'step-grit',life:.38,size:.065,endSize:.025,color:[.29,.035,.018,.85],spread:[.025,.025,.025],velocity:[.9,.9,.9],push:1.8,accel:[0,-4.5,0],alpha:true,spin:5},
  'arcane-flash':{texture:'impact',life:.18,size:.425,endSize:.625,color:[.8,2.3,3.8,.9],spread:[.02,.02,.02],velocity:[0,0,0]},
  'arcane-shard':{texture:'shard',life:.65,size:.065,endSize:.012,color:[.25,.8,1.8,.75],spread:[.04,.04,.04],velocity:[2,2,2],push:1.6,drag:2.5,spin:5},
  'arcane-mist':{texture:'smoke',life:.8,size:.26,endSize:1,color:[.15,.42,.65,.25],spread:[.08,.08,.08],velocity:[.35,.35,.35],push:.3,lift:.15,alpha:true,unlit:true,spin:.8,fadeIn:.04},
  'frost-shard':{texture:'shard',life:.85,size:.1,endSize:.025,color:[.7,1.15,1.6,.8],spread:[.05,.04,.05],velocity:[2.2,2.2,2.2],push:1.2,lift:.5,accel:[0,-4,0],spin:7},
  'frost-mist':{texture:'smoke',life:1.1,size:.35,endSize:1.2,color:[.55,.76,.85,.34],spread:[.12,.05,.12],velocity:[.55,.12,.55],lift:.08,alpha:true,unlit:true,spin:.4,fadeIn:.07},
  'cinder-flash':{texture:'impact',life:.17,size:.5,endSize:.7,color:[3.5,1.1,.18,.9],spread:[.02,.02,.02],velocity:[0,0,0]},
  'cinder-flame':{texture:'flame',life:.5,size:.28,endSize:.06,color:[2.5,.75,.12,.8],endColor:[.8,.08,.01,0],spread:[.08,.08,.08],velocity:[1.1,1.1,1.1],push:1,lift:.7,drag:2,spin:2},
  'cinder-wake':{texture:'flame',life:.32,size:.15,endSize:.025,color:[2,.55,.07,.55],endColor:[.65,.06,.006,0],spread:[.05,.05,.05],velocity:[.12,.12,.12],lift:.18,drag:2,spin:2},
  'heal-wisp':{texture:'flame',life:1.35,size:.12,endSize:.035,color:[.35,1.25,.5,.26],spread:[.38,.45,.38],velocity:[.08,.1,.08],lift:.65,spin:1,flutter:.3,fadeIn:.16,follow:true},
  'heal-glint':{texture:'impact',life:1.1,size:.06,endSize:.015,color:[.9,2,.65,.75],spread:[.4,.6,.4],velocity:[.08,.1,.08],lift:.45,spin:.6,fadeIn:.1,follow:true},
  'heal-haze':{texture:'smoke',life:1.2,size:.3,endSize:.6,color:[.2,.55,.23,.08],spread:[.28,.35,.28],velocity:[.12,.15,.12],lift:.25,alpha:true,unlit:true,fadeIn:.18,follow:true},
  'root-leaf':{texture:'step-leaf',life:1.1,size:.17,endSize:.055,color:[.37,.43,.12,.9],spread:[.1,.03,.1],velocity:[.5,.5,.5],lift:2.4,accel:[0,-4,0],alpha:true,spin:7},
  'root-soil':{texture:'step-grit',life:.7,size:.11,endSize:.06,color:[.22,.15,.08,.9],spread:[.1,.02,.1],velocity:[.7,.6,.7],lift:2,accel:[0,-5,0],alpha:true,spin:8},
  'root-spore':{texture:'smoke',life:1,size:.25,endSize:.8,color:[.3,.36,.1,.26],spread:[.1,.02,.1],velocity:[.3,.2,.3],lift:.5,alpha:true,fadeIn:.08},
  'star-glint':{texture:'impact',life:.65,size:.2,endSize:.04,color:[1,1.4,3,.85],spread:[.1,.1,.1],velocity:[.7,1.5,.7],lift:1.5,drag:1,spin:1.4},
  'bell-dust':{texture:'smoke',life:.65,size:.4,endSize:1.2,color:[.48,.36,.22,.38],spread:[.15,.03,.15],velocity:[.25,.15,.25],push:.5,lift:.2,alpha:true,spin:.7},
  'bell-grit':{texture:'step-grit',life:.5,size:.09,endSize:.03,color:[.58,.43,.25,.85],spread:[.08,.02,.08],velocity:[.55,.4,.55],lift:1.2,push:1.2,accel:[0,-4,0],alpha:true,spin:8},
  'bell-glint':{texture:'impact',life:.22,size:.3,endSize:.6,color:[1.8,.85,.22,.55],spread:[.04,.02,.04],velocity:[.1,.05,.1]},
  'spell-wisp':{texture:'smoke',life:.4,size:.18,endSize:.48,color:[.18,.5,1,.3],spread:[.06,.06,.06],velocity:[.12,.12,.12],drag:2},
  'spell-glint':{texture:'shard',life:.32,size:.04,endSize:.012,color:[.4,1.3,2.5,.7],spread:[.08,.08,.08],velocity:[.22,.22,.22],spin:4},
  'monument-glint':{texture:'impact',life:1.4,size:.22,endSize:.03,color:[1.4,1,.38,.6],spread:[.04,.04,.04],velocity:[.02,.02,.02],spin:.4,fadeIn:.15},
};

export const EFFECT_LAYERS={
  brazier:[['fire-core',24],['fire-flame',30],['fire-smoke',3],['fire-ember',5],['fire-ash',2]],
  physical:[['hit-flash',1],['hit-spark',10],['hit-chips',5],['hit-dust',3]],
  flesh:[['hit-flash',1],['hit-blood',8],['hit-dust',2]],
  arcane:[['arcane-flash',1],['arcane-shard',13],['arcane-mist',4]],
  frost:[['arcane-flash',1],['frost-shard',14],['frost-mist',5]],
  cinder:[['cinder-flash',1],['cinder-flame',9],['fire-ember',14],['fire-smoke',3]],
  heal:[['heal-wisp',12],['heal-glint',16],['heal-haze',3]],
  roots:[['root-leaf',5],['root-soil',6],['root-spore',2]],
  stars:[['star-glint',5],['arcane-shard',4],['arcane-mist',1]],
  'frost-ground':[['frost-shard',5],['frost-mist',2]],
  shockwave:[['bell-dust',2],['bell-grit',4],['bell-glint',1]],
  'spell-trail':[['spell-wisp',22],['spell-glint',14]],
  'cinder-trail':[['cinder-wake',18],['fire-ember',12]],
};
const programs=new Map();
export function layerEffect(kind,rate=0,scale=1){
  const p=PARTICLE_LAYERS[kind];if(!p)throw new Error(`Unknown particle layer: ${kind}`);
  const key=`${kind}:${scale}`;if(!programs.has(key))programs.set(key,compile(p,scale));
  return ParticleEffect.from({...programs.get(key),texture:`/assets/vfx/${p.texture}.png`,spawn_rate:rate,
    flags:{blend:p.alpha?EMITTER_BLEND.ALPHA:EMITTER_BLEND.ADDITIVE,lighting:!!p.alpha&&!p.unlit,soft_depth:!kind.endsWith('flash'),projection:p.vertical?EMITTER_PROJECTION.VERTICAL:p.stretched?EMITTER_PROJECTION.STRETCHED:EMITTER_PROJECTION.BILLBOARD},
    render:{position:'position',velocity:'velocity',size:'size',color:'color',rotation:'rotation'}});
}
function compile(p,scale){
  const layout=new ParticleLayout([{name:'position',components:3},{name:'velocity',components:3},{name:'color',components:4},...['age','life','size','initialSize','rotation','phase'].map(name=>({name,components:1})),...(p.follow?[{name:'origin',components:3}]:[])]);
  const init=new NodeGraph(),update=new NodeGraph();
  const op=(g,type,inputs={},params={})=>{const n=node(g,type,params);for(const [k,v] of Object.entries(inputs))wire(g,n,k,v);return n;};
  const set=(g,name,value)=>op(g,'setAttribute',{value},{name}),get=(g,name)=>op(g,'attribute',{}, {name});
  const rng=components=>op(init,'random',{}, {components});
  const signed=op(init,'mad',{a:rng(3),b:[2,2,2],c:[-1,-1,-1]});
  const mul=(g,a,b)=>op(g,'mul',{a,b}),add=(g,a,b)=>op(g,'add',{a,b}),scaleV=(g,v,s)=>op(g,'scale',{v,s});
  const origin=op(init,'builtin',{}, {id:VM_BUILTIN.EMITTER_POSITION});
  if(p.follow)set(init,'origin',origin);
  set(init,'position',add(init,origin,add(init,mul(init,signed,p.spread.map(v=>v*scale)),[0,(p.offset??0)*scale,0])));
  let velocity=mul(init,signed,p.velocity.map(v=>v*scale));
  if(p.push){
    const direction=op(init,'builtin',{}, {id:VM_BUILTIN.EMITTER_DIRECTION});
    // Scatter along the struck surface, eject into its outward hemisphere.
    velocity=op(init,'sub',{a:velocity,b:scaleV(init,direction,op(init,'dot',{a:velocity,b:direction}))});
    velocity=add(init,velocity,scaleV(init,direction,op(init,'mad',{a:rng(1),b:[p.push*scale*.6],c:[p.push*scale*.7]})));
  }
  velocity=add(init,velocity,[0,(p.lift??0)*scale,0]);
  set(init,'velocity',velocity);set(init,'age',[0]);
  set(init,'life',op(init,'mad',{a:rng(1),b:[p.life*.25],c:[p.life*.75]}));
  const size=op(init,'mad',{a:rng(1),b:[p.size*scale*.5],c:[p.size*scale*.75]});set(init,'size',size);set(init,'initialSize',size);
  const phase=mul(init,rng(1),[Math.PI*2]);set(init,'phase',phase);set(init,'rotation',p.vertical?[0]:phase);
  // Contact flashes are visible on the spawn frame, before their first UPDATE.
  set(init,'color',p.fadeIn?[0,0,0,0]:p.color);
  const dt=op(update,'builtin',{}, {id:VM_BUILTIN.DELTA_TIME}),age=add(update,get(update,'age'),dt);set(update,'age',age);
  const t=op(update,'clamp',{x:op(update,'div',{a:age,b:get(update,'life')}),lo:[0],hi:[1]});
  const fadeOut=op(update,'sub',{a:[1],b:op(update,'smoothstep',{e0:[p.fadeIn?.35:0],e1:[1],x:t})});
  const envelope=p.fadeIn?mul(update,fadeOut,op(update,'smoothstep',{e0:[0],e1:[p.fadeIn],x:age})):fadeOut;
  const color=op(update,'mix',{a:p.color,b:p.endColor??p.color,t});
  set(update,'color',p.alpha?mul(update,color,op(update,'vec4',{x:[1],y:[1],z:[1],w:envelope})):scaleV(update,color,envelope));
  set(update,'size',mul(update,get(update,'initialSize'),op(update,'mix',{a:[1],b:[p.endSize/p.size],t})));
  set(update,'rotation',add(update,get(update,'rotation'),mul(update,dt,[p.spin??0])));
  let vel=get(update,'velocity');
  if(p.accel)vel=add(update,vel,scaleV(update,p.accel.map(v=>v*scale),dt));
  if(p.drag)vel=scaleV(update,vel,op(update,'div',{a:[1],b:add(update,[1],mul(update,dt,[p.drag]))}));
  set(update,'velocity',vel);
  if(p.flutter){
    const phase=add(update,get(update,'phase'),mul(update,age,[6]));
    const sway=op(update,'vec3',{x:op(update,'sin',{x:phase}),y:[0],z:op(update,'cos',{x:phase})});
    vel=add(update,vel,scaleV(update,sway,[p.flutter*scale]));
  }
  let position=get(update,'position'),nextOrigin;
  if(p.follow){
    nextOrigin=op(update,'builtin',{}, {id:VM_BUILTIN.EMITTER_POSITION});
    position=add(update,position,op(update,'sub',{a:nextOrigin,b:get(update,'origin')}));
  }
  set(update,'position',add(update,position,scaleV(update,vel,dt)));
  if(p.follow)set(update,'origin',nextOrigin);
  op(update,'kill',{condition:op(update,'compare',{a:age,b:get(update,'life')},{op:'ge'})});
  return create_particle_effect({layout,init,update});
}
