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
    # Broad bedding planes carry the rock identity. Fine noise must not turn
    # metres of cliff into the wrinkled, fibrous surface of bark.
    strata=np.sin((v*5+.035*np.sin(u*math.tau)+macro*.06)*math.tau)
    bedding=np.maximum(0,strata)**18
    k=.36+macro*.025+grain*.001+strata*.014-bedding*.026-seams*.012
    rgb=np.stack((k*1.02,k*1.025,k),axis=-1)
    write_set(root/'packages/client/public/assets/textures','limestone',rgb,macro*.025+grain*.006-bedding*.035-seams*.018,.91+seams*.04,0)

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
        sections.append(controls[-1]);vertices=[];rings=[];cross=19
        # A fractured outcrop has shelves, shoulders and an uneven crown, not
        # a concentric inflated copy of the passage. Feet extend underground.
        outcrop=[(1,-.25),(.99,.08),(.94,.25),(.99,.28),(.79,.33),(.76,.58),(.59,.64),(.61,.78),(.29,.94),(-.02,1),(-.31,.94),(-.39,.76),(-.58,.73),(-.69,.53),(-.85,.48),(-.81,.27),(-.98,.22),(-.99,.08),(-1,-.25)]
        for index,(x,z,width,clearance) in enumerate(sections):
            floor=height(x,z);ring=[];t=index/(len(sections)-1)
            for layer in range(2):
                points=[]
                for j in range(cross):
                    angle=max(0,min(16,j-1))/16*math.pi
                    if layer==0:
                        px=x+width*math.cos(angle)
                        py=floor+1.2+(clearance-1.2)*math.sin(angle)
                        rough=noise.noise(Vector((px*.38,z*.30,0)))*.22
                        py+=rough*math.sin(angle);px+=rough*math.cos(angle)
                    else:
                        lateral,rise=outcrop[j]
                        fracture=noise.noise(Vector((j*.61,z*.22,17)))
                        px=x+lateral*(width+4.6)+fracture*.6
                        py=floor+.65+rise*(clearance+3.6)+fracture*.45
                    # The broken cliff face recedes above the cut entrance;
                    # its buried sides keep the outcrop seated on the hillside.
                    depth=1.3*math.sin(angle)+.35*math.sin(angle*3)
                    pz=z+(math.exp(-((1-t)/.23)**2)-math.exp(-(t/.23)**2))*depth*layer
                    pz+=noise.noise(Vector((px*.43,py*.37,z*.18)))*(.55 if layer else .12)
                    if j in [0,cross-1]:py=min(floor,height(px,pz))-2.5
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
        shell=mesh('Stratified hillside burial chamber',vertices,faces,'limestone');bm=bmesh.new();bm.from_mesh(shell.data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));assert all(e.is_manifold for e in bm.edges),'Rock shell must close around its two open mouths'
        bm.to_mesh(shell.data);bm.free();shell.data.update()
        shell['export_uv']=True;uv=shell.data.uv_layers.new(name='Rock strata unwrap')
        for face in shell.data.polygons:
            # Keep bedding horizontal on every exposed wall. Wrapping UVs
            # around the arch made the previous stone look bent and stretched.
            n=face.normal
            for li in face.loop_indices:
                vi=shell.data.loops[li].vertex_index;p=vertices[vi]
                uv.data[li].uv=(p[0]*.24,p[1]*.24) if abs(n.z)>.75 else (p[1]*.24,p[2]*.24) if abs(n.x)>abs(n.y) else (p[0]*.24,p[2]*.24)
            face.use_smooth=False
        # Dressed stone inlays explain the burial chamber's use. Their tops
        # follow the actual approach instead of making a sideways stair on it.
        for x,z,width,_ in [controls[0],controls[-1]]:
            count=max(2,math.floor((width*2-1.4)/1.1));tile=(width*2-1.4)/count
            for i in range(count):
                px=x+(i-(count-1)/2)*tile
                corners=[(px-tile/2,z-.48),(px+tile/2,z-.48),(px+tile/2,z+.48),(px-tile/2,z+.48)]
                verts=[(sx,-sz,height(sx,sz)+.015-depth) for depth in [0,.6] for sx,sz in corners]
                # Terrain already supplies their collision surface. The 15mm
                # inlay relief stays inside the walking motor's contact skin.
                mesh('Grounded threshold inlay',verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'stoneLight')
        finish(cave['model'],colliders);collision_collection.hide_render=True;collision_collection.hide_viewport=True
    physical=[cube((0,0,.32),(1.05,2.3,.7),'stoneDark',.1),cube((0,0,.77),(1.18,2.45,.26),'stoneLight',.09)]
    cube((0,0,.94),(.1,1.5,.075),'stoneDark',.018);cube((0,-.3,.94),(.55,.1,.075),'stoneDark',.018)
    for y in [-.82,.65]:cube((0,y,.86),(1.21,.1,.12),'brass',.015)
    finish('cryptTomb',physical)
    fang=cone((0,0,-.55),.035,.34,1.1,'stone',7);finish('caveFang',[fang])
