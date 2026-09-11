"""Keeper ground glyphs: editable packed images, used by native Meep decals."""
import bpy, sys
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from ground_materials import publish_image
out=ROOT/'packages/client/public/assets/vfx';out.mkdir(parents=True,exist_ok=True)
n=512;y,x=np.mgrid[-1:1:complex(n),-1:1:complex(n)]
r=np.sqrt(x*x+y*y);theta=np.arctan2(y,x)
edge=np.clip((1-r)*160,0,1)
ring=np.clip((r-.9)*160,0,1)*edge
for name in ['wave','roots','stars','frost']:
    mask=ring.copy()
    if name!='wave':
        # Every sigil has the same exact outer damage boundary and a faint fill.
        mask=np.maximum(mask,.10*edge)
        arms=6 if name=='frost' else 5 if name=='stars' else 7
        bend=0 if name=='frost' else r*2.8 if name=='roots' else np.sin(r*14)*.3
        spokes=np.clip(1-np.abs(np.sin(theta*arms+bend))*r*45,0,1)*(r<.84)*(r>.12)
        inner=np.clip(1-np.abs(r-.24)*65,0,1)
        mask=np.maximum(mask,np.maximum(spokes,inner)*.8)
        if name=='frost':mask=np.maximum(mask,np.clip(1-np.abs(np.sin(theta*6+r*17))*r*70,0,1)*(r>.38)*(r<.72)*.6)
    pixels=np.ones((n,n,4),dtype=np.float32);pixels[:,:,:3]=mask[:,:,None];pixels[:,:,3]=mask
    image=bpy.data.images.new('warning-'+name,width=n,height=n,alpha=True)
    image.pixels.foreach_set(np.ascontiguousarray(pixels[::-1]).ravel());publish_image(image,out/('warning-'+name+'.png'));image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/warnings.blend'))
