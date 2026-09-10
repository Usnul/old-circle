import {afterEach,expect,test} from 'vitest';
import {GameWorld} from '../simulation/world.mjs';
import {CHARMS,charmFor,charmDamage,focusCost} from './charms.mjs';
import {RELICS} from './relics.mjs';
import {weaponDamage,migrateInventory} from './equipment.mjs';
import {SPAWN,heightAt} from '../world/regions.mjs';

const worlds=[];
async function setup(){const w=await new GameWorld().start({populate:false,navigation:false});worlds.push(w);return [w,w.addPlayer('seeker')];}
afterEach(async()=>{for(const w of worlds)await w.stop();worlds.length=0;});

test('regional relics are personal once-only rewards, and only an owned charm can be worn at a safe hearth',async()=>{
  const [w,p]=await setup();expect(w.equipCharm(p.id,'briar')).toBe(false);let total=0;
  for(const relic of RELICS.slice(1)){
    w.teleport(p,[relic.position[0],relic.position[1]+.85,relic.position[2]+1.5]);
    expect(w.interact(p),relic.id).toBe(true);total+=relic.embers;expect(p.embers).toBe(total);expect(w.interact(p)).toBe(false);
    expect(w.equipCharm(p.id,relic.charm)).toBe(false);
  }
  w.teleport(p,[SPAWN[0],heightAt(SPAWN[0],SPAWN[2])+1,SPAWN[2]]);
  for(const id of Object.keys(CHARMS)){expect(w.equipCharm(p.id,id)).toBe(true);expect(charmFor(p)).toBe(CHARMS[id]);}
  const saved=w.exportCharacter(p.id);p.inventory.charm='none';p.relics=[];w.importCharacter(p.id,saved);expect(p.inventory.charm).toBe('crown');expect(p.relics).toHaveLength(5);
  saved.relics=[];w.importCharacter(p.id,saved);expect(p.inventory.charm).toBe('none');expect(charmFor(p)).toBe(CHARMS.none);
  expect(migrateInventory({charm:'unknown'}).charm).toBe('none');
});

test('charm tradeoffs change real attack costs, damage and resource recovery without stacking',async()=>{
  const [w,p]=await setup();p.relics=RELICS.map(r=>r.id);p.inventory.weapons.push('bow','staff');
  const bow=weaponDamage(p,'bow'),sword=weaponDamage(p,'sword');expect(w.equipCharm(p.id,'ash')).toBe(true);
  expect(weaponDamage(p,'bow')).toBeCloseTo(bow*1.2);expect(weaponDamage(p,'sword')).toBeCloseTo(sword*.9);
  expect(w.equipCharm(p.id,'glass')).toBe(true);expect(weaponDamage(p,'bow')).toBe(bow);expect(charmDamage(p,'magic')).toBe(1.1);expect(focusCost(p,12)).toBeCloseTo(9.6);
  p.weapon='staff';p.mana=9.6;w.attack(p);expect(p.attackId).toBe(1);expect(p.mana).toBeCloseTo(0);
  p.attackAge=-1;p.cooldown=0;p.mana=p.manaMax;expect(w.equipCharm(p.id,'briar')).toBe(true);
  p.stamina=10;for(let i=0;i<60;i++)w.step();expect(p.stamina).toBeCloseTo(10+22*1.22,5);
  expect(w.equipCharm(p.id,'frost')).toBe(true);p.mana=0;for(let i=0;i<60;i++)w.step();expect(p.mana).toBeCloseTo(3*.8,5);
  const enemy=w.spawnActor('test-enemy',{kind:'enemy',weapon:'sword'},[p.x+10,p.y,p.z]);const hp=p.hp;
  expect(w.damage(enemy,p,100,0)).toBe(true);expect(hp-p.hp).toBeCloseTo(100*.88*.85);
  const saved=w.exportCharacter(p.id);saved.inventory.charm='crown';w.importCharacter(p.id,saved);p.hp=p.healthMax;
  w.damage(enemy,p,50,0,'magic');expect(p.healthMax-p.hp).toBeCloseTo(50*.94*1.18);
  expect(charmFor(enemy)).toBe(CHARMS.none);
});
