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
from garments import build_garments
build_equipment_materials(ROOT)
OUT=ROOT/'.local/blender';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
TAU=math.tau
MATERIALS={}
for name,color in {'iron':(.20,.23,.24),'brass':(.48,.31,.12),'cloth':(.065,.095,.10),'cloak':(1,1,1),'leather':(.12,.07,.035),'bone':(.63,.60,.48),'bark':(.14,.12,.085),'ember':(1,.37,.06),'skin':(.34,.22,.15),'lining':(.018,.022,.02)}.items():
    mat=bpy.data.materials.new(name);mat.diffuse_color=(*color,1);MATERIALS[name]=mat
    if name in ['skin','lining']:
        mat.use_nodes=True;shader=mat.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(*color,1);shader.inputs['Roughness'].default_value=.92
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
def keypose(keys,t,flow=False):
    def tangent(index,axis):
        if index==0 or index==len(keys)-1:return 0
        before,at,after=keys[index-1:index+2];h0=at[0]-before[0];h1=after[0]-at[0]
        d0=(at[1][axis]-before[1][axis])/h0;d1=(after[1][axis]-at[1][axis])/h1
        if d0*d1<=0:return 0
        w0=2*h1+h0;w1=h1+2*h0
        return (w0+w1)/(w0/d0+w1/d1)
    for i,((ta,a),(tb,b)) in enumerate(zip(keys,keys[1:])):
        if t<=tb:
            u=max(0,min(1,(t-ta)/(tb-ta)))
            if not flow:return mix(a,b,smooth(u))
            # Monotone cubic tangents carry velocity through intermediate keys,
            # with no overshoot or artificial stop at each point of the cut.
            return v([(2*u**3-3*u*u+1)*a[j]+(u**3-2*u*u+u)*(tb-ta)*tangent(i,j)+(-2*u**3+3*u*u)*b[j]+(u**3-u*u)*(tb-ta)*tangent(i+1,j) for j in range(3)])
    return v(keys[-1][1])

def elbow(a,b,l1,l2,pole):
    d=b-a;length=min(l1+l2-.005,max(.001,d.length));axis=d.normalized()
    mid=(l1*l1-l2*l2+length*length)/(2*length)
    side=v(pole)-axis*v(pole).dot(axis)
    if side.length<.001:side=v((0,-1,0))
    return a+axis*mid+side.normalized()*math.sqrt(max(0,l1*l1-mid*mid))

def rotation(pitch=0,yaw=0,roll=0):
    return (Matrix.Rotation(yaw,3,'Z')@Matrix.Rotation(pitch,3,'X')@Matrix.Rotation(roll,3,'Y'))

