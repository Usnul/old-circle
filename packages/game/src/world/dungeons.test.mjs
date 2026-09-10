import {afterEach,expect,test} from 'vitest';
import {GameWorld} from '../simulation/world.mjs';
import {DUNGEONS,dungeonPoint,dungeonRoomAt} from './dungeons.mjs';
import {heightAt,WORLD_VERSION,SPAWN} from './regions.mjs';
import {loadNavigation} from './navigation-data.mjs';
import {RELICS,flaskCapacity} from '../content/relics.mjs';

const worlds=[];
async function setup(populate=false){const w=await new GameWorld().start({populate});worlds.push(w);return w;}
afterEach(async()=>{for(const w of worlds)await w.stop();worlds.length=0;});
const foot=a=>[a.x,a.y-.845,a.z];
const run=(w,n)=>{for(let i=0;i<n;i++)w.step();};
function walk(w,p,route){
  expect(route.reachable).toBe(true);
  for(const target of route.points){
    const budget=180+Math.ceil(Math.hypot(...target.map((v,i)=>v-foot(p)[i]))*60/2);
    let steps=0;
    while(Math.hypot(...target.map((v,i)=>v-foot(p)[i]))>.32&&steps++<budget){
      const dx=target[0]-p.x,dz=target[2]-p.z,length=Math.hypot(dx,dz);
      w.input(p.id,{x:dx/Math.max(.01,length),z:dz/Math.max(.01,length),yaw:Math.atan2(-dx,-dz),buttons:0});w.step();
    }
    expect(steps,`Motor stalled at ${foot(p)} toward ${target}`).toBeLessThan(budget);
  }
}

test('stacked rooms retain their own navigation layer and connect through the ascent',async()=>{
  const nav=await loadNavigation(),d=DUNGEONS[0],lower=dungeonPoint(d,[0,18,0]),upper=dungeonPoint(d,[0,18,4.8]);
  expect(dungeonRoomAt(lower,heightAt).room.id).toBe('chapter');
  expect(dungeonRoomAt(upper,heightAt).room.id).toBe('relic');
  for(const [from,to] of [[lower,upper],[upper,lower]]){
    const path=nav.tile(from).path(from,to);
    expect(path.reachable).toBe(true);expect(path.length).toBeGreaterThan(35);
    expect(path.points.some(p=>p[0]<d.origin[0]-13)).toBe(true);
    expect(path.points.at(-1)[1]).toBeCloseTo(to[1],3);
  }
  const samples=d.rooms.map(r=>dungeonPoint(d,[(r.rect[0]+r.rect[2])/2,(r.rect[1]+r.rect[3])/2,r.level+(r.rise??0)/2]));
  samples.push(dungeonPoint(d,[0,13,0]));
  for(const from of samples)for(const to of samples)expect(nav.tile(from).path(from,to).reachable,`${from} → ${to}`).toBe(true);
});

test.each(DUNGEONS)('$name has connected room floors and a physically walkable route from the approach to its personal reward',async d=>{
  const w=await setup(),p=w.addPlayer('walker'),r=RELICS.find(r=>r.id===d.treasure.id),start=dungeonPoint(d,d.entrance);
  start[1]=heightAt(start[0],start[2]);w.teleport(p,[start[0],start[1]+.9,start[2]]);run(w,30);
  const samples=d.rooms.map(r=>dungeonPoint(d,[(r.rect[0]+r.rect[2])/2,(r.rect[1]+r.rect[3])/2,r.level+(r.rise??0)/2]));
  for(const from of samples)for(const to of samples)expect(w.navigation.tile(from).path(from,to).reachable,`${from} → ${to}`).toBe(true);
  const goal=[r.position[0],r.position[1],r.position[2]+1.5],route=w.navigation.tile(start).path(foot(p),goal);
  walk(w,p,route);
  expect(p.y-.845).toBeCloseTo(r.position[1],1);expect(w.interact(p)).toBe(true);
  expect(p.relics).toContain(r.id);
  if(d.id==='ashen-cistern'){
    // The cistern has a second ascent instead of an exposed drop.
    const east=dungeonPoint(d,[12,24,-4.8]);walk(w,p,w.navigation.tile(foot(p)).path(foot(p),east));
    walk(w,p,w.navigation.tile(foot(p)).path(foot(p),start));
    expect(Math.hypot(...start.map((v,i)=>v-foot(p)[i]))).toBeLessThan(.35);
  }else{
    const bridge=dungeonPoint(d,[d.exit[0],d.exit[1]+2,d.exit[2]]);
    w.teleport(p,[bridge[0],bridge[1]+.9,bridge[2]]);w.input(p.id,{x:0,z:1,yaw:Math.PI,buttons:0});
    let steps=0;while(p.y-.845>bridge[1]-1&&steps++<360)w.step();
    expect(steps,`Return stalled at ${foot(p)}`).toBeLessThan(360);expect(p.hp).toBeGreaterThan(0);
    expect(p.z).toBeGreaterThan(d.origin[1]-d.exit[1]);
  }
},30000);

