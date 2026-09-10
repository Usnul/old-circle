export const BOSS_MOVES={
  weapon:{name:'Keeper’s strike',windup:.8,recovery:1.9,range:3.4},
  bell:{name:'Toll of the hollow bell',windup:1.2,recovery:1.45,range:12,clip:'bell_slam'},
  roots:{name:'Widow’s grasp',windup:1.05,recovery:1.4,range:15,clip:'root_call'},
  cinders:{name:'Cinder hymn',windup:.95,recovery:1.1,range:18,clip:'cinder_volley'},
  mirrors:{name:'Listening stars',windup:1.1,recovery:1.3,range:18,clip:'mirror_prayer'},
  winter:{name:'Winter’s procession',windup:1.15,recovery:1.5,range:17,clip:'winter_sweep'},
  judgment:{name:'The last decree',windup:1.45,recovery:1.7,range:16,clip:'king_judgment'},
};
const patterns={
  warden:[['weapon','bell','weapon'],['bell','weapon','bell']],
  rootbound:[['weapon','roots','weapon'],['roots','weapon','roots']],
  cantor:[['cinders','weapon','cinders'],['cinders','roots','cinders']],
  mirror:[['mirrors','weapon','mirrors'],['mirrors','winter','mirrors']],
  frostbound:[['weapon','winter','weapon'],['winter','bell','weapon']],
  'last-king':[['weapon','judgment','cinders'],['judgment','winter','judgment','weapon']],
};
export const bossEnraged=a=>a.hp<=a.healthMax*.5;
export function nextBossMove(a){const pattern=patterns[a.archetype]?.[Number(bossEnraged(a))]??['weapon'];return pattern[a.attackId%pattern.length];}
export const waveRadius=(p,age=p.age)=>Math.min(p.maxRadius,Math.max(0,age-p.delay)*p.speed);
export const WAVE_INNER_FRACTION=.9;
