import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {PARTICLE_LAYERS,layerEffect} from './particle-layers.mjs';
import {ParticleEffect} from '@woosh/meep-engine/src/engine/graphics/ecs/particles/ParticleEffect.js';
import {execute_particle_vm} from '@woosh/meep-engine/src/shade/renderer/particles/vm/ParticleVMReference.js';
import {PARTICLE_RECORD_WORD_COUNT} from '@woosh/meep-engine/src/shade/renderer/particles/ParticleConstants.js';
import {VM_BUILTIN} from '@woosh/meep-engine/src/shade/renderer/particles/isa/ParticleVMISA.js';
import {EMITTER_BLEND,EMITTER_FLAG,EMITTER_PROJECTION,emitter_flags_blend,emitter_flags_projection} from '@woosh/meep-engine/src/shade/renderer/particles/data/PARTICLE_EMITTER_STRUCT.js';

const profiles=Object.entries(PARTICLE_LAYERS),seeds=[1,17,73,819,941,2810];
// Decode the shipped RGBA8 sprites without adding an image dependency to the game.
function rgbaSprite(name){
  const png=readFileSync(new URL(`../../public/assets/vfx/${name}.png`,import.meta.url));
  expect(Array.from(png.subarray(0,8))).toEqual([137,80,78,71,13,10,26,10]);
  expect(png[24]).toBe(8);expect(png[25]).toBe(6);expect(png[28]).toBe(0);
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20),chunks=[];
  for(let offset=8;offset<png.length;){const size=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+size));offset+=size+12;}
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*4,pixels=new Uint8Array(stride*height);
  expect(raw.length).toBe((stride+1)*height);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];expect(filter).toBeLessThanOrEqual(4);
    for(let x=0;x<stride;x++){
      const i=y*stride+x,a=x>=4?pixels[i-4]:0,b=y?pixels[i-stride]:0,c=y&&x>=4?pixels[i-stride-4]:0;
      const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
      const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;
      pixels[i]=(raw[y*(stride+1)+1+x]+predictor)&255;
    }
  }
  return {width,height,pixels};
}

test.each(['flame','smoke','impact','shard'])('%s palette sprite is neutral, transparent, centered and fills its square without a dominant axis',(name)=>{
  const {width,height,pixels}=rgbaSprite(name);
  expect(width).toBe(64);expect(height).toBe(64);
  let left=width,right=-1,top=height,bottom=-1,edgeAlpha=0,chroma=0,weight=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,a=pixels[i+3];
    if(x===0||y===0||x===width-1||y===height-1)edgeAlpha=Math.max(edgeAlpha,a);
    if(a>0)chroma=Math.max(chroma,Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2]));
    if(a>=16){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    weight+=a;sx+=x*a;sy+=y*a;sxx+=x*x*a;syy+=y*y*a;sxy+=x*y*a;
  }
  expect(weight).toBeGreaterThan(0);
  expect.soft(edgeAlpha,'transparent texture perimeter').toBe(0);expect.soft(chroma,'visible pixels must be exactly grayscale for emitter tinting').toBe(0);
  expect.soft((right-left+1)/width,'horizontal alpha footprint').toBeGreaterThanOrEqual(.85);
  expect.soft((bottom-top+1)/height,'vertical alpha footprint').toBeGreaterThanOrEqual(.85);
  const cx=sx/weight,cy=sy/weight,xx=sxx/weight-cx*cx,yy=syy/weight-cy*cy,xy=sxy/weight-cx*cy;
  expect.soft(Math.abs(cx-(width-1)/2)/width,'horizontal centroid offset').toBeLessThanOrEqual(.1);
  expect.soft(Math.abs(cy-(height-1)/2)/height,'vertical centroid offset').toBeLessThanOrEqual(.1);
  const difference=Math.hypot(xx-yy,2*xy),ratio=Math.sqrt((xx+yy+difference)/(xx+yy-difference));
  expect.soft(ratio,'alpha-weighted principal deviation ratio').toBeLessThanOrEqual(1.3);
});

