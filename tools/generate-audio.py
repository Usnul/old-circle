"""Generate Old Circle SFX with the user's local Stable Audio 3 Small SFX weights.
Run with the ComfyUI Python runtime; dependencies remain in .local/audio-runtime.
"""
import sys,os,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.extend([str(ROOT/'.local/audio-runtime'),'H:/ai/art3d/Lib/site-packages'])
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
import torch
import wave
from stable_audio_3.model import StableAudioModel
from stable_audio_3.loading_utils import load_diffusion_cond

used=int(subprocess.check_output(['nvidia-smi','--query-gpu=memory.used','--format=csv,noheader,nounits'],text=True).strip())
budget=min(8.5*1024,18*1024-used-1024)
if budget<7*1024: raise RuntimeError('Audio authoring needs 7 GiB of project budget, plus 1 GiB reserve, under the 18 GiB ceiling.')
torch.cuda.set_per_process_memory_fraction(budget*1024**2/torch.cuda.get_device_properties(0).total_memory)
model_dir=Path('H:/git/stable-audio-3-small-sfx')
config=json.loads((model_dir/'model_config.json').read_text())
def local_conditioner(value):
 if isinstance(value,dict):
  if value.get('model_name')=='google/t5gemma-b-b-ul2' or value.get('subfolder')=='t5gemma-b-b-ul2':
   value['model_path']=str(model_dir/'t5gemma-b-b-ul2');value.pop('repo_id',None);value.pop('subfolder',None)
  for child in value.values():local_conditioner(child)
 elif isinstance(value,list):
  for child in value:local_conditioner(child)
local_conditioner(config)
model=load_diffusion_cond(config,str(model_dir/'model.safetensors'),device='cpu',model_half=True).half().to('cuda')
model.use_lora=False;model.lora_names=[]
generator=StableAudioModel(model,config,'cuda',True)
out=ROOT/'packages/client/public/assets/audio';out.mkdir(parents=True,exist_ok=True)
prompts={
 'wind':(12,'Gentle wind rustling meadow grasses and oak leaves, distant woodland birds, quiet natural outdoor ambience, no music, no speech.'),
 'bell':(5,'One deep ancient bronze church bell struck once, resonant lonely bell decaying in an abandoned stone abbey, no music.'),
 'sword':(2,'One quick medieval steel sword swoosh followed by a sharp metallic impact, dry close combat foley, no music, no speech.'),
 'frost':(3,'A sudden icy magical burst, rushing crystalline frost spreading outward, tinkling ice shards with a deep soft impact, fantasy spell sound effect.'),
 'step':(2,'Two heavy leather boot footsteps on a gravel and grass path, close dry footstep foley, no music.'),
 'fire':(10,'Small warm campfire crackling softly with little sparks, quiet looping fire ambience, no wind, no music.'),
}
for surface,detail in {
 'grass':'soft damp meadow grass, a padded thud and blades brushing',
 'gravel':'loose fine gravel, a short crunch with small shifting stones',
 'stone':'hard limestone masonry, a sharp dry sole clack with a short low thump',
 'snow':'fresh powder snow, a soft deep compacting snow crunch',
 'wood':'weathered wooden boards, a hollow wooden knock with a very brief creak',
 'sand':'dry coarse sand, a muted sandy impact and short granular scrape',
}.items():
 for variant in range(2):
  prompts[f'step-{surface}-{variant}']=(2,f'Exactly one single leather boot footstep landing on {detail}. Isolated close foley impact, silence before and after. No walking sequence, no second step, no music, no voices.')
for name,(duration,prompt) in list(prompts.items()):
 if name.startswith('step-'):prompts[name.replace('step-','paw-')]=(duration,prompt.replace('leather boot footstep','large dog paw with small claws').replace('sole clack','claw tick'))
manifest=[]
for index,(name,(duration,prompt)) in enumerate(prompts.items()):
 entry=dict(file=name+'.wav',duration=duration,prompt=prompt,seed=9010+index,model='Stable Audio 3 Small SFX',steps=8);manifest.append(entry)
 if (out/(name+'.wav')).exists():
  if (out/'provenance.json').exists():
   previous=next((p for p in json.loads((out/'provenance.json').read_text()) if p['file']==name+'.wav'),None)
   if previous:entry.update(previous)
  continue
 audio=generator.generate(prompt=prompt,duration=duration,steps=8,seed=9010+index,chunked_decode=True)
 audio=audio.squeeze(0).float().cpu().numpy().T
 audio=audio/max(1,float(abs(audio).max())/.85)
 import numpy as np
 if name.startswith(('step-','paw-')):
  # Isolate one impact; animation contacts own the rhythm of walking.
  mono=np.max(np.abs(audio),axis=1);energy=np.sqrt(np.convolve(mono*mono,np.ones(441)/441,mode='same'))
  peak=int(np.argmax(energy));threshold=energy[peak]*.18;onset=peak
  while onset>0 and energy[onset-1]>threshold:onset-=1
  start=max(0,onset-220);end=min(len(audio),start+int((.55 if 'snow' in name or 'grass' in name else .42)*44100))
  entry['generatedDuration']=duration;entry['trim']=[round(start/44100,5),round(end/44100,5)];audio=audio[start:end];entry['duration']=len(audio)/44100
 # Preserve the single impact's attack; fade the tail to avoid file clicks.
 fade=min(220 if name.startswith(('step-','paw-')) else 2205,len(audio)//10);audio[:fade]*=np.linspace(0,1,fade)[:,None]
 tail=min(2205,len(audio)//5);audio[-tail:]*=np.linspace(1,0,tail)[:,None]
 with wave.open(str(out/(name+'.wav')),'wb') as f:
  f.setnchannels(2);f.setsampwidth(2);f.setframerate(44100);f.writeframes((audio*32767).astype('<i2').tobytes())
 print(name,'peak GPU GiB',round(torch.cuda.max_memory_reserved()/1024**3,2),flush=True)
 # Retain each completed sample's trim and seed even if a later generation fails.
 previous=json.loads((out/'provenance.json').read_text()) if (out/'provenance.json').exists() else []
 remaining=[p for p in previous if p['file'] not in {e['file'] for e in manifest}]
 (out/'provenance.json').write_text(json.dumps(manifest+remaining,indent=2))
(out/'provenance.json').write_text(json.dumps(manifest,indent=2))
