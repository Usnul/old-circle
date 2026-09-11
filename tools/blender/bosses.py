"""Six keeper silhouettes, bound to the editable human armature."""
import bpy, math

def build_boss(name,human,ellipsoid,plate,limb,bind):
    def ring(center,radius,bone,material='brass',tilt=math.pi/2,thickness=.024):
        bpy.ops.mesh.primitive_torus_add(major_radius=radius,minor_radius=thickness,major_segments=40,minor_segments=8,location=center,rotation=(tilt,0,0))
        bind(bpy.context.object,bone,material)
    if name=='rootbound':
        # A hollow wooden body, split roots, a veiled face and a thorn canopy.
        ellipsoid((0,0,1.17),(.25,.17,.33),'spine','bark')
        ellipsoid((0,0,1.4),(.31,.18,.19),'chest','bark')
        ellipsoid((0,0,1.67),(.12,.10,.20),'head','bone')
        for side,suffix in [(-1,'L'),(1,'R')]:
            limb((side*.14,0,.96),(side*.14,-.02,.52),.12,.065,'thigh'+suffix,'bark')
            limb((side*.14,-.02,.52),(side*.14,0,.10),.07,.07,'calf'+suffix,'bark')
            for toe in range(3):limb((side*.14,0,.12),(side*.14+(toe-1)*.055,-.25,.055),.036,.004,'foot'+suffix,'bark')
            limb((side*.29,0,1.43),(side*.46,0,1.15),.105,.065,'upperArm'+suffix,'bark')
            limb((side*.46,0,1.15),(side*.50,-.03,.90),.075,.05,'forearm'+suffix,'bark')
            for finger in range(4):limb((side*.5+(finger-1.5)*.026,-.06,.90),(side*.5+(finger-1.5)*.04,-.16,.76),.019,.003,'hand'+suffix,'bark')
            for i in range(5):
                x=side*(.07+i*.09);z=1.72-i*.025
                limb((x,.07,z),(x+side*.14,.12,z+.37-i*.02),.045,.006,'head' if i<2 else 'chest','bark')
                limb((x+side*.06,.09,z+.17),(x+side*.18,.04,z+.24),.023,.002,'head' if i<2 else 'chest','bark')
            ellipsoid((side*.045,-.105,1.69),(.018,.014,.021),'head','ember',1)
        for i in range(7):limb(((i-3)*.035,-.12,1.76),((i-3)*.035,-.13,1.53),.009,.004,'head','bark')
        return
    human({'warden':'sentinel','cantor':'keeper','mirror':'keeper','frostbound':'winter','last-king':'sentinel'}[name])
    if name=='warden':
        # Bell-shaped bronze pauldrons, a tongueless bell cage behind the head.
        for side,suffix in [(-1,'L'),(1,'R')]:
            limb((side*.33,0,1.37),(side*.33,0,1.64),.20,.07,'upperArm'+suffix,'brass')
            ring((side*.33,0,1.37),.20,'upperArm'+suffix,tilt=0)
        for z,r in [(1.52,.22),(1.84,.12)]:ring((0,.18,z),r,'chest',tilt=0)
        for i in range(8):
            a=i*math.tau/8;limb((math.cos(a)*.22,.18+math.sin(a)*.22,1.52),(math.cos(a)*.12,.18+math.sin(a)*.12,1.84),.014,.014,'chest','brass')
        plate((0,-.148,1.69),(.25,.025,.23),'head','brass',.04)
        plate((0,-.167,1.70),(.13,.012,.016),'head','cloth',.003)
    elif name=='cantor':
        # Burned red vestments, a narrow mitre and a glowing hanging censer.
        limb((0,0,1.76),(0,.035,2.07),.12,.009,'head','brass')
        for side in [-1,1]:
            for i in range(4):plate((side*(.27+i*.025),.02,1.5+i*.07),(.035,.22,.19),'chest','brass',.005)
        for i in range(8):ring((-.46,-.08,1.02-i*.037),.019,'handL',tilt=0 if i%2 else math.pi/2,thickness=.006)
        ellipsoid((-.46,-.08,.70),(.12,.12,.15),'handL','iron')
        ring((-.46,-.08,.73),.13,'handL',tilt=0)
        for i in range(6):a=i*math.tau/6;ellipsoid((-.46+math.cos(a)*.12,-.08+math.sin(a)*.12,.72),(.025,.025,.04),'handL','ember',1)
    elif name=='mirror':
        # An open astrolabe behind a polished mask, with suspended glass shards.
        ring((0,.20,1.79),.35,'chest','brass');ring((0,.23,1.79),.29,'chest','iron',thickness=.014)
        plate((0,-.155,1.67),(.18,.035,.27),'head','bone',.055)
        for i in range(9):
            a=i*math.tau/9;x=math.cos(a)*.42;z=1.79+math.sin(a)*.42
            limb((x,.20,z-.07),(x,.20,z+.07),.032,.001,'chest','bone')
        for side in [-1,1]:plate((side*.22,-.15,.90),(.045,.035,.7),'hips','bone',.01)
    elif name=='frostbound':
        # An ice-broken fur mantle and a split antler crown.
        for side in [-1,1]:
            limb((side*.08,.035,1.79),(side*.25,.08,2.08),.055,.008,'head','bone')
            for i in range(3):
                limb((side*(.13+i*.04),.06,1.86+i*.06),(side*(.29+i*.045),.025,1.9+i*.09),.025,.001,'head','bone')
                limb((side*(.24+i*.08),.08,1.45),(side*(.28+i*.09),.12,1.75-i*.05),.055,.002,'chest','bone')
        plate((0,-.155,1.69),(.22,.018,.027),'head','ember',.005)
    else:
        # A broken sun on the back, a jagged crown and a broad ceremonial mantle.
        for i in range(24):
            if i in [2,3,12,13]:continue
            a=i*math.tau/24;b=a+math.tau/24
            limb((math.cos(a)*.49,.22,1.45+math.sin(a)*.49),(math.cos(b)*.49,.22,1.45+math.sin(b)*.49),.025,.025,'chest','brass')
        for i in range(7):
            x=(i-3)*.043;limb((x,0,1.79),(x*1.3,.025,1.99+(.06 if i%2 else 0)),.023,.001,'head','brass')
        for side,suffix in [(-1,'L'),(1,'R')]:plate((side*.33,0,1.48),(.31,.40,.095),'upperArm'+suffix,'brass',.026)
        plate((0,-.18,1.28),(.30,.025,.32),'chest','brass',.03)
