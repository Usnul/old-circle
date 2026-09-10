import {expect,test} from 'vitest';
import {BOSSES,ENEMIES,enemyDamage,levelCost} from './catalog.mjs';
import {REGIONS} from '../world/regions.mjs';
import {DUNGEONS} from '../world/dungeons.mjs';
import {reinforcementCost} from './equipment.mjs';

test('one clear provides a viable level budget for the next region without farming',()=>{
  let level=1,embers=0;
  for(let area=0;area<REGIONS.length;area++){
    const region=REGIONS[area];for(let i=0;i<7;i++)embers+=ENEMIES[region.enemies[i%region.enemies.length]].reward;
    embers+=BOSSES[region.boss].reward;
    while(embers>=levelCost(level)){embers-=levelCost(level);level++;}
    const next=REGIONS[area+1]??region;expect(level).toBeGreaterThanOrEqual(next.level[0]-1);expect(level).toBeLessThanOrEqual(next.level[1]+1);
  }
});

test.each([false,true])('one clear funds a primary weapon reinforcement per region with dungeons=%s',explore=>{
  const actor={level:1,embers:0,weapon:'sword',inventory:{reinforcements:{sword:0}}};
  for(let area=0;area<REGIONS.length;area++){
    const region=REGIONS[area];
    for(let i=0;i<7;i++)actor.embers+=ENEMIES[region.enemies[i%region.enemies.length]].reward;
    actor.embers+=BOSSES[region.boss].reward;
    if(explore){
      for(const d of DUNGEONS.filter(d=>d.region===region.id))actor.embers+=d.treasure.embers+d.encounters.reduce((sum,e)=>sum+ENEMIES[e.type].reward,0);
      if(area===0)actor.embers+=ENEMIES.mage.reward; // The Lost Bellkeeper.
    }
    const cost=reinforcementCost(actor);expect(actor.embers).toBeGreaterThanOrEqual(cost);
    actor.embers-=cost;actor.inventory.reinforcements.sword++;
    while(actor.embers>=levelCost(actor.level)){actor.embers-=levelCost(actor.level);actor.level++;}
    const next=REGIONS[area+1]??region;
    // A weapon-focused road build trades a few attributes for damage. Exploring
    // reaches the next area's upper range, with a final surplus after the King.
    expect(actor.level,region.id).toBeGreaterThanOrEqual(next.level[0]-(explore?0:4));
    expect(actor.level,region.id).toBeLessThanOrEqual(next.level[1]+(area===REGIONS.length-1?6:1));
  }
  expect(actor.inventory.reinforcements.sword).toBe(6);
});

test('ordinary encounter damage rises across the road but never scales authored keeper damage',()=>{
  for(const [archetype,def] of Object.entries(ENEMIES)){
    const damage=level=>enemyDamage({archetype,level});
    expect(damage(1)).toBe(def.damage);expect(damage(0)).toBe(def.damage);
    expect(damage(28)).toBeGreaterThan(def.damage*1.9);
    expect(damage(35)).toBeLessThan(def.damage*2.2);expect(damage(1000)).toBe(damage(35));
    for(let i=1;i<REGIONS.length;i++)expect(damage(REGIONS[i].level[0])).toBeGreaterThan(damage(REGIONS[i-1].level[0]));
  }
  for(const [archetype,def] of Object.entries(BOSSES))expect(enemyDamage({archetype,boss:true,level:def.level})).toBe(def.damage);
});
