"""Tailored, continuous garments bound to the existing human armature.

Ring profiles retain a readable coat/boot silhouette; sleeves and trousers blend
across the elbow and knee instead of exposing separate primitive joints.
"""
import bpy,math
from mathutils import Vector


def smooth(t):
    t=max(0,min(1,t));return t*t*(3-2*t)


def surface(name,vertices,faces,weights,material,bind):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    first=next(iter(weights[0]));bind(obj,first,material)
    obj.vertex_groups[first].remove(list(range(len(vertices))))
    for i,row in enumerate(weights):
        for bone,weight in row.items():
            if weight<=0:continue
            group=obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
            group.add([i],weight,'REPLACE')
    return obj


def loft(name,profiles,material,bind,bones,center=(0,0),folds=0,opening=False):
    vertices=[];weights=[];faces=[];segments=32
    for row,(z,rx,ry,cy) in enumerate(profiles):
        for j in range(segments+1):
            theta=(-.24*math.pi+j/segments*1.48*math.pi) if opening else j/segments*math.tau
            c,s=math.cos(theta),math.sin(theta)
            ripple=1+folds*math.sin(theta*7+z*13)
            vertices.append((center[0]+math.copysign(abs(c)**.86,c)*rx*ripple,center[1]+cy+math.copysign(abs(s)**.92,s)*ry*ripple,z))
            weights.append(bones(z,row))
    for row in range(len(profiles)-1):
        for j in range(segments):
            a=row*(segments+1)+j;b=a+segments+1;faces.append((a,a+1,b+1,b))
    if not opening:
        faces.append(tuple(reversed(range(segments))))
        faces.append(tuple((len(profiles)-1)*(segments+1)+j for j in range(segments)))
    else:
        # The folded lip has actual thickness along the face opening.
        for side in [0,segments]:
            for row in range(len(profiles)-1):
                a=row*(segments+1)+side;b=a+segments+1;k=len(vertices)
                for index in [a,b]:
                    x,y,z=vertices[index];vertices.append((x*.92,y+.009,z));weights.append(weights[index])
                faces.extend([(a,k,k+1,b),(b,k+1,k,a)])
    return surface(name,vertices,faces,weights,material,bind)


def sleeve(name,points,radii,bones,material,bind):
    vertices=[];weights=[];faces=[];segments=20
    for row,p in enumerate(points):
        point=Vector(p);tangent=(Vector(points[min(row+1,len(points)-1)])-Vector(points[max(0,row-1)])).normalized()
        across=tangent.cross(Vector((0,1,0))).normalized();around=tangent.cross(across).normalized()
        blend=smooth((row/(len(points)-1)-.36)/.32)
        for j in range(segments):
            angle=j/segments*math.tau;radius=radii[row]*(1+.025*math.sin(angle*5+row))
            vertices.append(tuple(point+(across*math.cos(angle)+around*math.sin(angle))*radius))
            weights.append({bones[0]:1-blend,bones[1]:blend})
    for row in range(len(points)-1):
        for j in range(segments):
            a=row*segments+j;b=row*segments+(j+1)%segments;faces.append((a,b,b+segments,a+segments))
    faces.extend([tuple(reversed(range(segments))),tuple((len(points)-1)*segments+j for j in range(segments))])
    return surface(name,vertices,faces,weights,material,bind)


