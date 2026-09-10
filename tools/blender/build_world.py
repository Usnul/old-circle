"""Old Circle's reproducible Blender source. All shipped 3D geometry originates here.
Run pnpm assets:blender, which exports the shared world data first.
No GPU allocation: modeling/export only. Coordinates converted from Blender Z-up to Meep Y-up.
"""
import bpy, math, random, json, sys
from pathlib import Path
from mathutils import Vector, noise

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.local' / 'blender'
OUT.mkdir(parents=True, exist_ok=True)
with open(OUT/'world.json') as f: WORLD=json.load(f)
SOURCE = ROOT / 'assets' / 'blender'
SOURCE.mkdir(parents=True, exist_ok=True)
random.seed(81731)
sys.path.insert(0,str(Path(__file__).resolve().parent))
from ground_materials import build_ground,torus
build_ground(ROOT,WORLD)
vfx=ROOT/'packages/client/public/assets/vfx'
vfx.mkdir(parents=True,exist_ok=True)
sprite=bpy.data.images.new('Soft emissive mote',width=64,height=64,alpha=True)
pixels=[]
for yy in range(64):
 for xx in range(64):
  r=math.hypot((xx-31.5)/31.5,(yy-31.5)/31.5)
  a=max(0,1-r*r)**3
  pixels.extend((1,1,1,a))
sprite.pixels=pixels;sprite.filepath_raw=str(vfx/'mote.png');sprite.file_format='PNG';sprite.save()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
PALETTE = {
 'stone': (.36,.37,.30), 'stoneLight': (.52,.50,.39), 'stoneDark': (.20,.24,.22),
 'grass': (.22,.31,.12), 'grassLight': (.39,.43,.19), 'bark': (.14,.12,.085),
 'leaf': (.10,.21,.12), 'leafLight': (.20,.29,.13), 'brass': (.48,.31,.12),
 'iron': (.20,.23,.24), 'cloth': (.065,.095,.10), 'leather': (.12,.07,.035),
 'ember': (1,.37,.06), 'magic': (.20,.57,.76), 'bone': (.63,.60,.48),
 'sand': (.48,.32,.19), 'snow': (.61,.70,.73), 'ice': (.34,.52,.59),
 'path': (.28,.29,.23), 'sky': (0,0,0), 'glassLeaf': (.12,.23,.27), 'landscape':(.3,.3,.3),
}
materials = {}
for name, rgb in PALETTE.items():
 m = bpy.data.materials.new(name); m.diffuse_color = (*rgb,1); materials[name] = m
assets = {}
colliders = {}
current = []

# Tileable material detail authored here alongside the meshes. No inference/GPU.
textures=ROOT/'packages/client/public/assets/textures';textures.mkdir(parents=True,exist_ok=True)
for kind in ['stone','ground','bark','sky']:
 w,h=(512,256) if kind=='sky' else (256,256)
 image=bpy.data.images.new(kind,width=w,height=h,alpha=True);data=[]
 for yy in range(h):
  for xx in range(w):
   u,v=xx/(w-1),yy/(h-1)
   n=noise.fractal(torus(u,v,.7),.9,2,4)
   if kind=='sky':
    t=max(0,min(1,(v-.4)*2.1));cloud=max(0,min(.35,(n-.12)*.9))
    rgb=tuple(a+(b-a)*t+cloud for a,b in zip((.46,.51,.46),(.07,.17,.24)))
   else:
    grain=noise.noise(torus(u,v,6))
    groove=(max(0,math.sin(u*math.tau*16+n*7))**8)*.22 if kind=='bark' else 0
    k=max(.2,min(1,.80+n*(.09 if kind=='ground' else .22)+grain*.04-groove));rgb=(k,k*.98,k*.94)
   data.extend((*rgb,1))
 image.pixels=data;image.filepath_raw=str(textures/(kind+'.png'));image.file_format='PNG';image.save()

def keep(obj, mat):
 obj.data.materials.append(materials[mat]); current.append(obj); return obj

def cube(p, s, mat='stone', bevel=.06):
 bpy.ops.mesh.primitive_cube_add(size=1, location=p)
 o=bpy.context.object; o.scale=s
 bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
 if bevel:
  mod=o.modifiers.new('Worn edges','BEVEL'); mod.width=bevel; mod.segments=2
  bpy.ops.object.modifier_apply(modifier=mod.name)
 return keep(o,mat)

