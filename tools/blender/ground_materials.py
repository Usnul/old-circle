"""Author seamless terrain layers and continuous splat weights in Blender."""
import bpy, math, json
import numpy as np
from mathutils import Vector, noise

def save_image(directory,name,pixels,noncolor=False):
    h,w,_=pixels.shape
    image=bpy.data.images.new(name,width=w,height=h,alpha=True)
    if noncolor:image.colorspace_settings.name='Non-Color'
    image.pixels.foreach_set(np.ascontiguousarray(pixels[::-1],dtype=np.float32).ravel())
    image.filepath_raw=str(directory/(name+'.png'));image.file_format='PNG';image.save()
    bpy.data.images.remove(image)

def torus(u,v,scale):
    a,b=u*math.tau,v*math.tau
    return Vector(((3+math.cos(b))*math.cos(a)*scale,(3+math.cos(b))*math.sin(a)*scale,math.sin(b)*scale))

def scatter_detail(rgb,rng,count,colors,lengths,widths,leaf=False):
    """Paint small periodic pieces of surface material, in linear light.

    Work in local brush rectangles so thousands of blades/leaves cost their
    covered pixels, not thousands of whole-image noise evaluations.
    """
    n=rgb.shape[0]-1
    for _ in range(count):
        cx,cy=rng.uniform(0,n,2);length=rng.uniform(*lengths)*n;width=rng.uniform(*widths)*n
        a=rng.uniform(0,math.tau);r=math.ceil(max(length,width))+2
        xx=np.arange(math.floor(cx)-r,math.floor(cx)+r+1);yy=np.arange(math.floor(cy)-r,math.floor(cy)+r+1)
        dx=xx[None,:]-cx;dy=yy[:,None]-cy
        u=(dx*math.cos(a)+dy*math.sin(a))/length;v=(-dx*math.sin(a)+dy*math.cos(a))/width
        shape=u*u+v*v
        if leaf:shape=np.abs(u)**1.35+np.abs(v)**.85
        mask=np.clip((1-shape)*3,0,1)
        color=np.array(colors[rng.integers(len(colors))])
        # Broad fragments have subdued edge wear; fine grass includes a midrib.
        value=(.88+.10*u+.05*v+(.08*np.exp(-v*v*35) if leaf else 0))[:,:,None]*color
        iy,ix=yy[:,None]%n,xx[None,:]%n
        previous=rgb[iy,ix];rgb[iy,ix]=previous*(1-mask[:,:,None])+value*mask[:,:,None]
    rgb[-1]=rgb[0];rgb[:,-1]=rgb[:,0]

def surface_detail(name,rgb,macro):
    rng=np.random.default_rng(813+sum(ord(c) for c in name));n=rgb.shape[0]
    if name=='meadow':
        scatter_detail(rgb,rng,3300,[(.14,.20,.063),(.20,.26,.083),(.24,.27,.09),(.095,.135,.042)],(.012,.04),(.0017,.004),True)
        scatter_detail(rgb,rng,240,[(.12,.18,.052),(.17,.22,.069)],(.003,.007),(.003,.007),True)
    elif name=='wood':
        scatter_detail(rgb,rng,1700,[(.125,.09,.044),(.19,.135,.066),(.10,.12,.051),(.085,.061,.034)],(.006,.025),(.004,.012),True)
        scatter_detail(rgb,rng,120,[(.14,.107,.065),(.075,.055,.031)],(.035,.08),(.0015,.003))
    elif name=='desert':
        u=np.linspace(0,1,n)[None,:];ripples=np.sin(u*math.tau*23+macro*7)**3
        rgb*=1+ripples[:,:,None]*.065
        scatter_detail(rgb,rng,650,[(.32,.225,.14),(.47,.34,.22),(.26,.19,.13)],(.002,.009),(.002,.005))
    elif name=='magic':
        scatter_detail(rgb,rng,1700,[(.12,.18,.16),(.10,.145,.14),(.20,.25,.23),(.17,.19,.14)],(.008,.028),(.002,.007),True)
    elif name=='tundra':
        u=np.linspace(0,1,n)[None,:];ripples=np.sin(u*math.tau*17+macro*9)
        rgb*=1+ripples[:,:,None]*.025
        scatter_detail(rgb,rng,150,[(.29,.34,.35),(.39,.43,.43)],(.002,.007),(.0015,.004))
    elif name=='crown':
        scatter_detail(rgb,rng,1100,[(.25,.26,.25),(.33,.34,.32),(.20,.22,.21),(.38,.37,.32)],(.008,.04),(.004,.017))
    else:
        scatter_detail(rgb,rng,2600,[(.20,.18,.13),(.30,.27,.20),(.17,.16,.12),(.38,.34,.26)],(.002,.012),(.002,.007))
    rgb[-1]=rgb[0];rgb[:,-1]=rgb[:,0]

