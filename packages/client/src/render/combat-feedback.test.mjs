import {expect,test,vi} from 'vitest';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {CombatFeedback} from './combat-feedback.mjs';
import {PresentationEvents} from '../presentation-events.mjs';

test('healing glows follow actors, damage feedback stays local, repeated events do not restart, and transients expire',()=>{
  const ecd=new EntityComponentDataset();ecd.registerComponentType(Transform64);
  const overlay={style:{}},view={ecd,emitter:vi.fn(()=>({id:200})),particles:{burst:vi.fn()},light(position){
    const id=ecd.createEntity(),t=new Transform64();t.setTranslation(...position);ecd.addComponentToEntity(id,t);return {id,t,l:{intensity:{set:vi.fn()}}};
  }},feedback=new CombatFeedback(view,overlay);
  const actor={id:'self',x:1,y:2,z:3,hp:70,healthMax:100},actors=[actor];
  const events=[{type:'heal',id:'self',key:'heal:1',position:[1,2,3]},{type:'hit',id:'self',key:'hit:1',damage:20}];
  const snapshot={presentationEpoch:1,events};feedback.update(snapshot,actors,'self',.016);
  expect(view.emitter).toHaveBeenCalledWith('heal',[1,2,3],0,1.5);expect(view.particles.burst).toHaveBeenCalledTimes(1);
  expect(Number(overlay.style.opacity)).toBeGreaterThan(.5);expect(Math.abs(feedback.cameraKick().pitch)).toBeGreaterThan(0);
  const light=feedback.healing.get('self').light;actor.x=4;
  feedback.update(structuredClone(snapshot),actors,'self',.1);expect(view.particles.burst).toHaveBeenCalledTimes(1);expect(light.t.translation_x).toBe(4);
  for(let i=0;i<15;i++)feedback.update({presentationEpoch:1,events:[]},actors,'self',.1);
  expect(overlay.style.opacity).toBe('0');expect(Math.abs(feedback.cameraKick().pitch)).toBe(0);expect(Math.abs(feedback.cameraKick().roll)).toBe(0);expect(ecd.entityExists(light.id)).toBe(false);
  feedback.update({presentationEpoch:1,events:[{type:'hit',id:'enemy',key:'hit:2',damage:90}]},actors,'self',.016);expect(overlay.style.opacity).toBe('0');
  feedback.update({...snapshot,presentationEpoch:2},actors,'self',.016);expect(view.particles.burst).toHaveBeenCalledTimes(2);
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