def ico(p,s,mat='stone',sub=1):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=p)
 o=bpy.context.object; o.scale=s
 if mat in ['iron','brass','leather']:
  for poly in o.data.polygons: poly.use_smooth=True
 return keep(o,mat)

def cone(p,r1,r2,h,mat='stone',n=10):
 bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r1,radius2=r2,depth=h,location=p)
 return keep(bpy.context.object,mat)

def beam(a,b,r,mat='bark',r2=None,n=8):
 a,b=Vector(a),Vector(b); o=cone((a+b)*.5,r,r*.6 if r2 is None else r2,(b-a).length,mat,n)
 o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler(); return o

def mesh(name,verts,faces,mat):
 m=bpy.data.meshes.new(name); m.from_pydata(verts,[],faces); m.update()
 o=bpy.data.objects.new(name,m); bpy.context.collection.objects.link(o); return keep(o,mat)

def leaf_spray(p,mat):
 verts=[];faces=[]
 for i in range(8):
  a=random.random()*math.tau;length=random.uniform(.28,.55);width=length*.6
  origin=Vector((p[0]+random.uniform(-.4,.4),p[1]+random.uniform(-.4,.4),p[2]+random.uniform(-.2,.2)))
  k=len(verts);slope=random.uniform(-.4,.5)
  for x,y,z in [(0,0,0),(-width/2,length*.4,0),(0,length*.45,.045),(width/2,length*.4,0),(0,length,0)]:
   verts.append(tuple(origin+Vector((x*math.cos(a)-y*math.sin(a),x*math.sin(a)+y*math.cos(a),z+y*slope))))
  for tri in [(0,1,2),(0,2,3),(1,4,2),(2,4,3)]:
   faces.append(tuple(k+j for j in tri));faces.append(tuple(k+j for j in reversed(tri)))
 return mesh('Leaf spray',verts,faces,mat)

def finish(name):
 global current
 collection=bpy.data.collections.new(name); bpy.context.scene.collection.children.link(collection)
 chunks=[]
 deps=bpy.context.evaluated_depsgraph_get()
 if name in ['block','column','arch','rock0','rock1','rock2','tree','pine','magicTree','winterTree']:
  parts=current[:1] if name in ['tree','pine','magicTree','winterTree'] else current
  hulls=[]
  for o in parts:
   ev=o.evaluated_get(deps);m=ev.to_mesh();m.calc_loop_triangles();verts=[]
   for vertex in m.vertices:
    v=o.matrix_world @ vertex.co;verts.extend((v.x,v.z,-v.y))
   hulls.append(dict(vertices=verts,indices=[vi for tri in m.loop_triangles for vi in tri.vertices]));ev.to_mesh_clear()
  colliders[name]=hulls
 for mat in sorted(set(o.data.materials[0].name for o in current)):
  positions=[]; normals=[]; indices=[]; uvs=[]
  for o in current:
   if o.data.materials[0].name != mat: continue
   ev=o.evaluated_get(deps); m=ev.to_mesh(); m.calc_loop_triangles()
   matrix=o.matrix_world; normal_matrix=matrix.to_3x3().inverted().transposed()
   for tri in m.loop_triangles:
    for vi,li in zip(tri.vertices,tri.loops):
     v=matrix @ m.vertices[vi].co
     n=(normal_matrix @ (m.vertices[vi].normal if m.polygons[tri.polygon_index].use_smooth else tri.normal)).normalized()
     if mat=='landscape':
      ix=round((v.x-WORLD['minX'])/2);iz=round((-v.y-WORLD['minZ'])/2);heights=WORLD['heights']
      ax,bx=max(0,ix-1),min(240,ix+1);az,bz=max(0,iz-1),min(320,iz+1)
      hx=(heights[iz][bx]-heights[iz][ax])/((bx-ax)*2);hz=(heights[bz][ix]-heights[az][ix])/((bz-az)*2)
      n=Vector((-hx,hz,1)).normalized()
     indices.append(len(positions)//3); positions.extend((v.x,v.z,-v.y)); normals.extend((n.x,n.z,-n.y))
     if mat=='sky':uvs.extend(m.uv_layers.active.data[li].uv)
     elif abs(n.z)>.65:uvs.extend((v.x*.45,v.y*.45))
     elif abs(n.x)>abs(n.y):uvs.extend((v.y*.45,v.z*.45))
     else:uvs.extend((v.x*.45,v.z*.45))
   ev.to_mesh_clear()
  chunks.append(dict(material=mat,positions=positions,normals=normals,indices=indices,uvs=uvs))
 for o in current:
  for c in list(o.users_collection): c.objects.unlink(o)
  collection.objects.link(o)
 collection.hide_viewport=True; collection.hide_render=True
 assets[name]=chunks; current=[]

# Modular masonry. Individual voussoirs and carved rings remain readable in grazing light.
cube((0,0,.5),(1,1,1)); finish('block')
for z,r,h in [(0.15,.68,.3),(.42,.52,.25),(2.35,.34,3.7),(4.35,.51,.25),(4.6,.64,.25)]: cone((0,0,z),r,r*.97,h,'stoneLight',12)
for i in range(8):
 a=i*math.tau/8; beam((math.cos(a)*.32,math.sin(a)*.32,.8),(math.cos(a)*.32,math.sin(a)*.32,3.9),.045,'stone')
finish('column')
for side in [-1,1]:
 for j in range(7): cube((side*2.05,0,j*.65+.32),(.72,.9,.62),'stoneLight' if j%3==0 else 'stone',.06)
for j in range(13):
 a=j*math.pi/13; b=(j+1)*math.pi/13-.02
 verts=[(r*math.cos(t),y,4.5+r*math.sin(t)) for y in [-.48,.48] for r in [1.7,2.42] for t in [a,b]]
 mesh('Arch stone',verts,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],'stoneLight' if j%4==0 else 'stone')