function particle(kind,{scale=1,seed=73,position=[3,7,-2],direction=[1,0,0]}={}){
  const component=layerEffect(kind,0,scale),{layout,program}=component,record=new Uint32Array(PARTICLE_RECORD_WORD_COUNT),floats=new Float32Array(record.buffer),builtins=[];
  builtins[VM_BUILTIN.EMITTER_POSITION]=[...position,0];builtins[VM_BUILTIN.EMITTER_DIRECTION]=[...direction,0];
  builtins[VM_BUILTIN.EMITTER_UP]=[0,1,0,0];builtins[VM_BUILTIN.DELTA_TIME]=[0,0,0,0];
  const run=words=>{const result=execute_particle_vm({...program,words,record,builtins,rng_state:seed});seed=result.rng_state;return result;};
  run(program.init);
  return {component,read:(name,count=1)=>Array.from(floats.slice(layout.offsetOf(name),layout.offsetOf(name)+count)),
    moveEmitter(position){builtins[VM_BUILTIN.EMITTER_POSITION]=[...position,0];},
    atAge(age){floats[layout.offsetOf('age')]=age;return this.update();},
    update(dt=0){builtins[VM_BUILTIN.DELTA_TIME][0]=dt;return run(program.update);}};
}

test.each(profiles)('%s has finite native trajectories and a varied bounded lifetime',(kind,profile)=>{
  const lives=[];
  for(const seed of seeds)for(const dt of [1/60,1/20]){
    const p=particle(kind,{seed,scale:1.7}),life=p.read('life')[0];lives.push(life);
    expect(life).toBeGreaterThanOrEqual(profile.life*.75-.000001);expect(life).toBeLessThanOrEqual(profile.life+.000001);
    let killed=false,time=0;
    while(time<=profile.life+dt){
      const result=p.update(dt);time+=dt;
      for(const [name,count] of [['position',3],['velocity',3],['color',4],['size',1],['rotation',1]])expect(p.read(name,count).every(Number.isFinite),name).toBe(true);
      expect(p.read('size')[0]).toBeGreaterThan(0);
      if(result.killed){killed=true;expect(time).toBeGreaterThanOrEqual(life-.000001);expect(time).toBeLessThanOrEqual(life+dt+.000001);break;}
    }
    expect(killed).toBe(true);
    const exact=particle(kind,{seed});expect(exact.atAge(profile.life+.000001).killed).toBe(true);
  }
  expect(Math.max(...lives)-Math.min(...lives)).toBeGreaterThan(profile.life*.05);
});

test.each(profiles)('%s fades visible contribution before its individual GPU death',(kind,profile)=>{
  const p=particle(kind),life=p.read('life')[0];expect(p.atAge(life*.4).killed).toBe(false);
  const visible=p.read('color',4);expect(visible[3]).toBeGreaterThan(.01);
  expect(p.atAge(life*.999).killed).toBe(false);const fading=p.read('color',4);
  expect(fading[3]).toBeLessThan(visible[3]*.001);
  if(!profile.alpha)for(let i=0;i<3;i++)expect(fading[i]).toBeLessThan(visible[i]*.001);
  expect(p.atAge(life+.00001).killed).toBe(true);expect(p.read('color',4)[3]).toBe(0);
});

test.each(profiles)('%s binds a shipped RGBA sprite and the native rendering attributes',(kind,profile)=>{
  const c=layerEffect(kind);expect(c).toBeInstanceOf(ParticleEffect);
  expect(emitter_flags_blend(c.flags)).toBe(profile.alpha?EMITTER_BLEND.ALPHA:EMITTER_BLEND.ADDITIVE);
  expect(!!(c.flags&EMITTER_FLAG.LIGHTING)).toBe(!!profile.alpha&&!profile.unlit);
  expect(!!(c.flags&EMITTER_FLAG.SOFT_DEPTH)).toBe(!kind.endsWith('flash'));
  expect(emitter_flags_projection(c.flags)).toBe(profile.vertical?EMITTER_PROJECTION.VERTICAL:profile.stretched?EMITTER_PROJECTION.STRETCHED:EMITTER_PROJECTION.BILLBOARD);
  expect(c.render_velocity).toBe(c.layout.offsetOf('velocity'));expect(c.render_rotation).toBe(c.layout.offsetOf('rotation'));
  const png=readFileSync(new URL('../../public'+c.texture,import.meta.url));
  expect(Array.from(png.subarray(0,8))).toEqual([137,80,78,71,13,10,26,10]);expect(png.toString('ascii',12,16)).toBe('IHDR');
  expect(png.readUInt32BE(16)).toBeGreaterThan(0);expect(png.readUInt32BE(20)).toBeGreaterThan(0);expect(png[24]).toBe(8);expect(png[25]).toBe(6);
});

