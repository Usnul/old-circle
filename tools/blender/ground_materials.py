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

def build_ground(root,world):
    out=root/'packages/client/public/assets/terrain';out.mkdir(parents=True,exist_ok=True)
    palette=[('meadow',(.19,.27,.075)),('wood',(.105,.15,.055)),('desert',(.48,.30,.14)),
             ('magic',(.09,.15,.16)),('tundra',(.65,.72,.73)),('crown',(.28,.29,.27)),('road',(.26,.22,.16))]
    size=256;macro=np.zeros((size,size),dtype=np.float32);grain=macro.copy()
    for y in range(size):
        for x in range(size):
            u,v=x/(size-1),y/(size-1)
            macro[y,x]=noise.fractal(torus(u,v,.65),.9,2,4)
            grain[y,x]=noise.noise(torus(u,v,6))
    for i,(name,color) in enumerate(palette):
        k=np.clip(.93+macro*(.15 if name=='tundra' else .24)+grain*.075,.6,1.2)
        rgba=np.ones((size,size,4),dtype=np.float32);rgba[:,:,:3]=np.array(color)[None,None,:]*k[:,:,None]
        # Exact edge equality protects the repeat sampler from authoring seams.
        assert np.max(np.abs(rgba[0]-rgba[-1]))<1e-5 and np.max(np.abs(rgba[:,0]-rgba[:,-1]))<1e-5
        save_image(out,name,rgba)
    w,h=1024,1366;x=np.linspace(-240,240,w)[None,:];z=np.linspace(-480,160,h)[:,None]
    distances=np.stack([(x-r['center'][0])**2+(z-r['center'][1])**2 for r in world['regions']])
    weights=np.exp(-(distances-distances.min(axis=0))/1800)
    weights/=weights.sum(axis=0)
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
