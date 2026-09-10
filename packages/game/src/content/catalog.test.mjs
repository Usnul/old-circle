import {expect,test} from 'vitest';
import {BOSSES,ENEMIES,levelCost} from './catalog.mjs';
import {REGIONS} from '../world/regions.mjs';

test('one clear provides a viable level budget for the next region without farming',()=>{
  let level=1,embers=0;
  for(let area=0;area<REGIONS.length;area++){
    const region=REGIONS[area];for(let i=0;i<7;i++)embers+=ENEMIES[region.enemies[i%region.enemies.length]].reward;
    embers+=BOSSES[region.boss].reward;
    while(embers>=levelCost(level)){embers-=levelCost(level);level++;}
    const next=REGIONS[area+1]??region;expect(level).toBeGreaterThanOrEqual(next.level[0]-1);expect(level).toBeLessThanOrEqual(next.level[1]+1);
  }
});
