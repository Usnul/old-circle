"""Reproducible contact masks and debris, with editable images packed in Blender."""
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
    image.pixels.foreach_set(np.ascontiguousarray(pixels[::-1]).ravel());publish_image(image,out/(name+'-print.png'));image.use_fake_user=True;image.pack()

# White coverage masks take their material colour from the particle effect.
# Separate random state keeps the established boot/paw masks byte-for-byte stable.
n=128;y,x=np.mgrid[-1:1:complex(n),-1:1:complex(n)]
sprite_rng=np.random.default_rng(2184)
def smooth(edge0,edge1,value):
    t=np.clip((value-edge0)/(edge1-edge0),0,1)
    return t*t*(3-2*t)

# Several overlapping puffs give powder a filled centre and an uneven, wispy edge.
dust=np.zeros((n,n),dtype=np.float64)
for px,py,sx,sy,strength in [(-.10,.03,.52,.36,.64),(.27,.13,.31,.30,.38),
                            (-.39,-.16,.27,.24,.37),(.03,-.33,.37,.22,.28),
                            (-.22,.39,.21,.20,.21),(.48,-.20,.18,.17,.17)]:
    puff=np.exp(-(((x-px)/sx)**2+((y-py)/sy)**2)*2.2)*strength
    dust=1-(1-dust)*(1-puff)
dust*=.91+.07*np.sin(x*23+y*11)*np.sin(y*19-x*7)+sprite_rng.random((n,n))*.025
dust*=1-smooth(.72,.98,np.maximum(np.abs(x),np.abs(y)))

# Signed edge distance keeps a chipped stone silhouette crisp with antialiasing.
vertices=[(-.60,-.36),(-.26,-.69),(.39,-.47),(.67,.11),(.20,.64),(-.48,.40)]
grit=np.ones((n,n),dtype=np.float64)
for (ax,ay),(bx,by) in zip(vertices,vertices[1:]+vertices[:1]):
    distance=((bx-ax)*(y-ay)-(by-ay)*(x-ax))/np.hypot(bx-ax,by-ay)
    grit=np.minimum(grit,smooth(-.015,.015,distance))

# A bent, tapered blade with small tears reads as vegetation even at sprite size.
leaf_y=y+.16*x
center=.21*(1-leaf_y*leaf_y)+.12*leaf_y
width=.20*np.maximum(0,1-(leaf_y/.84)**2)**.65
leaf=smooth(-.018,.018,width-np.abs(x-center))
leaf*=1-smooth(.78,.87,np.abs(leaf_y))
for px,py,r in [(.40,.25,.08),(-.015,-.29,.07),(.26,-.48,.05)]:
    leaf*=smooth(r-.012,r+.012,np.hypot(x-px,y-py))

for name,mask in [('step-dust',dust),('step-grit',grit),('step-leaf',leaf)]:
    pixels=np.ones((n,n,4),dtype=np.float32);pixels[:,:,3]=np.clip(mask,0,1)
    image=bpy.data.images.new(name,width=n,height=n,alpha=True)
    image.pixels.foreach_set(np.ascontiguousarray(pixels[::-1]).ravel())
    publish_image(image,out/(name+'.png'));image.use_fake_user=True;image.pack()
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/footprints.blend'))
