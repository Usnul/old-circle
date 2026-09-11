import {expect,test} from 'vitest';
import {Actor} from './components.mjs';
import {presentedFeet,FootContacts} from './foot-contacts.mjs';

const floor=f=>({position:[f.position[0],0,f.position[2]],normal:[0,1,0],surface:'stone'});
function cycle({speed=2,crouch=false,boss=false,hound=false,yaw=0,angle=0}={}){
  const a=Object.assign(new Actor(),{id:'walker',grounded:true,y:boss?1.2675:crouch?.495:.845,crouch,boss,archetype:hound?'hound':'player',yaw,vx:Math.sin(angle)*speed,vz:-Math.cos(angle)*speed}),contacts=new FootContacts(),events=[];
  for(let i=0;i<150;i++){
    const time=i/30;a.gaitPhase=time*speed;a.x=a.vx*time;a.z=a.vz*time;a.animationTime=time;
    for(const foot of presentedFeet(a))if(contacts.sample(a,foot,floor(foot),time))events.push({time,name:foot.name,height:foot.position[1]});
  }
  return {a,contacts,events};
}
test('displayed walk, run, crouch and enlarged gaits land once per foot on the floor',()=>{
  for(const options of [{},{speed:6},{speed:1.3,crouch:true},{speed:3,boss:true},{yaw:.73,angle:2.2},{speed:4,hound:true}]){
    const {events}=cycle(options);expect(events.length,JSON.stringify(options)).toBeGreaterThan(5);
    const names=options.hound?['lowerFL','lowerFR','lowerBL','lowerBR']:['footL','footR'];
    for(const name of names){const steps=events.filter(e=>e.name===name);expect(steps.length).toBeGreaterThan(2);for(let i=1;i<steps.length;i++)expect(steps[i].time-steps[i-1].time).toBeGreaterThan(.15);}
    expect(events.every(e=>e.height<.065)).toBe(true);
  }
});
test('standing, airborne feet, walls and replayed travel produce no footfalls',()=>{
  const {a,contacts}=cycle();let events=0;
  for(let i=0;i<90;i++){
    const time=5+i/30;a.gaitPhase=2+i*.03;
    for(const foot of presentedFeet(a))events+=Number(contacts.sample(a,foot,floor(foot),time));
  }
  expect(events).toBe(0);
  contacts.reset(2);a.gaitPhase=0;a.vx=0;a.vz=0;
  for(let i=0;i<90;i++)for(const foot of presentedFeet(a))expect(contacts.sample(a,foot,floor(foot),i/30)).toBe(false);
  for(const mode of ['air','wall','mantle']){
    contacts.reset(3);a.grounded=mode!=='air';a.mantle=mode==='mantle'?{phase:'hang'}:null;a.vz=-3;
    for(let i=0;i<90;i++){a.gaitPhase=i*.1;for(const foot of presentedFeet(a)){const hit=floor(foot);if(mode==='wall')hit.normal=[1,0,0];expect(contacts.sample(a,foot,hit,i/30)).toBe(false);}}
  }
});
test('actual landing contact emits once after flight, including a stationary jump',()=>{
  const a=Object.assign(new Actor(),{id:'jumper',y:.845,grounded:true}),contacts=new FootContacts();
  const sample=time=>presentedFeet(a).filter(foot=>contacts.sample(a,foot,floor(foot),time)).length;
  expect(sample(0)).toBe(0);a.grounded=false;a.y=2;expect(sample(.3)).toBe(0);
  a.grounded=true;a.y=.845;a.vy=0;a.landingAge=0;expect(sample(.8)).toBe(2);expect(sample(.9)).toBe(0);
});
