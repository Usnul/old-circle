import {expect,test} from 'vitest';
import {EntityManager} from '@woosh/meep-engine/src/engine/ecs/EntityManager.js';
import {EntityComponentDataset} from '@woosh/meep-engine/src/engine/ecs/EntityComponentDataset.js';
import {Trail3DSystem} from '@woosh/meep-engine/src/engine/graphics3/Trail3DSystem.js';
import {Trail3DFlags} from '@woosh/meep-engine/src/engine/graphics/ecs/trail3d/Trail3DFlags.js';
import {CombatTrails} from './combat-trails.mjs';
import {GameWorld} from '@old-circle/game/simulation/world.mjs';
import {weaponPose} from '@old-circle/game/simulation/weapon-pose.mjs';

test('native trails follow the presented blade, fade outside damage windows, and clear across authority changes',async()=>{
  const em=new EntityManager(),ecd=new EntityComponentDataset(),system=new Trail3DSystem({add_extension:e=>e,remove_extension:()=>{}});em.addSystem(system);em.attachDataset(ecd);
  await new Promise((resolve,reject)=>em.startup(resolve,reject));const world=await new GameWorld().start({populate:false,navigation:false}),p=world.addPlayer('you');
  const trails=new CombatTrails({ecd});
  try{
    Object.assign(p,{attackAge:.1,attackId:1,attackKind:'weapon',grounded:true});trails.update([p],[],p,1,1/60);expect(system.batch.count).toBe(0);
    for(let frame=0;frame<12;frame++){p.attackAge=.18+frame*.02;trails.update([p],[],p,1,1/60);system.update(1/60);}
    expect(system.batch.count).toBe(1);const e=[...trails.entries.values()][0];expect(e.last).toEqual(weaponPose(p).end);
    const mesh=system.batch.meshes[0];expect(mesh.geometry.getAttribute('position').data.every(Number.isFinite)).toBe(true);
    p.attackAge=.5;trails.update([p],[],p,1,1/60);expect(e.trail.getFlag(Trail3DFlags.Spawning)).toBe(false);
    for(let i=0;i<15;i++){trails.update([p],[],p,1,1/60);system.update(1/60);}expect(system.batch.count).toBe(0);
    p.attackAge=.22;trails.update([p],[],p,1,1/60);const prior=[...trails.entries.values()][0].trail;
    p.x+=150;trails.update([p],[],p,2,1/60);system.update(1/60);expect(prior.tube).toBeNull();expect(system.batch.count).toBe(1);expect([...trails.entries.values()][0].last).toEqual(weaponPose(p).end);
    const shots=Array.from({length:100},(_,i)=>({id:i,weapon:'staff',position:[p.x+i*.1,p.y,p.z],age:.1}));
    trails.update([p],shots,p,2,1/60);expect(system.batch.count).toBeLessThanOrEqual(24);
    trails.clear();expect(system.batch.count).toBe(0);
  }finally{await world.stop();await new Promise((resolve,reject)=>em.shutdown(resolve,reject));}
});