def build_ground(root,world):
    out=root/'packages/client/public/assets/terrain';out.mkdir(parents=True,exist_ok=True)
    palette=[('meadow',(.13,.18,.06)),('wood',(.085,.10,.046)),('desert',(.42,.29,.175)),
             ('magic',(.12,.17,.16)),('tundra',(.58,.65,.67)),('crown',(.265,.28,.265)),('road',(.245,.22,.16))]
    size=512;macro=np.zeros((size,size),dtype=np.float32);grain=macro.copy()
    for y in range(size):
        for x in range(size):
            u,v=x/(size-1),y/(size-1)
            macro[y,x]=noise.fractal(torus(u,v,.65),.9,2,4)
            grain[y,x]=noise.noise(torus(u,v,6))
    for i,(name,color) in enumerate(palette):
        k=np.clip(.96+macro*(.09 if name=='tundra' else .18)+grain*.05,.7,1.2)
        rgba=np.ones((size,size,4),dtype=np.float32);rgba[:,:,:3]=np.array(color)[None,None,:]*k[:,:,None]
        surface_detail(name,rgba[:,:,:3],macro)
        # Exact edge equality protects the repeat sampler from authoring seams.
        assert np.max(np.abs(rgba[0]-rgba[-1]))<1e-5 and np.max(np.abs(rgba[:,0]-rgba[:,-1]))<1e-5
        save_image(out,name,rgba)
    w,h=1024,1366;x=np.linspace(-240,240,w)[None,:];z=np.linspace(-480,160,h)[:,None]
    wx=x+9*np.sin(z*.029)+4*np.sin(x*.072+z*.041);wz=z+10*np.sin(x*.028)+6*np.sin(z*.051)
    distances=np.stack([(wx-r['center'][0])**2+(wz-r['center'][1])**2 for r in world['regions']])
    weights=np.exp(-(distances-distances.min(axis=0))/2200)
    weights/=weights.sum(axis=0)
    terrain=np.array(world['heights']);gz,gx=np.gradient(terrain,2)
    slope=np.hypot(gx,gz);xs=np.linspace(0,240,w);zs=np.linspace(0,320,h)
    detailed=np.array([np.interp(xs,np.arange(241),row) for row in slope])
    detailed=np.stack([np.interp(zs,np.arange(321),detailed[:,i]) for i in range(w)],axis=1)
    rock=np.clip((detailed-.45)*1.7,0,.85);weights*=1-rock;weights[5]+=rock
    road=np.full((h,w),1e6)
    for p,q in world['routes']:
        dx,dz=q[0]-p[0],q[2]-p[2];t=np.clip(((x-p[0])*dx+(z-p[2])*dz)/(dx*dx+dz*dz),0,1)
        road=np.minimum(road,np.hypot(x-p[0]-dx*t,z-p[2]-dz*t))
    # Soft shoulders and low-frequency wear, independent of triangle boundaries.
    edge=.25*np.sin(x*.7+np.sin(z*.35))+.12*np.sin(z*1.3)
    blend=np.clip((3.1+edge-road)/1.6,0,1);blend=blend*blend*(3-2*blend)
    weights*=1-blend;weights=np.concatenate([weights,blend[None,:,:]],axis=0)
    assert np.max(np.abs(weights.sum(axis=0)-1))<1e-5
    for batch in range(3):
        pixels=np.zeros((h,w,4),dtype=np.float32);pixels[:,:,3]=1
        for c in range(3):
            index=batch*3+c
            if index<7:pixels[:,:,c]=weights[index]
        save_image(out,'weights-'+str(batch),pixels,True)
    (out/'manifest.json').write_text(json.dumps({'width':w,'height':h,'layerSize':size,'layers':[p[0] for p in palette],'tileMetres':[3.5,3.5,5,4,5,4,3],'bounds':[-240,-480,240,160]}))
    print('Terrain: 7 seamless layers, continuous biome and road weights')
