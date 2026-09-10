import {expect,test} from 'vitest';
import {Characters} from './characters.mjs';
import {BOSSES} from '@old-circle/game/content/catalog.mjs';
import {rigs} from '@old-circle/game/simulation/animation.mjs';

test('unadorned banner URLs and every keeper skin resolve to the correct shared rig, including newly received corpses',()=>{
  const requested=[],renderer=new Characters({models:{get(name){requested.push(name);return [];}},materials:{}});
  const banner=renderer.bundle('votiveBanner');expect(banner.skins[0].joints.length).toBe(rigs.votiveBanner.bones.length);expect(requested.at(-1)).toBe('votiveBanner');
  for(const archetype of Object.keys(BOSSES)){
    const corpse={kind:'enemy',archetype,weapon:'spear'},live={...corpse,boss:true};
    expect(renderer.appearance(corpse)).toBe(renderer.appearance(live));
    const bundle=renderer.bundle(renderer.appearance(live));expect(requested.at(-1)).toBe('boss_'+archetype);expect(bundle.skins[0].joints.length).toBe(rigs.pilgrim.bones.length);
  }
});
