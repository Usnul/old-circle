"""Blender armatures, weighted armour/cloth and authored full-body action cycles.

Exports native-mesh compiler input and sampled TRS curves. The saved blend keeps
the armatures, skin modifiers and editable Actions; no GLTF conversion at runtime.
"""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from equipment_materials import build_equipment_materials,apply_equipment_materials
build_equipment_materials(ROOT)
OUT=ROOT/'.local/blender';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
TAU=math.tau
MATERIALS={}
for name,color in {'iron':(.20,.23,.24),'brass':(.48,.31,.12),'cloth':(.065,.095,.10),'cloak':(1,1,1),'leather':(.12,.07,.035),'bone':(.63,.60,.48),'bark':(.14,.12,.085),'ember':(1,.37,.06)}.items():
    mat=bpy.data.materials.new(name);mat.diffuse_color=(*color,1);MATERIALS[name]=mat
apply_equipment_materials(MATERIALS,ROOT)
GEOMETRY={};RIGS={};objects=[]

def bind(obj,bone,material):
    obj.data.materials.append(MATERIALS[material]);group=obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))),1,'REPLACE');objects.append(obj)
    for p in obj.data.polygons:p.use_smooth=True
    return obj

def ellipsoid(p,scale,bone,material='iron',sub=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=p)
    obj=bpy.context.object;obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return bind(obj,bone,material)

def plate(p,scale,bone,material='iron',bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p);obj=bpy.context.object;obj.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=obj.modifiers.new('Rounded plate edges','BEVEL');mod.width=bevel;mod.segments=2
    bpy.ops.object.modifier_apply(modifier=mod.name);return bind(obj,bone,material)

def limb(a,b,r1,r2,bone,material='iron'):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=12,radius1=r1,radius2=r2,depth=(b-a).length,location=(a+b)/2)
    obj=bpy.context.object;obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return bind(obj,bone,material)

def v(p):return Vector(p)
def mix(a,b,t):return v(a).lerp(v(b),max(0,min(1,t)))
def smooth(t):t=max(0,min(1,t));return t*t*(3-2*t)
def keypose(keys,t):
    for (ta,a),(tb,b) in zip(keys,keys[1:]):
        if t<=tb:return mix(a,b,smooth((t-ta)/(tb-ta)))
    return v(keys[-1][1])

def elbow(a,b,l1,l2,pole):
    d=b-a;length=min(l1+l2-.005,max(.001,d.length));axis=d.normalized()
    mid=(l1*l1-l2*l2+length*length)/(2*length)
    side=v(pole)-axis*v(pole).dot(axis)
    if side.length<.001:side=v((0,-1,0))
    return a+axis*mid+side.normalized()*math.sqrt(max(0,l1*l1-mid*mid))

HUMAN=[
 ('hips',None,(0,0,.94),(0,0,1.12),.17,15),
 ('spine','hips',(0,0,1.12),(0,0,1.34),.18,12),
 ('chest','spine',(0,0,1.34),(0,0,1.51),.20,12),
 ('head','chest',(0,0,1.51),(0,-.015,1.79),.13,5),
]
for suffix,side in [('L',-1),('R',1)]:
    HUMAN.extend([
      ('upperArm'+suffix,'chest',(side*.29,0,1.43),(side*.46,0,1.15),.08,2.6),
      ('forearm'+suffix,'upperArm'+suffix,(side*.46,0,1.15),(side*.50,-.03,.90),.065,1.6),
      ('hand'+suffix,'forearm'+suffix,(side*.50,-.03,.90),(side*.5,-.13,.83),.055,.6),
      ('thigh'+suffix,'hips',(side*.14,0,.94),(side*.14,-.02,.51),.095,6),
      ('calf'+suffix,'thigh'+suffix,(side*.14,-.02,.51),(side*.14,0,.10),.065,3),
      ('foot'+suffix,'calf'+suffix,(side*.14,0,.10),(side*.14,-.21,.07),.06,1),
    ])
