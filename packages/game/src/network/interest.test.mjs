import {expect,test} from 'vitest';
import {projectWorld,INTEREST} from './interest.mjs';
import {GameWorld} from '../simulation/world.mjs';

test('interest uses a three-dimensional boundary with hysteresis and bounded nearby effects',()=>{
  const p={id:'you',x:0,y:0,z:0},near={id:'near',x:95,y:0,z:0},edge={id:'edge',x:104,y:0,z:0},above={id:'above',x:0,y:120,z:0};
  const snapshot={version:1,tick:1,time:12,actors:[p,near,edge,above],projectiles:Array.from({length:160},(_,id)=>({id,position:[id,0,0]})),events:Array.from({length:300},(_,tick)=>({tick,id:'near',position:[0,0,0]}))};
  const first=projectWorld(snapshot,p.id);expect(first.actors.map(a=>a.id)).toEqual(['you','near']);expect(first.projectiles.length).toBeLessThanOrEqual(INTEREST.projectiles);expect(first.events).toHaveLength(INTEREST.events);
  near.x=110;expect(projectWorld(snapshot,p.id,first).actors.map(a=>a.id)).toContain('near');near.x=113;expect(projectWorld(snapshot,p.id,first).actors.map(a=>a.id)).not.toContain('near');
  const crowd={...snapshot,actors:[...Array.from({length:180},(_,i)=>({id:`actor-${i}`,x:i*.4,y:0,z:0})),p]};
  const scoped=projectWorld(crowd,p.id);expect(scoped.actors).toHaveLength(INTEREST.actors);expect(scoped.actors[0].id).toBe(p.id);
  const archer={id:'distant-archer',x:130,y:0,z:0,path:[[0,0,0]],patrolGoal:[1,0,0]},arrow={id:1,owner:archer.id,position:[40,0,0]};
  const attack=projectWorld({...snapshot,actors:[p,archer],projectiles:[arrow]},p.id);
  expect(attack.actors.map(a=>a.id)).toContain(archer.id);expect(attack.actors.find(a=>a.id===archer.id)).not.toHaveProperty('path');
});

test('disconnect restores dormant enemies into the warm world and reconnect discards the previous offline branch',async()=>{
  const w=await new GameWorld().start(),physics=w.physics,p=w.addPlayer('you');
  try{
    const full=w.snapshot(),near=full.actors.find(a=>a.id==='enemy-0'),far=full.actors.find(a=>a.id==='enemy-30');
    w.actor(far.id).hp=0; // This offline branch is not server authority.
    near.hp=17;w.replaceSnapshot({...full,scope:'nearby',actors:[structuredClone(p),near]});expect(w.actor(far.id)).toBeUndefined();
    w.replaceSnapshot({...full,scope:'nearby',tick:full.tick+30,actors:[structuredClone(p)]});expect(w.actor(near.id)).toBeUndefined();
    w.resumeLocalWorld(p.id);expect(w.physics).toBe(physics);expect(w.actor(near.id).hp).toBe(17);expect(w.actor(far.id).hp).toBe(far.hp);
    w.actor(far.id).hp=0;w.replaceSnapshot({...full,scope:'nearby',actors:[structuredClone(p),near]});w.resumeLocalWorld(p.id);
    expect(w.actor(far.id).hp).toBe(far.hp);expect(w.actors.size).toBe(full.actors.length);
  }finally{await w.stop();}
});

test('a saturated nearby view retains projectile owners ahead of unrelated bystanders',()=>{
  const player={id:'you',x:0,y:0,z:0},owner={id:'distant-keeper',x:130,y:0,z:0};
  const bystanders=Array.from({length:INTEREST.actors},(_,i)=>({id:`bystander-${i}`,x:i*.1,y:0,z:0}));
  const projectile={id:1,owner:owner.id,position:[1,0,0]};
  const snapshot={tick:1,time:12,actors:[player,...bystanders,owner],projectiles:[projectile],events:[]};
  const scoped=projectWorld(snapshot,player.id);
  expect(scoped.actors).toHaveLength(INTEREST.actors);expect(scoped.actors.map(a=>a.id)).toContain(owner.id);
  expect(scoped.actors[0].id).toBe(player.id);expect(scoped.projectiles).toEqual([projectile]);

  const owners=Array.from({length:INTEREST.projectiles},(_,i)=>({id:`owner-${i}`,x:130+i,y:0,z:0}));
  const crowded=projectWorld({...snapshot,actors:[player,...owners],projectiles:owners.map((a,id)=>({id,owner:a.id,position:[1,0,0]}))},player.id);
  expect(crowded.actors).toHaveLength(INTEREST.actors);
  expect(crowded.projectiles).toHaveLength(INTEREST.actors-1);
  const retained=new Set(crowded.actors.map(a=>a.id));expect(crowded.projectiles.every(p=>retained.has(p.owner))).toBe(true);
});
