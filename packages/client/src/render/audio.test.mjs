import {expect,test,vi} from 'vitest';
import {WorldAudio} from './audio.mjs';
import {EventDescription} from '@woosh/meep-engine/src/engine/sound/sopra/definition/EventDescription.js';
import {ACOUSTIC_VOICE_LIMIT} from './acoustics.mjs';

test('local hurt, healing and exertion stay audible during spatial crowding and replay once per authority epoch',()=>{
  const audio=new WorldAudio({},{lights:[]}),player={id:'player',x:1,y:2,z:3};
  audio.play=vi.fn();audio.sopra={update:vi.fn(),listenerPosition:null,playOneShot:vi.fn()};
  audio.acoustics={update:vi.fn(),stats:{cover:0},simulator:{forget:vi.fn()}};audio.wind={fadeToGainDb:vi.fn()};
  for(const name of ['impact','hurt','effort','potion'])audio.localEvents[name]=Object.assign(new EventDescription(),{label:name,is3D:false});
  for(let i=0;i<ACOUSTIC_VOICE_LIMIT;i++)audio.voices.add({state:1});
  const event=(type,id,key,weapon)=>({type,id,key,weapon,damage:12,position:[1,2,3]});
  const snapshot={presentationEpoch:1,events:[event('hit','player','hit1'),event('hit','enemy','hit2'),event('heal','player','heal1'),event('heal','ally','heal2'),event('attack','player','attack1','sword'),event('jump','player','jump1')],actors:[player]};
  audio.update(snapshot,player,.016);
  expect(audio.sopra.playOneShot.mock.calls.map(([description])=>description.label)).toEqual(['impact','hurt','potion','effort','effort']);
  for(const [description,options] of audio.sopra.playOneShot.mock.calls){expect(description.is3D).toBe(false);expect(options.acoustic).toBe(false);}
  expect(audio.play.mock.calls).toEqual([['impact',[1,2,3]],['potion',[1,2,3]],['sword',[1,2,3]]]);
  audio.update(snapshot,player,.016);audio.update(structuredClone(snapshot),player,.016);
  expect(audio.sopra.playOneShot).toHaveBeenCalledTimes(5);expect(audio.play).toHaveBeenCalledTimes(3);
  audio.update({...snapshot,presentationEpoch:2},player,.016);expect(audio.sopra.playOneShot).toHaveBeenCalledTimes(10);
});
