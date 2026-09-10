"""Metre-scale plants and weathered outcrops for the pilgrimage landscape."""
import bpy, bmesh, math, random
from mathutils import Vector, noise


def build_nature(beam, ico, mesh, finish):
    # A bevelled convex core gives rocks broad fracture faces. Small scale noise
    # breaks the silhouette without the two overlapping spheres of the old kit.
    for variant in range(3):
        for family,material in [('rock','stone'),('sandstone','sand'),('frostRock','stoneDark')]:
            rng=random.Random(901+variant)
            rock=ico((0,0,0),(1,1,1),material,2)
            for vertex in rock.data.vertices:
                p=vertex.co
                p.x*=1.45+variant*.12;p.y*=1.05-variant*.08;p.z*=.95
                p.x+=p.z*.26;p.y+=p.z*.10
                rough=noise.noise(p*2.1+Vector((variant*13,7,3)))*.13
                p*=1+rough
                p.z=min(.78+variant*.06,p.z);p.x=min(1.05,p.x)
                p.z+=.58
            bm=bmesh.new();bm.from_mesh(rock.data)
            result=bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
            bmesh.ops.delete(bm,geom=result['geom_interior']+result['geom_unused'],context='VERTS')
            bm.to_mesh(rock.data);bm.free();rock.data.update()
            mod=rock.modifiers.new('Softened fracture edges','BEVEL');mod.width=.065;mod.segments=2
            bpy.context.view_layer.objects.active=rock;bpy.ops.object.modifier_apply(modifier=mod.name)
            if family=='frostRock':
                # Snow rests on upward-facing shelves; it is not a white recolor
                # of the entire stone, including its underside.
                vs=[];fs=[]
                for face in rock.data.polygons:
                    if face.normal.z<.5:continue
                    k=len(vs)
                    vs.extend(tuple(rock.data.vertices[i].co+Vector((0,0,.025))) for i in face.vertices)
                    fs.append(tuple(k+i for i in range(len(face.vertices))))
                mesh('Settled snow',vs,fs,'snow')
            finish(family+str(variant),[rock])

    def ribbon(vertices,faces,origin,angle,height,width,lean):
        """A curved, folded blade with a tapered tip, including its back faces."""
        f=Vector((math.cos(angle),math.sin(angle),0));s=Vector((-f.y,f.x,0))
        k=len(vertices);origin=Vector(origin)
        for j in range(4):
            t=j/3;middle=origin+f*(lean*t*t)+Vector((0,0,height*(t-.17*t*t)))
            w=width*(1-t)**.8
            vertices.extend([tuple(middle-s*w),tuple(middle+Vector((0,0,w*.35))),tuple(middle+s*w)])
        for j in range(3):
            for side in range(2):
                a=k+j*3+side;b=a+1;c=a+3;d=c+1
                faces.extend([(a,b,c),(b,d,c),(c,b,a),(c,d,b)])

    # Broad, irregular mats overlap in the landscape. Their low edge blades
    # disappear into the ground texture instead of outlining circular tufts.
    for name,variant in [('groundcover',0),('groundcover1',1),('dryGrass',2),('moorGrass',3)]:
        rng=random.Random(381+variant);groups={}
        for i in range(230):
            a=rng.random()*math.tau;r=math.sqrt(rng.random())*2.0
            x,y=math.cos(a)*r,math.sin(a)*r
            edge=max(.16,1-(r/2)**3);h=rng.uniform(.13,.40)*edge
            mat=('grassDry' if i%4 else 'grassLight') if variant==2 else ('grassDark' if i%5 else 'grassLight') if variant==3 else ('grass' if i%6 else 'grassLight')
            vertices,faces=groups.setdefault(mat,([],[]))
            ribbon(vertices,faces,(x,y,-.018),rng.random()*math.tau,h,rng.uniform(.007,.018),rng.uniform(.05,.17))
        for mat,(vertices,faces) in groups.items():mesh(name+' blades',vertices,faces,mat)
        # A few small bell flowers, on only one of the two meadow variants.
        if variant==1:
            for i in range(5):
                a=rng.random()*math.tau;r=rng.random()*1.3;x,y=math.cos(a)*r,math.sin(a)*r;h=rng.uniform(.17,.3)
                beam((x,y,0),(x,y,h),.004,'grass',.0025,4)
                for petal in range(5):
                    t=petal*math.tau/5
                    ico((x+math.cos(t)*.018,y+math.sin(t)*.018,h),(.024,.016,.009),'bone',1)
        finish(name)

    for name,variant in [('fern',0),('bracken',1)]:
        rng=random.Random(501+variant);groups={}
        for frond in range(8):
            angle=frond*math.tau/8+rng.uniform(-.2,.2);length=rng.uniform(.48,.85)*(1.2 if variant else 1)
            forward=Vector((math.cos(angle),math.sin(angle),0));side=Vector((-forward.y,forward.x,0))
            def center(t):return forward*(length*t)+Vector((0,0,.08+.72*length*math.sin(t*math.pi*.7)))
            for j in range(8):
                beam(center(j/8),center((j+1)/8),.006,'grassDark',.0035,4)
            for j in range(1,12):
                t=j/13;origin=center(t);width=length*.25*math.sin(math.pi*t)**.8
                for sign in [-1,1]:
                    mat=('grassDry' if variant else 'fernLeaf') if j%4 else 'grassLight'
                    vs,fs=groups.setdefault(mat,([],[]));k=len(vs)
                    tip=origin+side*(width*sign)+forward*(width*.40)+Vector((0,0,-width*.18))
                    mid=origin.lerp(tip,.45)
                    vs.extend([tuple(origin),tuple(mid-forward*.035),tuple(mid+Vector((0,0,.018))),tuple(mid+forward*.035),tuple(tip)])
                    for tri in [(0,1,2),(0,2,3),(1,4,2),(2,4,3)]:fs.extend([tuple(k+i for i in tri),tuple(k+i for i in reversed(tri))])
        for mat,(vs,fs) in groups.items():mesh(name+' pinnae',vs,fs,mat)
        finish(name)

    # Keep the fallen trunk long and partly buried. Broken branch stubs orient
    # its silhouette and give shaded undergrowth a cause to gather around it.
    trunk=beam((-2.2,0,.18),(2.0,.2,.26),.29,'bark',.22,12)
    for x,y,z in [(-1.2,.18,.30),(.1,-.13,.29),(.9,.25,.3)]:
        beam((x,y,z),(x+.2,y*3,z+.32),.095,'bark',.035,7)
    finish('fallenTrunk',[trunk])