def build_garments(variant,bind,ellipsoid,plate,limb):
    light=variant in ['wayfarer','keeper'];heavy=variant=='sentinel';metal='leather' if light else 'iron'
    def torso(z,row):
        lower=smooth((z-1.04)/.16);upper=smooth((z-1.27)/.16)
        return {'hips':1-lower,'spine':lower*(1-upper),'chest':lower*upper}
    loft('Quilted travelling coat',[(.91,.235,.17,0),(1.01,.232,.16,0),(1.10,.205,.145,0),(1.22,.231,.17,0),(1.35,.265,.18,0),(1.44,.24,.15,0),(1.50,.15,.115,0)],'cloth',bind,torso,folds=.025)
    loft('Shaped cuirass' if not light else 'Fitted leather jerkin',[(1.07,.214,.156,-.005),(1.13,.226,.172,-.008),(1.27,.257,.190,-.01),(1.40,.261,.181,-.008),(1.46,.18,.133,0)],metal,bind,lambda z,row:{'chest':1},folds=.008 if light else 0)
    # A real narrow belt wraps the waist, with a small off-centre clasp.
    loft('Worn waist belt',[(1.005,.239,.169,0),(1.058,.236,.167,0)],'leather',bind,lambda z,row:{'hips':1})
    plate((.075,-.18,1.032),(.070,.020,.056),'hips','brass',.007)
    for side,suffix in [(-1,'L'),(1,'R')]:
        sleeve('Padded sleeve '+suffix,[(side*.29,0,1.435),(side*.365,0,1.315),(side*.44,0,1.18),(side*.475,-.008,1.10),(side*.478,-.012,1.09),(side*.480,-.015,1.07)],[.105,.097,.089,.079,.077,.076],('upperArm'+suffix,'forearm'+suffix),'cloth',bind)
        # Smaller layered shoulders sit over the sleeve rather than replacing it.
        ellipsoid((side*.30,.012,1.45),(.16 if heavy else .12,.173,.083),'upperArm'+suffix,metal,3)
        if not light:
            for row in range(2 if heavy else 1):
                ellipsoid((side*(.32+row*.015),.01,1.405-row*.047),(.139,.158,.043),'upperArm'+suffix,metal,3)
        limb((side*.477,-.012,1.11),(side*.50,-.03,.94),.091,.070,'forearm'+suffix,metal)
        ellipsoid((side*.478,-.012,1.10),(.093,.091,.033),'forearm'+suffix,metal,3)
        ellipsoid((side*.50,-.068,.879),(.060,.076,.072),'hand'+suffix,'leather',3)
        ellipsoid((side*.455,-.075,.873),(.028,.044,.045),'hand'+suffix,'leather',2)
        sleeve('Wool trousers '+suffix,[(side*.14,0,.94),(side*.14,-.01,.79),(side*.14,-.017,.61),(side*.14,-.02,.50),(side*.14,-.01,.33),(side*.14,0,.17)],[.117,.111,.091,.080,.074,.061],('thigh'+suffix,'calf'+suffix),'cloth',bind)
        if not light:
            ellipsoid((side*.14,-.082,.73),(.103,.052,.175),'thigh'+suffix,metal,3)
            ellipsoid((side*.14,-.070,.515),(.086,.058,.075),'calf'+suffix,metal,3)
            limb((side*.14,-.015,.45),(side*.14,0,.16),.089,.073,'calf'+suffix,metal)
        loft('Road boot '+suffix,[(.015,.081,.145,-.075),(.042,.083,.148,-.075),(.095,.082,.144,-.071),(.155,.079,.113,-.042),(.205,.082,.084,-.004),(.28,.085,.084,0)],'leather',bind,lambda z,row:{'foot'+suffix:1-smooth((z-.11)/.12),'calf'+suffix:smooth((z-.11)/.12)},center=(side*.14,0))
        # Split skirt panels follow the thighs; the gap leaves the stride clear.
        if light or variant=='winter':
            length=.34 if variant=='wayfarer' else .45
            loft('Split coat hem '+suffix,[(1.00-length,.139,.102,-.036),(.77,.139,.107,-.03),(.98,.13,.135,0)],'cloth',bind,lambda z,row:{'thigh'+suffix:1},center=(side*.135,0),folds=.045)
        else:
            for row in range(3):
                plate((side*.137,-.151-row*.002,.974-row*.055),(.224,.046,.078),'hips','iron',.025)
    if light:
        # A shadowed face sits inside an open, thick-edged hood.
        ellipsoid((0,.002,1.675),(.108,.096,.141),'head','skin',4)
        for side in [-1,1]:
            ellipsoid((side*.04,-.092,1.704),(.025,.009,.011),'head','lining',3)
            ellipsoid((side*.04,-.099,1.704),(.014,.005,.006),'head','bone',3)
            ellipsoid((side*.04,-.103,1.704),(.006,.003,.006),'head','lining',2)
            ellipsoid((side*.04,-.091,1.721),(.029,.009,.006),'head','lining',3)
            ellipsoid((side*.046,-.081,1.651),(.032,.012,.023),'head','skin',3)
        nose=[(-.010,-.095,1.715),(.010,-.095,1.715),(-.018,-.102,1.650),(.018,-.102,1.650),(0,-.130,1.663),(0,-.116,1.647)]
        surface('Nose bridge',nose,[(0,1,4),(0,4,2),(1,3,4),(2,4,5),(4,3,5),(2,5,3),(0,2,3,1)],[{'head':1}]*len(nose),'skin',bind)
        ellipsoid((0,-.091,1.622),(.023,.004,.003),'head','lining',3)
        loft('Open travelling hood',[(1.53,.127,.112,.02),(1.60,.158,.147,.01),(1.70,.165,.153,.017),(1.78,.137,.131,.023),(1.83,.083,.086,.028),(1.855,.012,.015,.03)],'cloth',bind,lambda z,row:{'head':1},folds=.014,opening=True)
        loft('Draped shoulder cowl',[(1.375,.30,.234,.034),(1.455,.245,.19,.020),(1.54,.151,.116,.018),(1.575,.123,.105,.018)],'cloth',bind,lambda z,row:{'chest':1-smooth((z-1.48)/.14),'head':smooth((z-1.48)/.14)},folds=.035,opening=True)
        for side in [-1,1]:ellipsoid((side*.20,-.128,1.438),(.022,.012,.022),'chest','brass',2)
    else:
        ellipsoid((0,0,1.59),(.112,.11,.10),'head','cloth',3)
        loft('Forged pilgrim helm',[(1.545,.105,.106,.012),(1.60,.135,.128,.005),(1.70,.141,.139,.003),(1.78,.116,.12,.012),(1.824,.070,.077,.018),(1.846,.009,.012,.020)],'iron',bind,lambda z,row:{'head':1})
        plate((0,-.140,1.705),(.221,.018,.023),'head','cloth',.007)
        plate((0,-.147,1.647),(.028,.023,.125),'head','brass',.008)
        for side in [-1,1]:
            for row in range(3):plate((side*.073,-.135,1.64-row*.025),(.028,.014,.007),'head','cloth',.003)
