"""Blender-authored metal, leather and woven cloth maps used by Meep's PBR material.

Periodic fields keep repeat edges identical. The travelling cloak has its own
UV atlas: stitched borders and the broken-circle emblem are part of the cloth.
"""
import bpy,math
import numpy as np
from ground_materials import save_image

KINDS=('iron','brass','bronze','timber','leather','cloth','cloak')

def fields(width,height):
    u,v=np.meshgrid(np.linspace(0,1,width),np.linspace(0,1,height))
    macro=(np.sin((u*3+v*2)*math.tau)+.6*np.cos((u*7-v*5)*math.tau)+.3*np.sin((u*17+v*11)*math.tau))/1.9
    grain=np.sin((u*71+v*29)*math.tau)*np.cos((u*43-v*61)*math.tau)
    weave=np.sin(u*math.tau*96)*np.cos(v*math.tau*128)
    return u,v,macro,grain,weave

def write_set(out,name,rgb,heightmap,roughness,metalness,periodic=True):
    h,w=heightmap.shape;rgba=np.ones((h,w,4),dtype=np.float32);rgba[:,:,:3]=np.clip(rgb,0,1)
    if periodic:
        assert np.max(np.abs(rgba[0]-rgba[-1]))<1e-5 and np.max(np.abs(rgba[:,0]-rgba[:,-1]))<1e-5
    save_image(out,name,rgba)
    # Tangent-space +Y follows Blender UV up, opposite the image's row index.
    if periodic:
        field=heightmap[:-1,:-1];dx=(np.roll(field,-1,1)-np.roll(field,1,1))*.5;dy=(np.roll(field,-1,0)-np.roll(field,1,0))*.5
        dx=np.pad(dx,((0,1),(0,1)),mode='wrap');dy=np.pad(dy,((0,1),(0,1)),mode='wrap')
    else:dy,dx=np.gradient(heightmap)
    normal=np.stack((-dx,dy,np.ones_like(dx)),axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    rgba[:,:,:3]=normal*.5+.5;save_image(out,name+'-normal',rgba,True)
    rgba[:,:,0]=1;rgba[:,:,1]=np.clip(roughness,0,1);rgba[:,:,2]=np.clip(metalness,0,1)
    save_image(out,name+'-orm',rgba,True)

def build_equipment_materials(root):
    out=root/'packages/client/public/assets/textures';out.mkdir(parents=True,exist_ok=True)
    u,v,macro,grain,weave=fields(512,512)
    wear=np.clip((macro+.15)*1.5,0,1)
    scratches=np.maximum(0,np.cos((u*53+v*3+.07*np.sin(v*math.tau*7))*math.tau))**28
    for name in KINDS[:-1]:
        if name=='iron':
            k=.86+macro*.03+grain*.008+scratches*.035
            rgb=np.stack((k+wear*.025,k,k-wear*.025),axis=-1)
            relief=grain*.025-scratches*.035;rough=.51+wear*.14-scratches*.08;metal=.94-wear*.12
        elif name=='brass':
            k=.79+macro*.13+grain*.025
            rgb=np.stack((k-wear*.15,k-wear*.04,k),axis=-1)
            relief=grain*.025-scratches*.035;rough=.44+wear*.20;metal=.96-wear*.32
        elif name=='bronze':
            # Quiet casting grain and broad oxidation, without the diagonal
            # scratches of forged equipment stamped across a turned bell.
            patina=np.clip((macro-.25)*.65,0,.32)
            k=.85+macro*.035+grain*.004
            rgb=np.stack((k-patina*.65,k-patina*.12,k+patina*.25),axis=-1)
            relief=grain*.006;rough=.46+patina*.5;metal=.95-patina*.8
        elif name=='timber':
            grainline=np.sin((u*19+.10*np.sin(v*math.tau*2))*math.tau)
            k=.80+grainline*.035+macro*.025
            rgb=np.stack((k,k*.97,k*.91),axis=-1)
            relief=grainline*.02;rough=.82+grainline*.015;metal=0
        elif name=='leather':
            k=.78+macro*.12+grain*.055
            rgb=np.stack((k,k*.96,k*.88),axis=-1)
            relief=grain*.24+macro*.10;rough=.84+grain*.035;metal=0
        else:
            k=.87+macro*.055+weave*.05
            rgb=np.stack((k,k,k),axis=-1)
            relief=weave*.32;rough=.96;metal=0
        write_set(out,name,rgb,relief,rough,metal)

    u,v,macro,grain,weave=fields(768,1024)
    base=np.array([.080,.115,.115])[None,None,:]*(.91+macro*.06+weave*.045)[:,:,None]
    # Two narrow embroidered hems and a broken ring above the waist.
    edge=np.minimum(u,1-u)
    border=np.maximum(np.exp(-((edge-.055)/.004)**2),np.exp(-((edge-.073)/.0025)**2))
    border=np.maximum(border,np.exp(-((v-.92)/.0035)**2))
    x=(u-.5)*.76;y=(v-.30)*1.17;r=np.hypot(x,y);angle=np.arctan2(y,x)
    ring=np.exp(-((r-.124)/.006)**2)*(1-np.exp(-((angle+.62)/.17)**6))
    # Interrupted radial stitches echo the stone halo without reading as a logo.
    ticks=np.exp(-((r-.151)/.011)**4)*np.maximum(0,np.cos(angle*12))**30
    thread=np.clip(np.maximum(border,ring+ticks*.7),0,1)*(.65+.35*np.maximum(0,np.sin((u*137+v*91)*math.tau)))
    dye=np.array([.50,.38,.17])[None,None,:]*(.87+grain*.04)[:,:,None]
    rgb=base*(1-thread[:,:,None])+dye*thread[:,:,None]
    dirt=np.clip((v-.69)/.31,0,1)**2*(.10+.16*(macro+1)/2)
    rgb*=1-dirt[:,:,None]
    write_set(out,'cloak',rgb,weave*.24+thread*.65,.96-thread*.15,0,False)

def apply_equipment_materials(materials,root,kinds=KINDS,texture_names=None):
    """Keep the saved Blender source reviewable with the same texture channels."""
    out=root/'packages/client/public/assets/textures'
    for name in kinds:
        mat=materials.get(name)
        if mat is None:continue
        mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
        output=nodes.new('ShaderNodeOutputMaterial');output.location=(580,0)
        shader=nodes.new('ShaderNodeBsdfPrincipled');shader.location=(280,0);links.new(shader.outputs['BSDF'],output.inputs['Surface'])
        textures={}
        for i,suffix in enumerate(['','-normal','-orm']):
            texture=(texture_names or {}).get(name,name)
            image=bpy.data.images.load(str(out/(texture+suffix+'.png')),check_existing=True)
            if suffix:image.colorspace_settings.name='Non-Color'
            image.pack();node=nodes.new('ShaderNodeTexImage');node.image=image;node.location=(-660,-i*300);textures[suffix]=node
        multiply=nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1;multiply.inputs[2].default_value=mat.diffuse_color;multiply.location=(-220,120)
        links.new(textures[''].outputs['Color'],multiply.inputs[1]);links.new(multiply.outputs[0],shader.inputs['Base Color'])
        normal=nodes.new('ShaderNodeNormalMap');normal.location=(-160,-190);links.new(textures['-normal'].outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],shader.inputs['Normal'])
        channels=nodes.new('ShaderNodeSeparateColor');channels.location=(-160,-420);links.new(textures['-orm'].outputs['Color'],channels.inputs['Color'])
        links.new(channels.outputs['Green'],shader.inputs['Roughness']);links.new(channels.outputs['Blue'],shader.inputs['Metallic'])