test.each(['hit-flash','arcane-flash','cinder-flash'])('%s is visible immediately at its contact and stays there',(kind)=>{
  const position=[41,12,-63];
  for(const seed of seeds){
    const p=particle(kind,{seed,position}),spawn=p.read('position',3);expect(p.read('color',4)[3]).toBeGreaterThan(.5);
    expect(Math.hypot(...spawn.map((v,i)=>v-position[i]))).toBeLessThan(.05);
    p.update(p.read('life')[0]*.4);expect(p.read('position',3)).toEqual(spawn);
  }
});

test('impact sparks separate quickly while dust stays compact and sparks fall under gravity',()=>{
  let sparks=0,dust=0;
  for(const seed of seeds){
    const spark=particle('hit-spark',{seed}),cloud=particle('hit-dust',{seed});
    sparks+=Math.hypot(...spark.read('velocity',3));dust+=Math.hypot(...cloud.read('velocity',3));
    spark.update(.12);expect(spark.read('velocity',3)[1]).toBeLessThan(particle('hit-spark',{seed}).read('velocity',3)[1]);
  }
  expect(sparks).toBeGreaterThan(dust*2);
});

test('fire flames rise and narrow while smoke rises and expands',()=>{
  for(const kind of ['fire-core','fire-flame','fire-smoke'])for(const seed of seeds){
    const p=particle(kind,{seed}),start=p.read('position',3),size=p.read('size')[0];
    const dt=p.read('life')[0]*.04;for(let i=0;i<10;i++)p.update(dt);
    expect(p.read('position',3)[1]).toBeGreaterThan(start[1]+.05);
    if(kind==='fire-smoke')expect(p.read('size')[0]).toBeGreaterThan(size);else expect(p.read('size')[0]).toBeLessThan(size);
  }
});

test.each(profiles.filter(([,profile])=>profile.alpha))('%s keeps its alpha-layer albedo as coverage fades',(kind)=>{
  const p=particle(kind),life=p.read('life')[0];p.atAge(life*.4);const visible=p.read('color',4);
  p.atAge(life*.99);const faded=p.read('color',4);expect(faded[3]).toBeLessThan(visible[3]*.01);
  for(let i=0;i<3;i++)expect(faded[i]).toBeCloseTo(visible[i],6);
});

test.each(['hit-spark','hit-chips','hit-blood','arcane-shard'])('%s directs its outgoing burst using the native emitter direction',(kind)=>{
  for(const seed of seeds){
    const right=particle(kind,{seed,direction:[1,0,0]}),left=particle(kind,{seed,direction:[-1,0,0]});
    expect(right.read('position',3)).toEqual(left.read('position',3));
    expect(right.read('velocity',3)[0]).toBeGreaterThan(left.read('velocity',3)[0]);
    for(let i=0;i<4;i++){right.update(.025);left.update(.025);}
    expect(right.read('position',3)[0]).toBeGreaterThan(left.read('position',3)[0]+.1);
    expect(right.read('position',3)[1]).toBeCloseTo(left.read('position',3)[1],6);
  }
});

test.each(['heal-wisp','heal-glint','heal-haze','hit-spark','hit-chips'])('%s applies its authored emitter-follow behavior to already-born particles',(kind)=>{
  const origin=[3,7,-2],delta=[4,-1,6],p=particle(kind,{position:origin}),reference=particle(kind,{position:origin});
  p.update(.1);reference.update(.1);p.moveEmitter(origin.map((v,i)=>v+delta[i]));
  p.update(.05);reference.update(.05);
  for(let i=0;i<3;i++)expect(p.read('position',3)[i]-reference.read('position',3)[i]).toBeCloseTo(kind.startsWith('heal-')?delta[i]:0,5);
  // A stationary emitter after the move must not apply the same translation twice.
  p.update(.05);reference.update(.05);
  for(let i=0;i<3;i++)expect(p.read('position',3)[i]-reference.read('position',3)[i]).toBeCloseTo(kind.startsWith('heal-')?delta[i]:0,5);
});
