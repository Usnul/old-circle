"""Reproducible contact masks, with packed editable images retained in Blender."""
import bpy, sys
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from ground_materials import publish_image
out=ROOT/'packages/client/public/assets/vfx';out.mkdir(parents=True,exist_ok=True)
n=256;y,x=np.mgrid[-1:1:complex(n),-1:1:complex(n)]
rng=np.random.default_rng(617)
for name in ['boot','paw']:
    if name=='boot':
        sole=np.maximum(1-(x/.62)**4-((y+.25)/.64)**4,1-(x/.49)**6-((y-.57)/.27)**6)
        mask=np.clip(sole*14,0,1)
        tread=np.where((np.sin((y+x*.18)*32)>.2)&(y<.25),.36,1)
        mask*=tread
    else:
        mask=np.clip((1-(x/.55)**2-((y-.32)/.4)**2)*12,0,1)
        for px,py in [(-.55,-.20),(-.21,-.50),(.21,-.50),(.55,-.20)]:
            mask=np.maximum(mask,np.clip((1-((x-px)/.22)**2-((y-py)/.27)**2)*12,0,1))
    pixels=np.ones((n,n,4),dtype=np.float32);pixels[:,:,3]=mask*(.55+rng.random((n,n))*.45)
    image=bpy.data.images.new(name+'-print',width=n,height=n,alpha=True)
    image.pixels.foreach_set(np.ascontiguousarray(pixels[::-1]).ravel());publish_image(image,out/(name+'-print.png'));image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/footprints.blend'))
