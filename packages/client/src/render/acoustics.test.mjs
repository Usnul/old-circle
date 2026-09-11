import {expect,test} from 'vitest';
import {MockAudioContext} from '@woosh/meep-engine/src/engine/sound/sopra/util/MockAudioContext.js';
import {SopraEngine} from '@woosh/meep-engine/src/engine/sound/sopra/SopraEngine.js';
import {EventDescription} from '@woosh/meep-engine/src/engine/sound/sopra/definition/EventDescription.js';
import {SampleAudioClip} from '@woosh/meep-engine/src/engine/sound/sopra/definition/clip/SampleAudioClip.js';
import Vector3 from '@woosh/meep-engine/src/core/geom/Vector3.js';
import {buildLayout} from '@old-circle/game/world/layout.mjs';
import {WorldAudio} from './audio.mjs';
import {WorldAcoustics} from './acoustics.mjs';

test('Sopra spatial voices use band transmission, bounded reverb and a dry wind bus with no pathing',async()=>{
  const context=new MockAudioContext(),nodes=[];
  for(const name of ['createGain','createPanner','createBiquadFilter','createConvolver']){const create=context[name].bind(context);context[name]=()=>{const node=create();nodes.push(node);return node;};}
  const buffer=context.createBuffer(1,context.sampleRate,context.sampleRate),provider={get:async()=>buffer,tryGet:()=>buffer};
  const sopra=new SopraEngine(context,context.destination,provider),layout=buildLayout(),audio=new WorldAudio({},layout);
  audio.sopra=sopra;audio.acoustics=await WorldAcoustics.create(sopra);
  const description=new EventDescription();description.is3D=true;description.distanceMax=45;description.maxInstances=64;description.rootClip=SampleAudioClip.from('test.wav');
  const listener=new Vector3(35,5.8,-53);sopra.listenerPosition=listener;
  const voice=audio.spatial(description,[28,5.8,-53]);expect(voice.acoustic).toBe(true);
  const panners=nodes.filter(n=>n.kind==='panner');expect(panners).toHaveLength(1); // No corner-leak send.
  for(let i=0;i<12;i++)audio.acoustics.update(listener,audio.voices,.05);
  const taps=nodes.filter(n=>n.kind==='gain'&&n.connections.includes(panners[0]));expect(taps).toHaveLength(3);
  expect(taps.reduce((sum,n)=>sum+n.gain.value,0)).toBeCloseTo(.1,2);expect(Math.min(...taps.map(n=>n.gain.value))).toBeLessThan(.01);
  expect(sopra.busGraph.getOutput('effects').connections).toContain(audio.acoustics.reverb.input);
  expect(sopra.busGraph.getOutput('ambient').connections).not.toContain(audio.acoustics.reverb.input);
  const convolved=nodes.filter(n=>n.kind==='convolver'&&n.buffer);expect(convolved.length).toBeGreaterThan(0);expect(convolved.every(n=>n.buffer.duration<=2.05)).toBe(true);
  expect(audio.acoustics.simulator.pathing).toBe(false);
  expect(audio.spatial(description,[200,10,150])).toBeNull();
  for(let i=0;i<40;i++)audio.spatial(description,[35+i*.05,5.8,-54]);expect(audio.voices.size).toBe(24);
  for(const v of [...audio.voices])v.stop();expect(audio.voices.size).toBe(0);audio.acoustics.update(listener,audio.voices,.05);expect(audio.acoustics.stats.voices).toBe(0);
});