finish('arch')
for j in range(28):
 a=(j+2)*math.tau/32; b=a+math.tau/32-.022
 verts=[(r*math.cos(t),y,r*math.sin(t)) for y in [-.25,.25] for r in [4.3,4.95] for t in [a,b]]
 mesh('Halo segment',verts,[(0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)],'stoneLight')
finish('halo')
for i in range(3):
 random.seed(193+i)
 ico((0,0,.6),(1.4,1.1,1),'stone',2)
 ico((.5,.2,.6),(.8,.7,.7),'stoneDark',1)
 finish('rock'+str(i))

# Trees with bent trunks, branching roots and clustered leaves; coherent repeated silhouettes.
for name,foliage in [('tree','leaf'),('magicTree','magic'),('winterTree','snow')]:
 beam((0,0,0),(.2,.12,6.8),.48,'bark',.16,10)
 for j in range(7):
  a=j*2.4; x,y=math.cos(a),math.sin(a)
  beam((0,0,.15),(x*1.6,y*1.6,.05),.2,'bark',.05)
  tip=(x*2.9,y*2.9,4.3+(j%3)*1.0)
  beam((.1,.1,2.9+j*.38),tip,.20,'bark',.06)
  if name=='winterTree':
   for k in range(5):
    angle=a+(k-2)*.38;end=(tip[0]+math.cos(angle)*1.4,tip[1]+math.sin(angle)*1.4,tip[2]+.8+k*.1)
    beam(tip,end,.05,'bark',.008,5)
    if k%2==0:beam((tip[0],tip[1],tip[2]+.05),(end[0],end[1],end[2]+.03),.055,'snow',.015,5)
   continue
  # Many irregular sprays leave negative space in the canopy instead of solid balls.
  for k in range(26):
   angle=random.random()*math.tau;radius=random.uniform(.25,1.85)
   p=(tip[0]+math.cos(angle)*radius,tip[1]+math.sin(angle)*radius,tip[2]+random.uniform(-.1,1.45))
   mat=('leafLight' if k%4==0 else 'leaf') if foliage=='leaf' else ('magic' if k%16==0 else 'glassLeaf') if foliage=='magic' else foliage
   leaf_spray(p,mat)
 for k in range(0 if name=='winterTree' else 25):
  a=random.random()*math.tau;r=random.random()*1.7
  leaf_spray((math.cos(a)*r,math.sin(a)*r,7+random.uniform(-.2,1)),'glassLeaf' if foliage=='magic' else foliage)
 finish(name)
