"""Generate Old Circle inventory icons with the user's local FLUX.1-dev.
Uses sequential CPU offload and a 13 GiB PyTorch ceiling. Run independently of audio.
"""
import argparse,sys,json,gc,subprocess
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--model',default='H:/git/FLUX.1-dev')
parser.add_argument('--extra-packages',default='H:/ai/art3d/Lib/site-packages')
args=parser.parse_args()
sys.path.append(args.extra_packages)
import torch
used=int(subprocess.check_output(['nvidia-smi','--query-gpu=memory.used','--format=csv,noheader,nounits'],text=True).strip())
if used>4500: raise RuntimeError('FLUX authoring needs headroom under the 18 GiB ceiling. Close GPU-intensive apps first.')
from diffusers import FluxPipeline
OUT=Path(__file__).resolve().parents[1]/'packages/client/public/assets/icons'
OUT.mkdir(parents=True,exist_ok=True)
torch.cuda.set_per_process_memory_fraction(13*1024**3/torch.cuda.get_device_properties(0).total_memory)
pipe=FluxPipeline.from_pretrained(args.model,torch_dtype=torch.bfloat16,local_files_only=True)
pipe.enable_sequential_cpu_offload()
pipe.vae.enable_slicing();pipe.vae.enable_tiling()
items={'sword':'a single medieval longsword with weathered steel blade and oxidized brass crossguard, diagonally placed', 'bow':'a single curved ashwood longbow with taut pale string, diagonally placed', 'seal':'a single circular oxidized brass talisman containing one pale blue glowing crystal', 'flask':'a single small antique amber glass healing flask with brass stopper and leather wrap'}
manifest={}
for i,(name,item) in enumerate(items.items()):
 prompt=f'Dark fantasy RPG inventory icon, {item}. One isolated object centered on an almost black green background. Hand-painted oil illustration, realistic worn materials, restrained gold rim lighting, clear elegant silhouette, consistent antique art direction, square composition, generous padding, no text, no letters, no frame, no extra objects.'
 print('Generating',name,flush=True)
 image=pipe(prompt=prompt,width=384,height=384,num_inference_steps=16,guidance_scale=3.5,max_sequence_length=192,generator=torch.Generator('cpu').manual_seed(8110+i)).images[0]
 image.save(OUT/f'{name}.png');manifest[name]={'model':'FLUX.1-dev','prompt':prompt,'seed':8110+i,'steps':16}
 print('Saved',name,'peak GiB',round(torch.cuda.max_memory_allocated()/1024**3,2),flush=True)
 gc.collect();torch.cuda.empty_cache()
(OUT/'provenance.json').write_text(json.dumps(manifest,indent=2))
print('Icons complete.',flush=True)