HUMAN.extend([
 ('cloak1','chest',(0,.19,1.43),(0,.25,1.03),0,0),
 ('cloak2','cloak1',(0,.25,1.03),(0,.31,.64),0,0),
 ('cloak3','cloak2',(0,.31,.64),(0,.38,.26),0,0),
 ('weapon','handR',(.5,-.03,.90),(.60,-.02,.72),0,0),
])

def make_rig(name,definitions):
    arm=bpy.data.armatures.new(name);rig=bpy.data.objects.new(name,arm);bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for name,parent,head,tail,*_ in definitions:
        b=arm.edit_bones.new(name);b.head=head;b.tail=tail
        if parent:b.parent=arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT');rig.animation_data_create()
    for b in rig.pose.bones:b.rotation_mode='QUATERNION'
    return rig

def human_mesh(variant='pilgrim'):
    light=variant in ['wayfarer','keeper'];heavy=variant=='sentinel'
    metal='leather' if light else 'iron'
    ellipsoid((0,0,1.16),(.245,.155,.29),'spine','cloth')
    ellipsoid((0,-.01,1.33),(.255 if heavy else .245,.175,.205),'chest',metal)
    # Overlapping faulds, a narrow waist, articulated pauldrons and greaves.
    for i in range(4):
        ellipsoid((0,0,1.06-i*.055),(.235+i*.008,.155,.053),'hips','cloth' if light else 'iron')
    plate((0,-.174,1.33),(.035,.022,.27),'chest','brass',.008)
    plate((0,0,1.03),(.50,.35,.055),'hips','leather')
    plate((.08,-.181,1.03),(.065,.018,.065),'hips','brass',.006)
    for side,suffix in [(-1,'L'),(1,'R')]:
        ellipsoid((side*.30,0,1.44),(.19 if heavy else .105 if light else .145,.19 if heavy else .17,.12 if heavy else .105),'upperArm'+suffix,metal)
        for row in range(4 if heavy else 1 if light else 3):
            plate((side*.315,0,1.425-row*.047),(.23 if heavy else .16,.32,.04),'upperArm'+suffix,metal,.018)
        limb((side*.33,0,1.38),(side*.445,0,1.17),.079,.062,'upperArm'+suffix,'cloth')
        ellipsoid((side*.46,0,1.15),(.085,.077,.08),'forearm'+suffix,metal)
        limb((side*.46,0,1.12),(side*.50,-.03,.925),.072,.05,'forearm'+suffix,metal)
        ellipsoid((side*.5,-.06,.885),(.058,.066,.067),'hand'+suffix,'leather')
        for finger in range(3):plate((side*.5+(finger-1)*.025,-.105,.859),(.018,.06,.035),'hand'+suffix,'iron',.007)
        limb((side*.14,0,.91),(side*.14,-.02,.56),.112,.08,'thigh'+suffix,'cloth')
        ellipsoid((side*.14,-.068,.73),(.10,.075,.19),'thigh'+suffix,metal)
        ellipsoid((side*.14,-.07,.52),(.088,.083,.092),'calf'+suffix,metal)
        limb((side*.14,-.02,.48),(side*.14,0,.13),.077,.052,'calf'+suffix,metal)
        plate((side*.14,-.09,.072),(.15,.29,.13),'foot'+suffix,'leather',.035)
        plate((side*.14,-.17,.102),(.155,.16,.065),'foot'+suffix,'iron',.02)
    ellipsoid((0,0,1.62),(.116,.114,.12),'head','cloth')
    ellipsoid((0,0,1.685),(.155 if light else .137,.147 if light else .133,.18 if light else .162),'head','cloth' if light else 'iron')
    plate((0,-.125,1.69),(.23,.034,.036),'head','cloth',.008)
    plate((0,-.15,1.646),(.025,.025,.085),'head','brass',.006)
    for side in [-1,1]:
        plate((side*.098,-.099,1.625),(.055,.064,.091),'head','cloth' if light else 'iron',.017)
        for j in range(3):ellipsoid((side*(.07+j*.045),-.165,1.40),(.011,.01,.011),'chest','brass',1)
    if heavy:
        # Lamellar collar, a split crown crest and a heavy lower breastplate.
        for side in [-1,1]:
            plate((side*.15,.01,1.5),(.09,.26,.17),'chest','brass',.015)
            for j in range(3):plate((side*(.04+j*.04),.015,1.82+j*.025),(.025,.14,.13),'head','brass',.006)
        plate((0,-.18,1.22),(.35,.035,.12),'spine','brass',.02)
    if variant=='winter':
        for j in range(13):
            angle=j/12*math.pi
            ellipsoid((math.cos(angle)*.29,.015+math.sin(angle)*.13,1.49),(.10,.09,.10),'chest','bone',2)
    if variant=='keeper':
        # Separate hanging tabards follow each thigh and leave the stride clear.
        for side,suffix in [(-1,'L'),(1,'R')]:
            plate((side*.13,-.105,.69),(.22,.08,.48),'thigh'+suffix,'cloth',.04)
            plate((side*.13,-.151,.70),(.018,.015,.40),'thigh'+suffix,'brass',.004)
        for j in range(7):ellipsoid(((j-3)*.047,-.182,1.23-abs(j-3)*.017),(.018,.014,.022),'chest','brass',1)
    if variant=='wayfarer':
        plate((.23,-.09,1.02),(.13,.13,.20),'hips','leather',.035)
        plate((-.22,.10,1.04),(.15,.13,.14),'hips','leather',.03)
    # Cloth spans several joints, with a frayed silhouette and a centre split.
    verts=[];faces=[]
    for row in range(17):
        t=row/16
        for col in range(13):
            s=col/12;z=1.43-t*(.78 if variant=='wayfarer' else 1.17)
            if row==16:z+=.04*math.sin(col*2.7)+(.12 if col==6 else 0)
            verts.append(((s-.5)*(.48+t*.28),.19+t*.19+math.sin(s*TAU*3)*.025,z))
    for row in range(16):
        for col in range(12):
            a=row*13+col;faces.extend([(a,a+13,a+1),(a+1,a+13,a+14),(a+1,a+13,a),(a+14,a+13,a+1)])
    mesh=bpy.data.meshes.new('Weighted travelling cloak');mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new('Travelling cloak',mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(MATERIALS['cloak']);objects.append(obj)
    uv=mesh.uv_layers.new(name='Travelling cloth atlas')
    for loop in mesh.loops:uv.data[loop.index].uv=(loop.vertex_index%13/12,1-(loop.vertex_index//13)/16)
    groups=[obj.vertex_groups.new(name='cloak'+str(i+1)) for i in range(3)]
    for index,vert in enumerate(verts):
        u=max(0,min(2,(1.43-vert[2])/.4));lo=int(u);hi=min(2,lo+1)
        groups[lo].add([index],1-(u-lo),'REPLACE')
        if hi!=lo:groups[hi].add([index],u-lo,'REPLACE')

def human_pose(kind,time,duration,weapon):
    direction=(0,-1)
    for suffix,angle in [('forward_right',45),('back_right',135),('back_left',225),('forward_left',315),('right',90),('back',180),('left',270)]:
        if kind.endswith('_'+suffix):
            kind=kind[:-(len(suffix)+1)];radians=math.radians(angle);direction=(-math.sin(radians),-math.cos(radians));break
    phase=time/duration;cycle=phase*TAU;walk=kind in ['walk','run','crouch_walk'];run=kind=='run';crouch=kind in ['crouch','crouch_walk']
    bob=(.004 if not walk else -.025 if not run else -.05)*math.cos(cycle*2 if walk else cycle)
    root=v((.018*math.sin(cycle) if walk else .006*math.sin(cycle),0,(.84 if run else .91 if walk else .94)+bob-(.31 if crouch else 0)))
    lean=.12*-direction[1] if run else .2 if crouch else 0
    chest_yaw=.06*math.sin(cycle) if walk else .015*math.sin(cycle)
    if kind=='hurt':root.y+=.10*math.sin(math.pi*phase);lean=-.22*math.sin(math.pi*phase)
    if kind=='land':root.z-=.22*math.sin(math.pi*phase)
    if kind=='jump':lean=.12*math.sin(math.pi*phase);root.z-=.05*math.sin(math.pi*phase)
    if kind=='mantle':root.y-=.14*math.sin(math.pi*phase);root.z-=.25*(1-smooth(phase))
    if kind=='sword':chest_yaw=keypose([(0,(0,0,.0)),(.18,(0,0,-.50)),(.43,(0,0,.60)),(.72,(0,0,0))],time).z
    ritual={'bell_slam':1.2,'root_call':1.05,'cinder_volley':.95,'mirror_prayer':1.1,'winter_sweep':1.15,'king_judgment':1.45}.get(kind)
    if ritual:
        impact=max(0,1-abs(time-ritual-.12)/.4)
        if kind in ['bell_slam','root_call','king_judgment']:root.z-=.15*impact;lean+=.17*impact
        if kind=='winter_sweep':chest_yaw=.5*math.sin(math.pi*time/duration)
    rot=Matrix.Rotation(chest_yaw,4,'Z')@Matrix.Rotation(lean,4,'X')
    def body(p):return root+rot.to_3x3()@v(p)
    spine=body((0,0,.18));chest=body((0,0,.4));neck=body((0,0,.57));head=body((.012*math.sin(cycle),-.015,.85))
    poses={'hips':(root,spine),'spine':(spine,chest),'chest':(chest,neck),'head':(neck,head)}
    for suffix,side,shift in [('L',-1,0),('R',1,math.pi)]:
        ph=(cycle+shift)%TAU;stride=.28 if not run else .46
        # Contact, down, passing and up: the support foot travels backwards
        # linearly during stance, then clears the ground during its return.
        f=ph/TAU;fy=(-stride*(1-4*f) if f<.5 else stride-4*stride*(f-.5)) if walk else -.025
        lift=(.13 if not run else .23)*math.sin((f-.5)*TAU) if walk and f>=.5 else 0
        hip=body((side*.14,0,0));foot=v((side*.14-direction[0]*fy,-direction[1]*fy,.1+max(0,lift)))
        # Side steps use separate fore/aft lanes to clear the passing foot.
        if walk:foot.y+=side*.075*abs(direction[0])
        if crouch:foot.y-=.08
        if kind in ['jump','hang','mantle']:
            foot=body((side*.18,-.1 if suffix=='L' else .05,-.63 if kind=='hang' else -.69))
            if kind=='jump':
                tuck=math.sin(math.pi*phase)**2;foot=body((side*.17,-.06-(.19 if suffix=='L' else .10)*tuck,-.83+.22*tuck))
            if kind=='mantle' and suffix=='L':foot=body((side*.18,-.38,-.26))
        knee=elbow(hip,foot,.43,.41,(0,-1,.1));toe=foot+v((0,-.21,.015 if lift>.01 else -.03))
        poses['thigh'+suffix]=(hip,knee);poses['calf'+suffix]=(knee,foot);poses['foot'+suffix]=(foot,toe)
    shoulderR=body((.29,0,.49));shoulderL=body((-.29,0,.49))
    swing=.18*math.sin(cycle) if walk else .012*math.sin(cycle)
    right=body((.42,-.07-swing,.07));left=body((-.42,-.10+swing,.08))
    direction=v((.20,.04,-.98)).normalized()
    if weapon=='spear':right=body((.34,-.18,.14));left=body((-.15,-.49,.20));direction=v((0,-.9,.44)).normalized()
    if weapon=='staff':right=body((.38,-.17,.13));direction=v((.08,-.12,1)).normalized()
    if weapon=='bow':right=body((.33,-.21,.22));left=body((-.25,-.22,.26));direction=v((0,0,1))
    if kind=='sword':
        right=body(keypose([(0,(.42,-.07,.07)),(.14,(.46,.12,.54)),(.22,(.49,-.30,.49)),(.42,(-.24,-.47,.28)),(.56,(.11,-.26,.15)),(.72,(.42,-.07,.07))],time))
        direction=keypose([(0,(.2,0,-1)),(.14,(.65,-.15,.74)),(.22,(.75,-.65,.1)),(.43,(-.8,-.55,-.15)),(.72,(.2,0,-1))],time).normalized()
        left=body((-.31,-.27,.28))
    elif kind=='spear':
        thrust=keypose([(0,(0,0,0)),(.23,(0,.18,0)),(.38,(0,-.32,.08)),(.48,(0,-.32,.08)),(.85,(0,0,0))],time)
        right=body(v((.29,-.13,.22))+thrust);direction=v((0,-1,-.02)).normalized();left=right+direction*.42+v((-.18,0,0))
    elif kind=='bow':
        right=body((.13,-.50,.43));left=body(keypose([(0,(-.17,-.32,.38)),(.36,(-.21,-.01,.45)),(.50,(-.22,.08,.45)),(.8,(-.25,-.22,.26))],time));direction=v((0,0,1))
    elif kind in ['staff','nova']:
        lift=math.sin(math.pi*phase);right=body((.32,-.27,.15+.42*lift));left=body((-.30,-.25,.15+.36*lift));direction=v((.06,-.35,1)).normalized()
    elif ritual:
        raise_amount=smooth(time/ritual);settle=1-smooth((time-ritual)/max(.01,duration-ritual))
        if kind=='bell_slam':
            hands=keypose([(0,(.25,-.16,.20)),(ritual*.8,(.12,.04,1.00)),(ritual,(.10,-.43,-.18)),(duration,(.34,-.18,.14))],time)
            right=body(hands);left=body((-hands.x,hands.y,hands.z));direction=v((0,-.25,-1)).normalized()
        elif kind=='root_call':
            spread=math.sin(math.pi*time/duration);right=body((.36+.25*spread,-.12,.18+.40*raise_amount*settle));left=body((-.36-.25*spread,-.12,.18+.40*raise_amount*settle));direction=v((0,-.6,-.8))
        elif kind=='cinder_volley':
            right=body((.20,-.53,.34+.22*raise_amount*settle));left=body((-.30,-.31,.25));direction=v((0,-1,.10)).normalized()
        elif kind=='mirror_prayer':
            spread=smooth((time-ritual*.7)/.3)*settle;right=body((.08+.43*spread,-.32,.50));left=body((-.08-.43*spread,-.32,.50));direction=v((0,0,1))
        elif kind=='winter_sweep':
            sweep=keypose([(0,(.38,-.1,.2)),(ritual*.8,(-.20,-.35,.50)),(ritual+.2,(.52,-.35,.19)),(duration,(.34,-.18,.14))],time)
            right=body(sweep);left=body((-.24,-.34,.22));direction=v((.5*math.sin(time*3),-1,.1)).normalized()
        else:
            right=body((.34,-.12,.20+.62*raise_amount*settle));left=body((-.40,-.30,.25+.25*raise_amount*settle));direction=v((0,0,1))
    elif kind in ['hang','mantle']:
        amount=1 if kind=='hang' else 1-smooth(phase)
        right=body((.31,-.23,.14+.66*amount));left=body((-.31,-.23,.14+.66*amount));direction=v((0,0,-1))
    elif kind=='jump':
        tuck=math.sin(math.pi*phase);right=body((.39,-.1,.12+.28*tuck));left=body((-.39,-.2,.10+.24*tuck))
    for suffix,side,shoulder,hand in [('R',1,shoulderR,right),('L',-1,shoulderL,left)]:
        if (hand-shoulder).length>.577:hand=shoulder+(hand-shoulder).normalized()*.577
        if suffix=='R':right=hand
        bend=elbow(shoulder,hand,.327,.255,(side,.35,-.3))
        poses['upperArm'+suffix]=(shoulder,bend);poses['forearm'+suffix]=(bend,hand)
        poses['hand'+suffix]=(hand,hand+direction*.11 if suffix=='R' else hand+v((0,-.10,-.04)))
    poses['weapon']=(right,right+direction*.2)
    previous=body((0,.19,.49))
    for j in range(3):
        end=previous+v((math.sin(cycle-j*.6)*.018,(.16 if crouch else .06)+(.12 if run else .025)*math.sin(cycle-j*.8),-.29 if crouch else -.39))
        poses['cloak'+str(j+1)]=(previous,end);previous=end
    return poses

HOUND=[('hips',None,(0,.35,.68),(0,0,.71),.17,9),('chest','hips',(0,0,.71),(0,-.40,.72),.18,10),
       ('head','chest',(0,-.4,.72),(0,-.76,.77),.13,3),('jaw','head',(0,-.70,.71),(0,-.97,.67),.07,1),
       ('tail','hips',(0,.40,.68),(0,.97,.91),.05,.7)]
for suffix,x,y in [('FL',-.20,-.32),('FR',.20,-.32),('BL',-.20,.37),('BR',.20,.37)]:
    HOUND.extend([('upper'+suffix,'chest' if y<0 else 'hips',(x,y,.65),(x,y+.09,.35),.05,1.5),('lower'+suffix,'upper'+suffix,(x,y+.09,.35),(x,y-.03,.08),.04,.8)])

def hound_mesh():
    ellipsoid((0,.26,.65),(.24,.37,.24),'hips','bark')
    ellipsoid((0,-.20,.70),(.26,.37,.28),'chest','bark')
    ellipsoid((0,-.58,.76),(.17,.23,.19),'head','bark')
    ellipsoid((0,-.82,.69),(.115,.22,.085),'jaw','bark')
    for side in [-1,1]:
        limb((side*.12,-.55,.84),(side*.16,-.49,1.08),.08,.008,'head','bark')
        ellipsoid((side*.148,-.685,.81),(.019,.026,.019),'head','ember',1)
        for i in range(3):limb((side*.075,-.77-i*.052,.72),(side*.075,-.77-i*.052,.65),.018,.002,'jaw','bone')
    for name,parent,a,b,r,mass in HOUND:
        if name.startswith('upper') or name.startswith('lower'):limb(a,b,r*1.2,r*.7,name,'bark')
    limb((0,.40,.68),(0,.97,.91),.085,.009,'tail','bark')
    for i in range(8):limb((0,-.32+i*.095,.9),(0,-.28+i*.095,1.02),.045,.002,'chest' if i<4 else 'hips','bone')

def hound_pose(kind,time,duration,weapon):
    phase=time/duration;cycle=phase*TAU;moving=kind in ['walk','run'];poses={}
    for name,parent,head,tail,*_ in HOUND:poses[name]=(v(head),v(tail))
    bob=(-.09 if kind=='run' else -.045)-.018*math.cos(cycle*2) if moving else .012*math.sin(cycle)
    for name in ['hips','chest','head','jaw','tail']:
        a,b=poses[name];poses[name]=(a+v((0,0,bob)),b+v((0,0,bob)))
    if kind=='idle':
        a,b=poses['head'];b.x+=.06*math.sin(cycle);poses['head']=(a,b)
    if kind=='sword':
        amount=math.sin(math.pi*phase);a,b=poses['head'];poses['head']=(a+v((0,-.16*amount,0)),b+v((0,-.24*amount,.06*amount)))
        a,b=poses['jaw'];poses['jaw']=(a+v((0,-.23*amount,0)),b+v((0,-.24*amount,-.15*amount)))
    a,b=poses['tail'];poses['tail']=(a,b+v((.15*math.sin(cycle),0,0)))
    for index,(suffix,x,y) in enumerate([('FL',-.20,-.32),('FR',.20,-.32),('BL',-.20,.37),('BR',.20,.37)]):
        f=((cycle+(0 if index in [0,3] else math.pi))%TAU)/TAU;stride=.34 if kind=='run' else .26
        travel=(-stride*(1-4*f) if f<.5 else stride-4*stride*(f-.5)) if moving else 0
        lift=(.14 if kind=='run' else .09)*math.sin((f-.5)*TAU) if moving and f>=.5 else 0
        foot=v((x,y-.03+travel,.08+max(0,lift)))
        hip=v((x,y,.65+bob));bend=elbow(hip,foot,math.hypot(.09,.30),math.hypot(.12,.27),(0,1,0));poses['upper'+suffix]=(hip,bend);poses['lower'+suffix]=(bend,foot)
    return poses

def export(name,definitions,mesh_builder,pose_builder,clips):
    global objects
    objects=[];rig=make_rig(name,definitions);mesh_builder();bones=list(rig.data.bones);indices={b.name:i for i,b in enumerate(bones)}
    # Native geometry keeps source vertices in bind space and four skin weights.
    chunks=[]
    for mat in sorted({o.data.materials[0].name for o in objects}):
        chunk=dict(material=mat,positions=[],normals=[],uvs=[],indices=[],joints=[],weights=[])
        for obj in objects:
            if obj.data.materials[0].name!=mat:continue
            mesh=obj.data;mesh.calc_loop_triangles();nm=obj.matrix_world.to_3x3().inverted().transposed()
            uv_layer=mesh.uv_layers.active or mesh.uv_layers.new(name='Surface detail')
            for triangle in mesh.loop_triangles:
                face=C.to_3x3()@(nm@triangle.normal)
                for vi,li in zip(triangle.vertices,triangle.loops):
                    vert=mesh.vertices[vi];p=C@(obj.matrix_world@vert.co);n=C.to_3x3()@(nm@(triangle.normal if mat=='cloak' else vert.normal)).normalized()
                    chunk['indices'].append(len(chunk['positions'])//3);chunk['positions'].extend(p);chunk['normals'].extend(n)
                    if mat=='cloak':uv=(vi%13/12,(vi//13)/16)
                    elif abs(face.y)>.65:uv=(p.x*2,p.z*2)
                    elif abs(face.x)>abs(face.z):uv=(p.z*2,p.y*2)
                    else:uv=(p.x*2,p.y*2)
                    chunk['uvs'].extend(uv)
                    uv_layer.data[li].uv=(uv[0],1-uv[1])
                    groups=sorted([(indices[obj.vertex_groups[g.group].name],g.weight) for g in vert.groups if g.weight>0],key=lambda a:-a[1])[:4]
                    total=sum(g[1] for g in groups);assert total>0
                    chunk['joints'].extend([g[0] for g in groups]+[0]*(4-len(groups)));chunk['weights'].extend([g[1]/total for g in groups]+[0]*(4-len(groups)))
        chunks.append(chunk)
    GEOMETRY[name]=chunks
    rests=[C@b.matrix_local for b in bones]
    info={'bones':[],'clips':{}}
    for index,b in enumerate(bones):
        local=(rests[indices[b.parent.name]].inverted()@rests[index]) if b.parent else rests[index]
        p,q,s=local.decompose();definition=next(d for d in definitions if d[0]==b.name)
        info['bones'].append(dict(name=b.name,parent=indices[b.parent.name] if b.parent else -1,position=list(p),rotation=[q.x,q.y,q.z,q.w],scale=list(s),
          inverseBind=[rests[index].inverted()[r][c] for c in range(4) for r in range(4)],length=b.length,radius=definition[4],mass=definition[5]))
    for obj in objects:
        mod=obj.modifiers.new('Meep export skin','ARMATURE');mod.object=rig;obj.parent=rig
    for clip_name,kind,duration,weapon in clips:
        action=bpy.data.actions.new(clip_name);action.use_fake_user=True;rig.animation_data.action=action
        count=max(2,round(duration*30));times=[i*duration/count for i in range(count+1)]
        tracks=[dict(position=[],rotation=[],scale=[]) for b in bones];last_q=[None]*len(bones)
        for frame,time in enumerate(times):
            poses=pose_builder(kind,time,duration,weapon)
            # Write parents first; Blender resolves pose matrices into editable local keys.
            for b in bones:
                head,tail=poses[b.name];rest_dir=b.tail_local-b.head_local;direction=tail-head
                orientation=rest_dir.rotation_difference(direction)@b.matrix_local.to_quaternion()
                pb=rig.pose.bones[b.name];pb.matrix=Matrix.Translation(head)@orientation.to_matrix().to_4x4()
                bpy.context.view_layer.update()
                pb.keyframe_insert(data_path='location',frame=frame+1);pb.keyframe_insert(data_path='rotation_quaternion',frame=frame+1);pb.keyframe_insert(data_path='scale',frame=frame+1)
            for i,b in enumerate(bones):
                pb=rig.pose.bones[b.name];world=C@pb.matrix;local=(C@rig.pose.bones[b.parent.name].matrix).inverted()@world if b.parent else world
                p,q,s=local.decompose()
                if last_q[i] is not None and q.dot(last_q[i])<0:q.negate()
                last_q[i]=q.copy();tracks[i]['position'].extend(round(x,6) for x in p);tracks[i]['rotation'].extend(round(x,6) for x in [q.x,q.y,q.z,q.w]);tracks[i]['scale'].extend(round(x,6) for x in s)
        info['clips'][clip_name]={'duration':duration,'times':times,'tracks':tracks}
    rig.animation_data.action=None
    for pb in rig.pose.bones:pb.matrix_basis=Matrix.Identity(4)
    RIGS[name]=info
    collection=bpy.data.collections.new(name+' source');bpy.context.scene.collection.children.link(collection)
    for obj in [rig]+objects:
        for existing in list(obj.users_collection):existing.objects.unlink(obj)
        collection.objects.link(obj)
    collection.hide_render=True;collection.hide_viewport=True

clips=[]
for weapon in ['sword','spear','bow','staff']:
    for kind,duration in [('idle',3.2),('walk',.88),('run',.64),('crouch',3.2),('crouch_walk',1.1)]:clips.append((weapon+'_'+kind,kind,duration,weapon))
    for kind,duration in [('walk',.88),('run',.64),('crouch_walk',1.1)]:
        for direction in ['forward_right','right','back_right','back','back_left','left','forward_left']:
            name=kind+'_'+direction;clips.append((weapon+'_'+name,name,duration,weapon))
for kind,duration in [('sword',.72),('spear',.85),('bow',.8),('staff',.65),('nova',1),('jump',.6),('hang',1.6),('mantle',.52),('hurt',.3),('land',.22)]:clips.append((kind,kind,duration,kind if kind in ['sword','spear','bow','staff'] else 'sword'))
for name,windup,recovery in [('bell_slam',1.2,1.45),('root_call',1.05,1.4),('cinder_volley',.95,1.1),('mirror_prayer',1.1,1.3),('winter_sweep',1.15,1.5),('king_judgment',1.45,1.7)]:clips.append((name,name,windup+recovery,'spear'))
export('pilgrim',HUMAN,human_mesh,human_pose,clips)
for variant in ['wayfarer','keeper','sentinel','winter']:
    export('armor_'+variant,HUMAN,lambda variant=variant:human_mesh(variant),human_pose,[])
    # These skins share the pilgrim's joint order, bind pose and complete Actions.
    # Retain their editable armatures in the blend, without duplicate runtime rigs.
    del RIGS['armor_'+variant]
from bosses import build_boss
for keeper in ['warden','rootbound','cantor','mirror','frostbound','last-king']:
    export('boss_'+keeper,HUMAN,lambda keeper=keeper:build_boss(keeper,human_mesh,ellipsoid,plate,limb,bind),human_pose,[])
    del RIGS['boss_'+keeper]
export('briarHound',HOUND,hound_mesh,hound_pose,[(kind,kind,duration,'sword') for kind,duration in [('idle',3.4),('walk',.9),('run',.55),('sword',.72),('hurt',.3),('jump',.6)]])
from banner import build_banner
build_banner(export,MATERIALS,lambda:objects)
(OUT/'characters.json').write_text(json.dumps(GEOMETRY,separators=(',',':')))
(ROOT/'packages/game/src/content/rigs.json').write_text(json.dumps(RIGS,separators=(',',':')))
bpy.context.scene.render.fps=30
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/old-circle-characters.blend'))
print('Exported',len(RIGS),'Blender skins and',sum(len(r['clips']) for r in RIGS.values()),'animation clips')
