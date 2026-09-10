"""Continuous rock vaults and their convex collision cells, authored in Blender."""
import bpy,bmesh,math
import numpy as np
from mathutils import Vector,noise
from equipment_materials import fields,write_set
from ground_materials import torus

def build_cave_materials(root):
    u,v,_,grain,_=fields(512,512);axis=np.linspace(0,1,512)
    macro=np.array([noise.fractal(torus(x,y,.95),.9,2,4) for y in axis for x in axis]).reshape(512,512)
    first=np.full(u.shape,np.inf);second=first.copy();rng=np.random.default_rng(391)
    for x,y in rng.random((38,2)):
        dx=np.minimum(abs(u-x),1-abs(u-x));dy=np.minimum(abs(v-y),1-abs(v-y));d=dx*dx+dy*dy
        second=np.minimum(second,np.maximum(first,d));first=np.minimum(first,d)
    seams=np.exp(-(np.sqrt(second)-np.sqrt(first))/.0018)
    strata=np.sin((v*7+macro*.38)*math.tau)
    k=.29+macro*.065+grain*.003+strata*.008-seams*.026
    rgb=np.stack((k*1.04,k*1.02,k*.93),axis=-1)
    write_set(root/'packages/client/public/assets/textures','limestone',rgb,macro*.055+grain*.018-seams*.045,.88+seams*.08,0)

def build_caves(world,mesh,finish,cube,cone):
    def height(x,z):
        gx=(x-world['minX'])/2;gz=(z-world['minZ'])/2;ix=math.floor(gx);iz=math.floor(gz);u=gx-ix;v=gz-iz
        h=world['heights'];a,b,c,d=h[iz][ix],h[iz][ix+1],h[iz+1][ix],h[iz+1][ix+1]
        return a+(b-a)*u+(c-a)*v if u+v<=1 else d+(c-d)*(1-u)+(b-d)*(1-v)
    for cave in world['caves']:
        sections=[];controls=cave['sections']
        for a,b in zip(controls,controls[1:]):
            steps=math.ceil(abs(b[1]-a[1])/1.8)
            for i in range(steps):sections.append([av+(bv-av)*i/steps for av,bv in zip(a,b)])
        sections.append(controls[-1]);vertices=[];rings=[];surface_uv=[];cross=19
        for index,(x,z,width,clearance) in enumerate(sections):
            floor=height(x,z);ring=[];t=index/(len(sections)-1);middle=math.sin(t*math.pi)
            for layer in range(2):
                points=[];along=0;previous=None
                for j in range(cross):
                    angle=max(0,min(16,j-1))/16*math.pi
                    if layer==0:
                        radius=width;y=1.2+(clearance-1.2)*math.sin(angle)
                    else:
                        radius=width+3.4+middle*1.8+.65*math.sin(angle*2.5);y=1.2+(clearance+2.1+middle*1.2)*math.sin(angle)
                    px=x+radius*math.cos(angle);py=floor+y
                    if j in [0,cross-1]:py=min(floor,height(px,z))-2.5
                    else:
                        rough=noise.noise(Vector((px*.38,z*.30,layer*17)))*(.5 if layer==0 else 1.1)
                        py+=rough*math.sin(angle);px+=rough*math.cos(angle)
                    # The mouth exposes an uneven, receding rock lip rather
                    # than a flat annular facade cut perpendicular to the tunnel.
                    depth=4*math.sin(angle)+.5*math.sin(angle*3)
                    pz=z+(math.exp(-((1-t)/.23)**2)-math.exp(-(t/.23)**2))*depth*layer
                    pz+=noise.noise(Vector((px*.43,py*.37,z*.18)))*(.5 if layer else .22)
                    if previous is not None:along+=math.hypot(px-previous[0],py-previous[1])
                    previous=(px,py);surface_uv.append((along*.3,-pz*.3))
                    points.append(len(vertices));vertices.append((px,-pz,py))
                ring.append(points)
            rings.append(ring)
        faces=[];colliders=[];collision_collection=bpy.data.collections.new(cave['model']+' collision');bpy.context.scene.collection.children.link(collision_collection)
        for a,b in zip(rings,rings[1:]):
            for j in range(cross-1):
                ids=[a[0][j],a[0][j+1],a[1][j+1],a[1][j],b[0][j],b[0][j+1],b[1][j+1],b[1][j]]
                faces.extend([(ids[0],ids[4],ids[5],ids[1]),(ids[3],ids[2],ids[6],ids[7])])
                # Hidden, convex cells cover the rock thickness. The visible
                # shell shares every edge, including the mouth and roof.
                data=bpy.data.meshes.new('Vault collision cell');bm=bmesh.new()
                for vi in ids:bm.verts.new(vertices[vi])
                bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False);bm.to_mesh(data);bm.free()
                obj=bpy.data.objects.new('Rock cell',data);collision_collection.objects.link(obj);colliders.append(obj)
            for j in [0,cross-1]:faces.append((a[0][j],a[1][j],b[1][j],b[0][j]))
        for ring in [rings[0],rings[-1]]:
            for j in range(cross-1):faces.append((ring[0][j],ring[0][j+1],ring[1][j+1],ring[1][j]))
        shell=mesh('Eroded burial vault',vertices,faces,'limestone');bm=bmesh.new();bm.from_mesh(shell.data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges),'Rock shell must close around its two open mouths'
        bm.to_mesh(shell.data);bm.free();shell.data.update()
        shell['export_uv']=True;uv=shell.data.uv_layers.new(name='Rock strata unwrap')
        for face in shell.data.polygons:
            cap=len({vi//(cross*2) for vi in face.vertices})==1
            bottom=all(vi%cross in [0,cross-1] for vi in face.vertices)
            for li in face.loop_indices:
                vi=shell.data.loops[li].vertex_index;p=vertices[vi]
                uv.data[li].uv=(p[0]*.3,p[2]*.3) if cap else (p[0]*.3,p[1]*.3) if bottom else surface_uv[vi]
        for face in shell.data.polygons:face.use_smooth=True
        finish(cave['model'],colliders);collision_collection.hide_render=True;collision_collection.hide_viewport=True
    physical=[cube((0,0,.32),(1.05,2.3,.7),'stoneDark',.1),cube((0,0,.77),(1.18,2.45,.26),'stoneLight',.09)]
    cube((0,0,.94),(.1,1.5,.075),'stoneDark',.018);cube((0,-.3,.94),(.55,.1,.075),'stoneDark',.018)
    for y in [-.82,.65]:cube((0,y,.86),(1.21,.1,.12),'brass',.015)
    finish('cryptTomb',physical)
    fang=cone((0,0,-.55),.035,.34,1.1,'stone',7);finish('caveFang',[fang])
