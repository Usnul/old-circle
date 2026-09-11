"""Periodic dressed limestone and worn flagstones, packed into the Blender kit.

One tile spans 2.22 metres at the world kit's authored UV scale. Four staggered
courses leave half-metre blocks; floors use broader, quieter mortar and wear.
Regional mineral colours come from the shared dungeon material catalogue.
"""
import math
import numpy as np
from equipment_materials import fields,write_set


def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)


def stone_noise(u,v,period,seed):
    grid=np.random.default_rng(seed).uniform(-1,1,(period,period))
    x=u*period;y=v*period;ix=np.floor(x).astype(int);iy=np.floor(y).astype(int)
    fx=smooth(0,1,x-ix);fy=smooth(0,1,y-iy)
    a=grid[iy%period,ix%period]*(1-fx)+grid[iy%period,(ix+1)%period]*fx
    b=grid[(iy+1)%period,ix%period]*(1-fx)+grid[(iy+1)%period,(ix+1)%period]*fx
    return a*(1-fy)+b*fy


def build_masonry_materials(root):
    out=root/'packages/client/public/assets/textures'
    u,v,_,_,_=fields(1024,1024)
    macro=stone_noise(u,v,6,271)*.65+stone_noise(u,v,17,273)*.35
    grain=stone_noise(u,v,151,277)*.65+stone_noise(u,v,49,281)*.35
    erosion=stone_noise(u,v,33,283)
    for name in ['masonry','flagstone']:
        wall=name=='masonry';columns=2 if wall else 3;rows=4 if wall else 3
        # Warped joints repeat at the tile boundary. Modulo stone identities
        # prevent a colour discontinuity when a partial block crosses that edge.
        y=v*rows+.008*np.sin(u*math.tau*3)+.004*erosion
        row=np.floor(y)%rows;fy=y-np.floor(y)
        x=u*columns+row*.5+.008*np.sin(v*math.tau*5)+.004*erosion
        col=np.floor(x)%columns;fx=x-np.floor(x)
        identity=np.sin(col*71.3+row*19.7)*.5+np.cos(col*17.1-row*37.8)*.5
        # Distances are in tile UV units, not block-relative units, so bed and
        # cross joints have the same width despite the long rectangular blocks.
        edge=np.minimum(np.minimum(fx,1-fx)/columns,np.minimum(fy,1-fy)/rows)
        chips=(.001+.002*(grain+1)/2)*(.35+.65*(macro+1)/2)
        stone=smooth(.002+chips,.006+chips,edge)
        bevel=smooth(.004+chips,.018+chips,edge)
        face=.77+identity*.095+macro*.075+grain*.055
        # Fine diagonal mineral streaks stay subtle beside the readable joints.
        veins=np.maximum(0,np.sin((u*9+v*6+.14*np.sin(u*math.tau*3))*math.tau))**18
        face-=veins*.025
        mortar=.47+macro*.035+grain*.018
        k=mortar*(1-stone)+face*stone
        rgb=np.stack((k,k*.986,k*.958),axis=-1)
        relief=bevel*(9 if wall else 6)+macro*1.3+grain*.55-veins*.3
        rough=.97*(1-stone)+(.83+macro*.035+grain*.022)*stone
        # Duplicate endpoints exactly: float modulo at a warped course boundary
        # must not introduce a one-pixel seam in the repeated normal/ORM maps.
        for field in [rgb,relief,rough]:field[-1]=field[0];field[:,-1]=field[:,0]
        write_set(out,name,rgb,relief,rough,0)