def limb_frame(direction,normal):
    # A direction alone loses bone roll. Keep the bend plane as well so elbows
    # and wrists transport their orientation continuously through a swing.
    y=direction.normalized();x=(normal-y*normal.dot(y)).normalized();z=x.cross(y)
    return Matrix((x,y,z)).transposed()

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
    heavy=variant=='sentinel'
    build_garments(variant,bind,ellipsoid,plate,limb)
    plate((0,-.20,1.33),(.026,.022,.24),'chest','brass',.008)
    for side in [-1,1]:
        for j in range(3):ellipsoid((side*(.07+j*.045),-.179,1.40),(.011,.01,.011),'chest','brass',1)
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
        for j in range(7):ellipsoid(((j-3)*.047,-.208,1.23-abs(j-3)*.017),(.018,.014,.022),'chest','brass',1)
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
    bob=(.004 if not walk else -.035 if not run else -.065)*math.cos(cycle*2 if walk else cycle)
    root=v((-.028*math.sin(cycle) if walk else .006*math.sin(cycle),0,(.82 if run else .90 if walk else .94)+bob-(.31 if crouch else 0)))
    lean=(.22 if run else .075)*-direction[1] if walk else .025
    if crouch:lean+=.20
    # Weight settles over the support leg. Pelvis and ribcage counter-rotate;
    # the head follows with a smaller, delayed nod rather than a rigid column.
    lean+=(.035 if run else .018)*math.sin(cycle*2-.5) if walk else 0
    roll=-(.10 if run else .045)*direction[0]+.025*math.sin(cycle) if walk else 0
    hip_yaw=.085*math.sin(cycle) if walk else 0
    chest_yaw=-.12*math.sin(cycle-.25) if walk else .015*math.sin(cycle)
    offset=v((0,0,0));drive=0
    if kind=='hurt':root.y+=.10*math.sin(math.pi*phase);lean=-.22*math.sin(math.pi*phase)
    if kind=='land':root.z-=.22*math.sin(math.pi*phase)
    if kind=='jump':lean=.12*math.sin(math.pi*phase);root.z-=.05*math.sin(math.pi*phase)
    if kind=='mantle':root.y-=.14*math.sin(math.pi*phase);root.z-=.25*(1-smooth(phase))
    if kind=='sword':
        # Load the back leg, lead with the pelvis, then let the chest and blade
        # catch up. The low follow-through decelerates before returning to guard.
        hip_yaw=keypose([(0,(0,0,0)),(.13,(0,0,.22)),(.30,(0,0,-.28)),(.47,(0,0,-.22)),(.72,(0,0,0))],time,flow=True).z
        chest_yaw=keypose([(0,(0,0,0)),(.17,(0,0,.48)),(.39,(0,0,-.64)),(.49,(0,0,-.55)),(.72,(0,0,0))],time,flow=True).z
        offset=keypose([(0,(0,0,0)),(.14,(.035,.045,-.035)),(.33,(-.035,-.13,-.075)),(.48,(-.025,-.12,-.055)),(.72,(0,0,0))],time,flow=True)
        lean+=keypose([(0,(0,0,0)),(.14,(-.07,0,0)),(.34,(.20,0,0)),(.49,(.14,0,0)),(.72,(0,0,0))],time,flow=True).x
        drive=smooth((time-.08)/.17)*(1-smooth((time-.49)/.23))
    elif kind=='spear':
        drive=smooth((time-.18)/.18)*(1-smooth((time-.50)/.35))
        load=math.sin(math.pi*min(1,time/.25)) if time<.25 else 0
        offset=v((-.015*drive,.05*load-.17*drive,-.035*load-.075*drive));lean+=.19*drive-.06*load
        hip_yaw=.14*load-.15*drive;chest_yaw=.22*load-.26*drive
    elif kind=='bow':
        draw=smooth(time/.36)*(1-smooth((time-.50)/.30))
        hip_yaw=.09*draw;chest_yaw=.26*draw;lean-=.07*draw;offset.z=-.025*draw
    elif kind in ['staff','nova']:
        cast=math.sin(math.pi*phase)**2;lean+=.12*cast;offset=v((0,-.07*cast,-.055*cast));chest_yaw=-.16*cast
    root+=offset
    ritual={'bell_slam':1.2,'root_call':1.05,'cinder_volley':.95,'mirror_prayer':1.1,'winter_sweep':1.15,'king_judgment':1.45}.get(kind)
    if ritual:
        impact=max(0,1-abs(time-ritual-.12)/.4)
        if kind in ['bell_slam','root_call','king_judgment']:root.z-=.15*impact;lean+=.17*impact
        if kind=='winter_sweep':chest_yaw=.5*math.sin(math.pi*time/duration)
    pelvis=rotation(lean*.25,hip_yaw,roll*.65)
    lumbar=rotation(lean*.70,hip_yaw*.4+chest_yaw*.6,roll)
    thorax=rotation(lean,chest_yaw,roll*.75)
    gaze=rotation(lean*.35+(.025*math.sin(cycle*2-.6) if walk else 0),chest_yaw*.35,roll*.25)
    spine=root+pelvis@v((0,0,.18));chest=spine+lumbar@v((0,0,.22));neck=chest+thorax@v((0,0,.17));head=neck+gaze@v((0,-.015,.28))
    def body(p):return chest+thorax@(v(p)-v((0,0,.4)))
    poses={'hips':(root,spine),'spine':(spine,chest),'chest':(chest,neck),'head':(neck,head)}
    # Export these complete frames, including axial twist, not just head/tail.
    frames={'hips':pelvis,'spine':lumbar,'chest':thorax,'head':gaze}
    for suffix,side,shift in [('L',-1,0),('R',1,math.pi)]:
        ph=(cycle+shift)%TAU;stride=.28 if not run else .46
        # Contact, down, passing and up: the support foot travels backwards
        # linearly during stance, then clears the ground during its return.
        f=ph/TAU;fy=(-stride*(1-4*f) if f<.5 else stride-4*stride*(f-.5)) if walk else -.025
        lift=(.13 if not run else .23)*math.sin((f-.5)*TAU) if walk and f>=.5 else 0
        hip=root+pelvis@v((side*.14,0,0));foot=v((side*.14-direction[0]*fy,-direction[1]*fy,.1+max(0,lift)))
        # Side steps use separate fore/aft lanes to clear the passing foot.
        if walk:foot.y+=side*.075*abs(direction[0])
        if crouch:foot.y-=.08
        if kind in ['sword','spear']:
            if suffix=='L':
                foot+=v((-.045*drive,-(.24 if kind=='spear' else .20)*drive,0))
                step_start,step_end=(.18,.36) if kind=='spear' else (.08,.25)
                lift=.045*math.sin(math.pi*max(0,min(1,(time-step_start)/(step_end-step_start)))) if time<step_end else .025*math.sin(math.pi*max(0,min(1,(time-(duration-.23))/.23)))
                foot.z+=lift
            else:foot.z+=.035*drive
        if kind in ['jump','hang','mantle']:
            foot=body((side*.18,-.1 if suffix=='L' else .05,-.63 if kind=='hang' else -.69))
            if kind=='jump':
                tuck=math.sin(math.pi*phase)**2;foot=body((side*.17,-.06-(.19 if suffix=='L' else .10)*tuck,-.83+.22*tuck))
            if kind=='mantle' and suffix=='L':foot=body((side*.18,-.38,-.26))
        knee=elbow(hip,foot,.43,.41,(0,-1,.1));toe=foot+v((0,-.21,.015 if lift>.01 else -.03))
        if kind in ['sword','spear'] and suffix=='R':toe.z-=.035*drive
        poses['thigh'+suffix]=(hip,knee);poses['calf'+suffix]=(knee,foot);poses['foot'+suffix]=(foot,toe)
    shoulderR=body((.29,0,.49));shoulderL=body((-.29,0,.49))
    swing=(.16 if run else .14)*math.sin(cycle-.15) if walk else .012*math.sin(cycle)
    # The running free arm stays bent in front of the ribs. Letting the wrist
    # cross behind the shoulder made the elbow swivel on every fast stride.
    right=body((.34,-.23-swing*.28,.25+.018*math.sin(cycle-.35)));left=body((-.36,(-.20 if run else -.10)+swing,.20 if run else .08))
    direction=v((.18+.025*math.sin(cycle-.4),-.50,.85)).normalized()
    if weapon=='spear':right=body((.34,-.18,.14));left=body((-.15,-.49,.20));direction=v((0,-.9,.44)).normalized()
    if weapon=='staff':right=body((.38,-.17,.13));direction=v((.08,-.12,1)).normalized()
    if weapon=='bow':right=body((.33,-.21,.22));left=body((-.25,-.22,.26));direction=v((0,0,1))
    if kind=='sword':
        right=body(keypose([(0,(.34,-.23,.25)),(.09,(.59,-.16,.49)),(.16,(.50,.04,.73)),(.23,(.49,-.25,.57)),(.32,(.17,-.43,.40)),(.43,(-.12,-.42,.26)),(.51,(-.10,-.26,.22)),(.72,(.34,-.23,.25))],time,flow=True))
        direction=keypose([(0,(.18,-.50,.85)),(.18,(.55,.10,.83)),(.27,(.68,-.70,.22)),(.36,(-.18,-.97,-.08)),(.45,(-.82,-.55,-.17)),(.56,(-.60,-.30,.74)),(.72,(.18,-.50,.85))],time,flow=True).normalized()
        left=body(keypose([(0,(-.36,-.10,.08)),(.16,(-.31,-.24,.26)),(.37,(-.42,.05,.22)),(.51,(-.38,-.03,.16)),(.72,(-.36,-.10,.08))],time,flow=True))
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
    direction=(thorax@direction).normalized()
    definitions={d[0]:d for d in HUMAN}
    for suffix,side,shoulder,hand in [('R',1,shoulderR,right),('L',-1,shoulderL,left)]:
        reach=hand-shoulder
        # Keep both hinge limits away from singular poses: a locked arm and a
        # wrist pulled into the shoulder each cause an abrupt elbow swivel.
        hand=shoulder+reach.normalized()*max(.20,min(.577,reach.length))
        if suffix=='R':right=hand
        bend=elbow(shoulder,hand,.327,.255,thorax@v((side*.55,.25,-1)))
        poses['upperArm'+suffix]=(shoulder,bend);poses['forearm'+suffix]=(bend,hand)
        upper=definitions['upperArm'+suffix];forearm=definitions['forearm'+suffix];fist=definitions['hand'+suffix]
        rest_upper=v(upper[3])-v(upper[2]);rest_fore=v(forearm[3])-v(forearm[2]);rest_normal=rest_upper.cross(rest_fore).normalized()
        normal=(bend-shoulder).cross(hand-bend).normalized()
        frames['upperArm'+suffix]=limb_frame(bend-shoulder,normal)@limb_frame(rest_upper,rest_normal).transposed()
        frames['forearm'+suffix]=limb_frame(hand-bend,normal)@limb_frame(rest_fore,rest_normal).transposed()
        # The fist follows the forearm; the grip socket can aim the blade without
        # making the wrist point along it (which used to fold the hand backwards).
        frames['hand'+suffix]=frames['forearm'+suffix]
        poses['hand'+suffix]=(hand,hand+frames['hand'+suffix]@(v(fist[3])-v(fist[2])))
    # The handle passes through the glove's palm, rather than the wrist joint.
    grip=right+frames['handR']@v((0,-.038,-.021))
    poses['weapon']=(grip,grip+direction*.2)
    for name,frame in frames.items():poses[name]=(*poses[name],frame)
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
    reference_q=[None]*len(bones)
    for clip_name,kind,duration,weapon in clips:
        action=bpy.data.actions.new(clip_name);action.use_fake_user=True;rig.animation_data.action=action
        count=max(2,round(duration*(60 if name=='pilgrim' and kind in ['sword','spear'] else 30)));times=[i*duration/count for i in range(count+1)]
        tracks=[dict(position=[],rotation=[],scale=[]) for b in bones];last_q=[None]*len(bones);last_basis=[None]*len(bones)
        for time in times:
            poses=pose_builder(kind,time,duration,weapon)
            # Write parents first; Blender resolves pose matrices into editable local keys.
            for b in bones:
                if b.name.startswith('cloak'):
                    # Follow the animated chest in bind-local pose. Runtime
                    # ClothRig owns these joints, so Actions do not key them.
                    rig.pose.bones[b.name].matrix_basis=Matrix.Identity(4)
                    bpy.context.view_layer.update()
                    continue
                head,tail,*basis=poses[b.name];rest_dir=b.tail_local-b.head_local;direction=tail-head
                orientation=(basis[0].to_quaternion() if basis else rest_dir.rotation_difference(direction))@b.matrix_local.to_quaternion()
                pb=rig.pose.bones[b.name];pb.matrix=Matrix.Translation(head)@orientation.to_matrix().to_4x4()
                bpy.context.view_layer.update()
                index=indices[b.name]
                if last_basis[index] is not None and pb.rotation_quaternion.dot(last_basis[index])<0:pb.rotation_quaternion.negate()
                last_basis[index]=pb.rotation_quaternion.copy()
                # Dense strike samples use subframes on the same 30 fps source
                # timeline, so the editable Action keeps the runtime duration.
                pb.keyframe_insert(data_path='location',frame=1+time*30);pb.keyframe_insert(data_path='rotation_quaternion',frame=1+time*30);pb.keyframe_insert(data_path='scale',frame=1+time*30)
            for i,b in enumerate(bones):
                if b.name.startswith('cloak'):
                    # Keep dense CPU tracks for ragdoll sampling, without
                    # exporting procedural cloth motion or floating pose drift.
                    for key in ['position','rotation','scale']:
                        tracks[i][key].extend(round(x,6) for x in info['bones'][i][key])
                    continue
                pb=rig.pose.bones[b.name];world=C@pb.matrix;local=(C@rig.pose.bones[b.parent.name].matrix).inverted()@world if b.parent else world
                p,q,s=local.decompose()
                # Meep blends quaternion components directly. Opposite signs
                # encode the same pose but cancel during a cross-fade, so start
                # every Action in a shared per-joint hemisphere, then retain
                # continuity within that Action.
                reference=last_q[i] if last_q[i] is not None else reference_q[i]
                if reference is not None and q.dot(reference)<0:q.negate()
                if reference_q[i] is None:reference_q[i]=q.copy()
                last_q[i]=q.copy();tracks[i]['position'].extend(round(x,6) for x in p);tracks[i]['rotation'].extend(round(x,6) for x in [q.x,q.y,q.z,q.w]);tracks[i]['scale'].extend(round(x,6) for x in s)
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:key.interpolation='LINEAR'
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