test('a relic is personal, collected once, and survives save, rest and death',async()=>{
  const w=await setup(),p=w.addPlayer('host'),late=w.addPlayer('late'),r=RELICS[0];
  w.teleport(p,[r.position[0],r.position[1]+.85,r.position[2]+1.5]);const embers=p.embers;
  expect(w.interact(p)).toBe(true);expect(p.embers).toBe(embers+r.embers);expect(flaskCapacity(p)).toBe(4);
  expect(w.interact(p)).toBe(false);expect(p.embers).toBe(embers+r.embers);
  w.teleport(p,[SPAWN[0],heightAt(SPAWN[0],SPAWN[2])+1,SPAWN[2]]);
  w.teleport(late,[r.position[0],r.position[1]+.85,r.position[2]+1.5]);expect(w.interact(late)).toBe(true);
  const save=w.exportCharacter(p.id);p.relics=[];w.importCharacter(p.id,save);expect(p.relics).toEqual([r.id]);
  p.flasks=0;expect(w.rest(p)).toBe(true);expect(p.flasks).toBe(4);
  p.flasks=0;w.respawn(p);expect(p.flasks).toBe(4);
  save.relics=[r.id,r.id,'unknown'];save.flasks=100;w.importCharacter(p.id,save);expect(p.relics).toEqual([r.id]);expect(p.flasks).toBe(4);
  delete save.relics;w.importCharacter(p.id,save);expect(flaskCapacity(p)).toBe(3);expect(p.flasks).toBe(3);
});

test('an enemy pursues a remembered player on the floor directly above using the connecting rooms',async()=>{
  const w=await setup(),d=DUNGEONS[0],p=w.addPlayer('above'),lower=dungeonPoint(d,[0,18,0]),upper=dungeonPoint(d,[0,18,4.8]);
  w.teleport(p,[upper[0],upper[1]+.85,upper[2]]);
  const a=w.spawnActor('pursuer',{kind:'enemy',archetype:'hollow',dungeon:d.id,weapon:'sword'},[lower[0],lower[1]+.85,lower[2]]);
  a.targetId=p.id;a.memory=90;
  let usedAscent=false;
  for(let i=0;i<3000&&p.hp===p.healthMax;i++){w.step();usedAscent ||= a.x<d.origin[0]-13;}
  expect(usedAscent).toBe(true);expect(a.y-.845).toBeCloseTo(upper[1],1);expect(p.hp).toBeLessThan(p.healthMax);
},30000);

test('an older persistent world gains new authored encounters while keeping deaths, progression and upper-floor homes',async()=>{
  const w=await setup(true),p=w.addPlayer('saved'),saved=w.snapshot();saved.contentVersion=WORLD_VERSION-1;
  saved.actors=saved.actors.filter(a=>!a.dungeon);
  const boss=saved.actors.find(a=>a.boss);boss.hp=0;boss.deadTime=7;
  saved.actors.find(a=>a.id===p.id).embers=734;
  w.restoreWorld(saved);
  expect(w.actor(boss.id).hp).toBe(0);expect(w.actor(boss.id).deadTime).toBe(7);expect(w.actor(p.id).embers).toBe(734);
  for(const dungeon of DUNGEONS)expect([...w.actors.keys()].map(id=>w.actor(id)).filter(a=>a.dungeon===dungeon.id)).toHaveLength(dungeon.encounters.length);
  const d=DUNGEONS[0],lookout=w.actor(`${d.id}-gallery`);
  expect(lookout.dungeon).toBe(d.id);expect(lookout.home[1]).toBeCloseTo(d.elevation+4.8+.85);
  expect([...w.actors.keys()].filter(id=>w.actor(id).dungeon===d.id)).toHaveLength(d.encounters.length);
  const current=w.snapshot();w.restoreWorld(current);expect(w.actor(lookout.id).home[1]).toBeCloseTo(lookout.home[1]);
  // Replication is an exact authoritative replacement, never a content merge.
  w.replaceSnapshot({...current,actors:current.actors.filter(a=>!a.dungeon)});expect(w.actor(lookout.id)).toBeUndefined();
});
