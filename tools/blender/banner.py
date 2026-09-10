"""Pinned hanging cloth, authored as editable Blender armature action loops."""
import bpy, math
from mathutils import Vector

def build_banner(export,materials,objects):
    definitions=[('mast',None,(0,0,0),(0,0,3.6),.06,0)]
    for i in range(5):
        definitions.append(('cloth'+str(i),'mast' if i==0 else 'cloth'+str(i-1),(.9,0,3.4-i*.5),(.9,0,2.9-i*.5),.01,0))
    def mesh_builder():
        vertices=[];faces=[]
        for row in range(17):
            t=row/16
            for col in range(13):
                u=col/12;hem=max(0,(t-.82)/.18)*(.08+.09*math.sin(col*2.3)**2)
                vertices.append((.18+u*1.44,.035*math.sin(u*math.tau*3)*t,3.4-t*2.5+hem))
        for row in range(16):
            for col in range(12):
                a=row*13+col;b=a+1;c=a+13;d=c+1
                faces.extend([(a,c,b),(b,c,d),(b,c,a),(d,c,b)])
        mesh=bpy.data.meshes.new('Woven votive banner');mesh.from_pydata(vertices,[],faces);mesh.update()
        obj=bpy.data.objects.new('Votive cloth',mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(materials['cloak']);objects().append(obj)
        groups=[obj.vertex_groups.new(name='cloth'+str(i)) for i in range(5)]
        for index,p in enumerate(vertices):
            u=max(0,min(4,(3.4-p[2])/.5));lo=int(u);hi=min(4,lo+1)
            groups[lo].add([index],1-(u-lo),'REPLACE')
            if hi!=lo:groups[hi].add([index],u-lo,'REPLACE')
    def pose(kind,time,duration,weapon):
        phase=time/duration*math.tau;amplitude={'calm':.14,'breeze':1.8,'reverse':-1.8}[kind]
        pose={'mast':(Vector((0,0,0)),Vector((0,0,3.6)))};head=Vector((.9,0,3.4))
        for i in range(5):
            angle=amplitude*(.12+i*.065+(.065+i*.01)*math.sin(phase-i*.65)+.025*math.sin(phase*2-i*.9))
            tail=head+Vector((0,math.sin(angle)*.5,-math.cos(angle)*.5));pose['cloth'+str(i)]=(head.copy(),tail.copy());head=tail
        return pose
    export('votiveBanner',definitions,mesh_builder,pose,[(kind,kind,3.6,'') for kind in ['calm','breeze','reverse']])
