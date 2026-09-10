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
if used>7000: raise RuntimeError('Close GPU-intensive applications before audio authoring; need 11 GiB of headroom under the 18 GiB project ceiling.')
torch.cuda.set_per_process_memory_fraction(10*1024**3/torch.cuda.get_device_properties(0).total_memory)
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
manifest=[]
for index,(name,(duration,prompt)) in enumerate(prompts.items()):
 manifest.append(dict(file=name+'.wav',duration=duration,prompt=prompt,seed=9010+index,model='Stable Audio 3 Small SFX',steps=8))
 if (out/(name+'.wav')).exists():continue
 audio=generator.generate(prompt=prompt,duration=duration,steps=8,seed=9010+index,chunked_decode=True)
 audio=audio.squeeze(0).float().cpu().numpy().T
 audio=audio/max(1,float(abs(audio).max())/.85)
 # Short linear fades remove file boundary clicks.
 import numpy as np
 fade=min(2205,len(audio)//10);audio[:fade]*=np.linspace(0,1,fade)[:,None];audio[-fade:]*=np.linspace(1,0,fade)[:,None]
 with wave.open(str(out/(name+'.wav')),'wb') as f:
  f.setnchannels(2);f.setsampwidth(2);f.setframerate(44100);f.writeframes((audio*32767).astype('<i2').tobytes())
 print(name,'peak GPU GiB',round(torch.cuda.max_memory_reserved()/1024**3,2),flush=True)
(out/'provenance.json').write_text(json.dumps(manifest,indent=2))
