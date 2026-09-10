"""Generate Old Circle inventory icons with the user's local FLUX.1-dev.
Uses sequential CPU offload within the shared 18 GiB budget. Run independently of audio.
"""
import argparse,sys,json,gc,subprocess
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--model',default='H:/git/FLUX.1-dev')
parser.add_argument('--extra-packages',default='H:/ai/art3d/Lib/site-packages')
parser.add_argument('--only',nargs='+',help='Generate only these icon names')
parser.add_argument('--force',action='store_true',help='Replace existing requested icons')
args=parser.parse_args()
OUT=Path(__file__).resolve().parents[1]/'packages/client/public/assets/icons'
items={'sword':'a single medieval longsword with weathered steel blade and oxidized brass crossguard, diagonally placed', 'bow':'a single curved ashwood longbow with taut pale string, diagonally placed', 'seal':'a single circular oxidized brass talisman containing one pale blue glowing crystal', 'flask':'a single small antique amber glass healing flask with brass stopper and leather wrap',
 'charm-briar':'a small tangled knot of ancient thorny roots tied with faded green thread, a carved wooden talisman',
 'charm-ash':'a single smoked amber lens in a weathered brass ring, held by a short dark leather cord',
 'charm-glass':'a single crescent shard of pale blue opalescent glass suspended in a delicate silver talisman cage',
 'charm-frost':'a small anatomically shaped heart carved from milky white ice, frost crystals along its edges, a silver loop at the top',
 'charm-crown':'a single broken crown-shaped brass brand, blackened and cracked, suspended from a short antique chain'}
if args.only and set(args.only)-items.keys(): parser.error('Unknown icon name')
pending=[(i,name,item) for i,(name,item) in enumerate(items.items()) if (not args.only or name in args.only) and (args.force or not (OUT/f'{name}.png').exists())]
if not pending: print('Requested icons already exist. Use --force to replace them.');sys.exit(0)
OUT.mkdir(parents=True,exist_ok=True)
manifest_path=OUT/'provenance.json'
manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
sys.path.append(args.extra_packages)
import torch
used=int(subprocess.check_output(['nvidia-smi','--query-gpu=memory.used','--format=csv,noheader,nounits'],text=True).strip())
budget=min(13*1024,18*1024-used-1024)
if budget<4*1024: raise RuntimeError('FLUX authoring needs at least 4 GiB of headroom under the shared 18 GiB ceiling.')
print('PyTorch budget GiB',round(budget/1024,2),'with existing GPU use MiB',used,flush=True)
from diffusers import FluxPipeline
torch.cuda.set_per_process_memory_fraction(budget*1024**2/torch.cuda.get_device_properties(0).total_memory)
pipe=FluxPipeline.from_pretrained(args.model,torch_dtype=torch.bfloat16,local_files_only=True)
pipe.enable_sequential_cpu_offload()
pipe.vae.enable_slicing();pipe.vae.enable_tiling()
for i,name,item in pending:
 prompt=f'Dark fantasy RPG inventory icon, {item}. One isolated object centered on an almost black green background. Hand-painted oil illustration, realistic worn materials, restrained gold rim lighting, clear elegant silhouette, consistent antique art direction, square composition, generous padding, no text, no letters, no frame, no extra objects.'
 print('Generating',name,flush=True)
 image=pipe(prompt=prompt,width=384,height=384,num_inference_steps=16,guidance_scale=3.5,max_sequence_length=192,generator=torch.Generator('cpu').manual_seed(8110+i)).images[0]
 image.save(OUT/f'{name}.png');manifest[name]={'model':'FLUX.1-dev','prompt':prompt,'seed':8110+i,'steps':16}
 manifest_path.write_text(json.dumps(manifest,indent=2))
 print('Saved',name,'peak GiB',round(torch.cuda.max_memory_allocated()/1024**3,2),flush=True)
 gc.collect();torch.cuda.empty_cache()
print('Icons complete.',flush=True)
