import {expect,test,vi} from 'vitest';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {CombatFeedback} from './combat-feedback.mjs';
import {PresentationEvents} from '../presentation-events.mjs';

test.each([[165,165],[114,140]])('negative startup time cannot create damage feedback at %i/%i HP', (hp,healthMax)=>{
  const overlay={style:{}},feedback=new CombatFeedback({},overlay),actor={id:'self',hp,healthMax};
  const snapshot={presentationEpoch:1,events:[]};
  feedback.update(snapshot,[actor],'self',0);
  for(const dt of [-3.5,.016,.1]){
    feedback.update(snapshot,[actor],'self',dt);
    expect(overlay.style.opacity).toBe('0');
    const kick=feedback.cameraKick();
    expect(Math.abs(kick.pitch)).toBe(0);expect(Math.abs(kick.roll)).toBe(0);
  }
  const hit={...snapshot,events:[{type:'hit',id:'self',key:'fresh-hit',damage:20}]};
  feedback.update(hit,[actor],'self',.016);
  expect(Number(overlay.style.opacity)).toBeGreaterThan(0);
  const opacity=overlay.style.opacity,kick=feedback.cameraKick();
  feedback.update(hit,[actor],'self',-.5);
  expect(overlay.style.opacity).toBe(opacity);expect(feedback.cameraKick()).toEqual(kick);
  feedback.update(hit,[actor],'self',.1);
  expect(Number(overlay.style.opacity)).toBeLessThan(Number(opacity));
});

test('healing glows follow actors, damage feedback stays local, repeated events do not restart, and transients expire',()=>{
  const ecd=new EntityComponentDataset();ecd.registerComponentType(Transform64);
  const overlay={style:{}},view={ecd,light(position){
    const id=ecd.createEntity(),t=new Transform64();t.setTranslation(...position);ecd.addComponentToEntity(id,t);return {id,t,l:{intensity:{set:vi.fn()}}};
  }},feedback=new CombatFeedback(view,overlay);
  const actor={id:'self',x:1,y:2,z:3,hp:70,healthMax:100},actors=[actor];
  const events=[{type:'heal',id:'self',key:'heal:1',position:[1,2,3]},{type:'hit',id:'self',key:'hit:1',damage:20}];
  const snapshot={presentationEpoch:1,events};feedback.update(snapshot,actors,'self',.016);
  expect(feedback.healing.size).toBe(1);
  expect(Number(overlay.style.opacity)).toBeGreaterThan(.5);expect(Math.abs(feedback.cameraKick().pitch)).toBeGreaterThan(0);
  const light=feedback.healing.get('self').light;actor.x=4;
  feedback.update(structuredClone(snapshot),actors,'self',.1);expect(feedback.healing.get('self').age).toBeCloseTo(.1);expect(light.t.translation_x).toBe(4);
  for(let i=0;i<15;i++)feedback.update({presentationEpoch:1,events:[]},actors,'self',.1);
  expect(overlay.style.opacity).toBe('0');expect(Math.abs(feedback.cameraKick().pitch)).toBe(0);expect(Math.abs(feedback.cameraKick().roll)).toBe(0);expect(ecd.entityExists(light.id)).toBe(false);
  feedback.update({presentationEpoch:1,events:[{type:'hit',id:'enemy',key:'hit:2',damage:90}]},actors,'self',.016);expect(overlay.style.opacity).toBe('0');
  feedback.update({...snapshot,presentationEpoch:2},actors,'self',.016);expect(feedback.healing.size).toBe(1);expect(feedback.healing.get('self').light).not.toBe(light);
});

test('loading 114/140 HP and receiving historical hits stays quiet; a new incoming hit triggers feedback',()=>{
  const overlay={style:{}},feedback=new CombatFeedback({},overlay),events=new PresentationEvents();
  const actor={id:'self',hp:114,healthMax:140,hurtTime:.3},oldHit={type:'hit',id:'self',key:'old-hit',tick:98,damage:26};
  const present=(tick,history,epoch=1)=>{
    const snapshot={tick,events:history,presentationEpoch:epoch};snapshot.events=events.read(snapshot);
    feedback.update(snapshot,[actor],'self',.016);
  };
  present(100,[oldHit]);expect(overlay.style.opacity).toBe('0');expect(feedback.cameraKick().pitch).toBe(0);
  present(101,[oldHit]);expect(overlay.style.opacity).toBe('0');
  actor.hp=108;present(102,[]);expect(overlay.style.opacity).toBe('0');
  present(103,[{...oldHit,key:'new-hit',tick:103,damage:6}]);expect(Number(overlay.style.opacity)).toBeGreaterThan(0);expect(Math.abs(feedback.cameraKick().pitch)).toBeGreaterThan(0);
  present(300,[{...oldHit,tick:299}],2);expect(overlay.style.opacity).toBe('0');expect(feedback.cameraKick().pitch).toBe(0);
});

test('a heal received after a long frame starts at full intensity, including a renewed glow',()=>{
  const ecd=new EntityComponentDataset();ecd.registerComponentType(Transform64);
  const view={ecd,light(position){
    const id=ecd.createEntity(),t=new Transform64();t.setTranslation(...position);ecd.addComponentToEntity(id,t);
    return {id,t,l:{intensity:{set:vi.fn()}}};
  }},feedback=new CombatFeedback(view,null),actor={id:'self',x:1,y:2,z:3,hp:70};
  const heal=key=>({presentationEpoch:1,events:[{type:'heal',id:'self',key,position:[1,2,3]}]});
  feedback.update(heal('first'),[actor],'self',2);
  const glow=feedback.healing.get('self');
  expect(glow).toBeDefined();expect(glow.age).toBe(0);expect(glow.light.l.intensity.set).toHaveBeenLastCalledWith(3);
  feedback.update(heal('renewed'),[actor],'self',2);
  expect(feedback.healing.get('self')).toBe(glow);expect(glow.age).toBe(0);
  feedback.update({presentationEpoch:1,events:[]},[actor],'self',1.3);
  expect(feedback.healing.size).toBe(0);expect(ecd.entityExists(glow.light.id)).toBe(false);
});
