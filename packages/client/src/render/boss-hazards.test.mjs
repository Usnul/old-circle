import {expect,test,vi} from 'vitest';
import {BossHazards} from './boss-hazards.mjs';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Transform64} from '@woosh/meep-engine/src/engine/ecs/transform/Transform64.js';
import {Decal} from '@woosh/meep-engine/src/engine/graphics/ecs/decal/v2/Decal.js';
import {waveRadius} from '@old-circle/game/content/boss-moves.mjs';
import {heightAt} from '@old-circle/game/world/regions.mjs';

test('native warnings retain their projector through replay, burst once, fade and release all entities',()=>{
  const ecd=new EntityComponentDataset();for(const c of [Transform64,Decal])ecd.registerComponentType(c);
  let bursts=0;const view={ecd,vfx:{groundBurst(){bursts++;return [];},remove(){}}},hazards=new BossHazards(view);
  const p={id:12,key:'cast:1',kind:'sigil',effect:'roots',radius:2.3,position:[0,2,24],delay:1.4,life:1.85,age:.2};
  hazards.update([p],null,1,.02);const mark=hazards.marks.get(p.key);expect(mark.t.matrix[9]).toBeLessThan(0);expect(mark.t.scale[0]).toBeCloseTo(4.6);expect(bursts).toBe(0);
  hazards.update([{...p,id:59,age:1.41}],null,1,.02);expect(hazards.marks.get(p.key)).toBe(mark);expect(bursts).toBe(1);
  hazards.update([{...p,id:61,age:1.42}],null,1,.02);expect(bursts).toBe(1);
  hazards.update([{...p,age:1.84}],null,1,.02);expect(mark.decal.color.a).toBeLessThan(.1);expect(mark.decal.emissive_intensity).toBeLessThan(.1);
  hazards.update([],null,1,.02);expect(hazards.marks.size).toBe(0);expect(ecd.entityExists(mark.id)).toBe(false);
  hazards.update(Array.from({length:100},(_,i)=>({...p,key:'cast:'+i})),null,1,.02);expect(hazards.marks.size).toBe(64);
  hazards.update([],null,2,.02);expect(hazards.marks.size).toBe(0);
});

test('active waves move continuous layered jets along the terrain boundary, stop on disappearance and release on epoch changes',()=>{
  const ecd=new EntityComponentDataset();for(const c of [Transform64,Decal])ecd.registerComponentType(c);
  const vfx={
    groundBurst:vi.fn(()=>Array.from({length:5},()=>({continuous:true}))),
    move:vi.fn((g,position)=>{g.position=position;}),
    stop:vi.fn(g=>{g.continuous=false;}),remove:vi.fn()
  },hazards=new BossHazards({ecd,vfx});
  const p={id:12,key:'wave:1',kind:'wave',effect:'shockwave',position:[100,200,35],radius:0,maxRadius:12,speed:8,delay:.5,life:2.5,age:.2};
  hazards.update([p],null,1,.02);expect(vfx.groundBurst).not.toHaveBeenCalled();
  const active={...p,age:.6};hazards.update([active],null,1,.02);
  const mark=hazards.marks.get(p.key),groups=mark.effects;
  expect(vfx.groundBurst).toHaveBeenCalledWith('shockwave',p.position,waveRadius(active),{wave:true,continuous:true});
  const first=groups.map(g=>[...g.position]),later={...active,id:61,age:1.2};
  hazards.update([later],null,1,.02);expect(hazards.marks.get(p.key)).toBe(mark);expect(mark.effects).toBe(groups);expect(vfx.groundBurst).toHaveBeenCalledTimes(1);
  for(const [i,g] of groups.entries()){
    const [x,y,z]=g.position;expect(g.continuous).toBe(true);expect(g.position).not.toEqual(first[i]);
    expect(Math.hypot(x-p.position[0],z-p.position[2])).toBeCloseTo(waveRadius(later),6);
    expect(y).toBeCloseTo(heightAt(x,z)+.12,6);
  }
  hazards.update([],null,1,.02);expect(hazards.marks.size).toBe(0);expect(ecd.entityExists(mark.id)).toBe(false);
  for(const g of groups){expect(vfx.stop).toHaveBeenCalledWith(g);expect(g.continuous).toBe(false);}
  expect(vfx.remove).not.toHaveBeenCalled();
  const next={...active,key:'wave:2'};hazards.update([next],null,1,.02);const live=hazards.marks.get(next.key);
  hazards.update([],null,2,.02);expect(hazards.marks.size).toBe(0);expect(hazards.bursts.size).toBe(0);expect(ecd.entityExists(live.id)).toBe(false);
  for(const g of live.effects)expect(vfx.remove).toHaveBeenCalledWith(g);
});
