import {expect,test} from 'vitest';
import {updateStamina} from './stamina.mjs';

test('holding sprint through exhaustion walks continuously, even after the reserve refills',()=>{
  const a={stamina:1,staminaMax:100,sprintExhausted:false};
  for(let i=0;i<10;i++)updateStamina(a,1/60,{held:true,moving:true});
  expect(a.sprintExhausted).toBe(true);
  for(let i=0;i<600;i++)expect(updateStamina(a,1/60,{held:true,moving:true})).toBe(false);
  expect(a.stamina).toBe(100);
  expect(updateStamina(a,1/60,{held:false,moving:true})).toBe(false);expect(a.sprintExhausted).toBe(false);
  expect(updateStamina(a,1/60,{held:true,moving:true})).toBe(true);
});
test('an exhausted runner must regain reserve before re-entry; sprinting never regenerates',()=>{
  const a={stamina:0,staminaMax:100,sprintExhausted:true};
  updateStamina(a,.1,{held:false,moving:true});expect(a.sprintExhausted).toBe(true);
  expect(updateStamina(a,.1,{held:true,moving:true})).toBe(false);
  a.stamina=26;updateStamina(a,0,{held:false,moving:false});
  expect(updateStamina(a,1,{held:true,moving:true,regeneration:27})).toBe(true);expect(a.stamina).toBe(8);
});
