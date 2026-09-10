"""Masonry at metre scale, with explicit collision pieces and usable openings."""
import math,random
from mathutils import Vector,noise

def build_architecture(cube,cone,beam,ico,mesh,finish,_current):
    random.seed(813)
    base=cube((0,0,-.16),(30,30,.30),'stoneDark',.03)
    for y in range(15):
        for x in range(15):
            cube((-14+x*2,-14+y*2,.018+random.uniform(-.006,.006)),(1.985,1.985,.09),'stoneDark' if (x+y)%5==0 else 'stone',.016)
    finish('abbeyFloor',[base])

    # A low cloister wall: ruin height varies, with a continuous sheltered interior.
    physical=[]
    for row in range(4):
        for i in range(4):
            physical.append(cube((-1.875+i*1.25,0,.29+row*.59),(1.23,.72,.57),'stone',.026))
    for side in [-1,1]:
        for j in range(3):physical.append(cube((side*2.14,0,2.7+j*.65),(.70,.85,.63),'stoneLight',.028))
    cube((0,0,2.44),(5.15,.86,.18),'stoneLight',.025)
    finish('abbeyWall',physical)

    physical=[]
    for p,s in [((0,0,.18),(1.4,2.8,.36)),((0,.15,1.45),(1.04,2.1,2.5)),((0,.48,3.35),(.78,1.35,1.6)),((0,.7,4.85),(.6,.7,1.4))]:
        physical.append(cube(p,s,'stoneDark',.045))
    finish('buttress',physical)

    # The tower is open through its base and its belfry; no convex hull spans a door.
    physical=[]
    for x in [-2.5,2.5]:
        for y in [-2.5,2.5]:
            for level in range(15):
                physical.append(cube((x,y,.72+level*1.36),(1.05,1.05,1.32),'stoneLight' if level%5==0 else 'stone',.04))
            physical.append(cube((x,y,.3),(1.55,1.55,.6),'stoneDark',.04))
            cone((x,y,22),.72,.06,3.8,'stoneDark',4)
    for axis in [0,1]:
        for side in [-1,1]:
            for z in [4.6,8.7,12.8,20.5]:
                p=(0,side*2.5,z) if axis==0 else (side*2.5,0,z)
                s=(5.8,1.18,.4) if axis==0 else (1.18,5.8,.4)
                physical.append(cube(p,s,'stoneLight',.04))
            for level in range(9):
                z=5.25+level*.78
                # Narrow lancet openings through the middle storey.
                for sign in [-1,1]:
                    p=(sign*1.5,side*2.5,z) if axis==0 else (side*2.5,sign*1.5,z)
                    s=(1.0,.82,.75) if axis==0 else (.82,1.0,.75)
                    physical.append(cube(p,s,'stone',.025))
            for sign in [-1,1]:
                a=(sign*1.02,side*2.5,11.2) if axis==0 else (side*2.5,sign*1.02,11.2)
                b=(0,side*2.5,12.6) if axis==0 else (side*2.5,0,12.6)
                beam(a,b,.19,'stoneLight',.19,5)
    # Hanging bronze bell and its timber cross-beam have a clear mechanical purpose.
    beam((-2.4,0,18.8),(2.4,0,18.8),.22,'bark',.22,8)
    beam((0,0,18.8),(0,0,17.8),.07,'iron',.07)
    for z,low,high,h in [(15.6,1.45,1.15,.35),(16.15,1.15,.72,.8),(16.85,.72,.38,.6),(17.25,.38,.28,.22)]:cone((0,0,z),low,high,h,'brass',32)
    beam((0,0,16.5),(0,0,15.2),.06,'iron',.07)
    ico((0,0,15.13),(.16,.16,.20),'iron',2)
    cone((0,0,23.1),3.65,.1,4.8,'stoneDark',4)
    beam((0,0,25.4),(0,0,27.8),.085,'brass',.025)
    finish('bellTower',physical)

    # Votive banner stand. Its cloth has an independent Blender skin and actions.
    physical=[cube((0,0,.12),(.52,.52,.3),'stoneDark',.06),beam((0,0,.1),(0,0,3.8),.06,'iron',.04)]
    beam((0,0,3.5),(1.8,0,3.5),.045,'brass',.028)
    beam((0,0,2.85),(.65,0,3.5),.025,'iron',.025)
    for x in [.18,1.62]:beam((x,0,3.5),(x,0,3.4),.014,'brass',.014)
    ico((0,0,3.9),(.09,.07,.15),'brass',2)
    finish('bannerStand',physical)

    # Metre-scale ridges share saddles and broad foothills. A height grid gives
    # every summit real area; collapsed radial rings created vertical fins.
    ridges=[
      ('mountain',[(-23,4,76,58,48),(17,-8,89,55,46),(46,8,48,42,37)]),
      ('mountainRidge',[(-38,5,53,44,42),(-4,-9,72,62,51),(38,1,65,48,40)]),
      ('mountainShoulder',[(-29,-8,64,54,45),(8,8,52,59,48),(43,-5,38,40,38)]),
    ]
    for variant,(name,peaks) in enumerate(ridges):
        vertices=[];faces=[];nx=64;ny=48
        for j in range(ny+1):
            y=-65+j*130/ny
            for i in range(nx+1):
                x=-88+i*176/nx
                h=max(height*max(0,1-math.hypot((x-cx)/rx,(y-cy)/ry))**1.12 for cx,cy,height,rx,ry in peaks)
                erosion=noise.fractal(Vector((x*.075,y*.075,variant*11.7)),.8,2,4)
                foothill=min(1,h/12)
                # The ridge continues below the world's edge. A flat base at
                # mountain altitude exposed a floating underside from the east.
                skirt=90*max(0,1-h/20)**2
                z=h+foothill*(erosion*3.4+math.sin(h*.55+x*.09)*.7)-skirt
                vertices.append((x,y,z))
        for j in range(ny):
            for i in range(nx):
                a=j*(nx+1)+i;b=a+1;c=a+nx+1;d=c+1
                faces.extend([(a,b,c),(b,d,c)])
        mesh(name+' eroded strata',vertices,faces,'stoneDark')
        finish(name)