beam((0,0,0),(.1,0,9),.42,'bark',.05)
for j in range(10):
 z=1.4+j*.7;radius=3.2*(1-j/12)
 for k in range(6):
  a=k*math.tau/6+j*1.17;tip=Vector((math.cos(a)*radius,math.sin(a)*radius,z-.25))
  root=Vector((.05,0,z+.45));beam(root,tip,.08*(1-j/12),'bark',.009,5)
  verts=[];faces=[]
  for n in range(22):
   t=.2+n/27;center=root.lerp(tip,t);width=(1-t)*.55+.1
   for side in [-1,1]:
    end=center+Vector((math.cos(a+side*.9)*width,math.sin(a+side*.9)*width,.13))
    index=len(verts);verts.extend([tuple(center+Vector((0,0,.035))),tuple(end+Vector((-.05,.035,0))),tuple(end+Vector((.05,-.035,0)))])
    faces.extend([(index,index+1,index+2),(index+2,index+1,index)])
  mesh('Needled pine bough',verts,faces,'leafLight' if j%4==0 else 'leaf')
finish('pine')
for j in range(22):
 a=random.random()*math.tau; r=random.random()*.75; x,y=math.cos(a)*r,math.sin(a)*r; h=random.uniform(.25,.8)
 mesh('Grass blade',[(x-.035,y,0),(x+.035,y,0),(x+.1,y+.06,h*.65),(x+.17,y+.1,h)],[(0,1,2),(0,2,3),(2,1,0),(3,2,0)],'grassLight' if j%4==0 else 'grass')
finish('grass')
for j in range(7):
 x,y=random.uniform(-.5,.5),random.uniform(-.5,.5); h=random.uniform(.3,.65)
 beam((x,y,0),(x,y,h),.012,'grass',.006,5)
 for k in range(5):
  a=k*math.tau/5; ico((x+math.cos(a)*.055,y+math.sin(a)*.055,h),(.05,.04,.02),'bone')
finish('flowers')
# A mixed patch, with flowers growing among blades rather than in isolated tufts.
for j in range(36):
 a=random.random()*math.tau;r=math.sqrt(random.random())*.9;x,y=math.cos(a)*r,math.sin(a)*r;h=random.uniform(.14,.42)
 mesh('Meadow blades',[(x-.018,y,0),(x+.018,y,0),(x+.05,y+.03,h*.65),(x+.09,y+.06,h)],[(0,1,2),(0,2,3),(2,1,0),(3,2,0)],'grassLight' if j%5==0 else 'grass')
 if j in [7,23]:
  beam((x,y,0),(x,y,h+.04),.006,'grass',.004,4)
  for k in range(5):
   a=k*math.tau/5;ico((x+math.cos(a)*.033,y+math.sin(a)*.033,h+.04),(.033,.025,.012),'bone')
finish('groundcover')
cone((0,0,.12),.7,.62,.24,'stoneDark')
cone((0,0,.5),.13,.12,.7,'brass')
cone((0,0,.95),.48,.6,.24,'brass')
ico((0,0,1.1),(.27,.27,.22),'ember',2)
finish('brazier')

# Armour pieces are authored around their attachment pivots for procedural joint animation.
ico((0,0,1.15),(.32,.21,.48),'iron',2)
cube((0,0,.9),(.58,.40,.13),'brass',.02)
for side in [-1,1]: ico((side*.37,0,1.45),(.23,.27,.18),'iron',2)
for j in range(5): cube((0,-.205,.95+j*.1),(.36,.025,.035),'brass',.009)
finish('torso')
ico((0,0,.13),(.23,.22,.28),'iron',2)
cube((0,-.21,.12),(.36,.035,.06),'cloth',.008)
beam((0,0,.32),(0,0,.52),.08,'brass',.015)
finish('helm')
beam((0,0,0),(0,0,-.42),.11,'iron',.085,8)
ico((0,0,-.45),(.13,.14,.12),'brass')
beam((0,0,-.48),(0,-.02,-.79),.095,'iron',.07,8)
finish('arm')
beam((0,0,0),(0,0,-.43),.11,'iron',.085,10)
ico((0,0,-.43),(.12,.12,.1),'brass',2);finish('upperArm')
beam((0,0,0),(0,0,-.32),.095,'iron',.07,10)
ico((0,0,-.38),(.08,.085,.1),'leather',2);finish('forearm')
beam((0,0,0),(0,0,-.40),.14,'cloth',.105)
beam((0,0,-.4),(0,-.01,-.74),.105,'iron',.09)
cube((0,-.10,-.78),(.22,.40,.14),'leather',.03); finish('leg')
verts=[]; faces=[]
for j in range(9):
 for i in range(9):
  t=j/8; w=.23+t*.36; verts.append(((i/8-.5)*w*2,.20+t*.18+math.sin(i*1.8)*.04,1.5-t*1.3))
for j in range(8):
 for i in range(8):
  k=j*9+i; faces.extend([(k,k+9,k+1),(k+1,k+9,k+10),(k+1,k+9,k),(k+10,k+9,k+1)])
mesh('Cloak',verts,faces,'cloth'); finish('cloak')
cube((0,0,.4),(.08,.065,.95),'iron',.015)
mesh('Blade point',[(-.04,-.033,.87),(.04,-.033,.87),(0,-.02,1.13),(-.04,.033,.87),(.04,.033,.87),(0,.02,1.13)],[(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],'iron')
cube((0,0,-.12),(.32,.08,.07),'brass',.015); beam((0,0,-.38),(0,0,-.13),.044,'leather',.044)
ico((0,0,-.42),(.075,.06,.07),'brass'); finish('sword')
beam((0,0,-1.1),(0,0,1.2),.035,'bark',.035)
cone((0,0,1.35),.075,0,.4,'iron',4); finish('spear')
for j in range(16):
 a=-1.3+j*2.6/16; b=a+2.6/16
 beam((math.cos(a)*.40-.40,0,math.sin(a)*.8),(math.cos(b)*.40-.40,0,math.sin(b)*.8),.037,'bark',.037)
beam((math.cos(1.3)*.4-.4,0,-math.sin(1.3)*.8),(math.cos(1.3)*.4-.4,0,math.sin(1.3)*.8),.006,'bone',.006,4); finish('bow')
beam((0,0,-.4),(0,0,1.1),.055,'bark',.04)
ico((0,0,1.25),(.17,.13,.24),'magic',2); finish('staff')
beam((0,0,-.5),(0,0,.5),.018,'bark',.018,5); cone((0,0,.57),.055,0,.18,'iron',4); finish('arrow')
ico((0,0,0),(.13,.13,.13),'ember',2); finish('spell')
for name,mat in [('dangerRing','ember'),('frostRing','magic')]:
 bpy.ops.mesh.primitive_torus_add(major_radius=1,minor_radius=.009,major_segments=96,minor_segments=4)
 keep(bpy.context.object,mat);finish(name)
ico((0,0,.6),(.32,.7,.33),'bark',2)
ico((0,-.65,.68),(.22,.27,.23),'bark',2)
for x in [-.22,.22]:
 for y in [-.45,.45]: beam((x,y,.6),(x,y*.95,.05),.095,'bark',.045)
for x in [-.13,.13]: cone((x,-.68,.97),.09,0,.27,'bark',5)
finish('hound')

# Landform tiles, authored in Blender; path colour is baked into material splits.
def height(x,z): return WORLD['heights'][round((z-WORLD['minZ'])/2)][round((x-WORLD['minX'])/2)]
for tx in range(-3,3):
 for tz in range(-6,2):
  groups={}
  for j in range(40):
   for i in range(40):
    x=tx*80+i*2; z=tz*80+j*2
    cell=WORLD['cells'][round((z-WORLD['minZ'])/2)][round((x-WORLD['minX'])/2)]
    mat='landscape'
    verts,faces=groups.setdefault(mat,([],[])); k=len(verts)
    verts.extend([(a,-b,height(a,b)) for a,b in [(x,z),(x+2,z),(x,z+2),(x+2,z+2)]])
    faces.extend([(k,k+2,k+1),(k+1,k+2,k+3)])
  for mat,(verts,faces) in groups.items(): mesh('Landform',verts,faces,mat)
  finish(f'terrain_{tx}_{tz}')

with open(OUT/'meshes.json','w') as f: json.dump(assets,f,separators=(',',':'))
with open(ROOT/'packages/game/src/content/colliders.json','w') as f: json.dump(colliders,f,separators=(',',':'))
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'old-circle-kit.blend'))
print('OLD CIRCLE: exported',len(assets),'Blender assets to',OUT)
