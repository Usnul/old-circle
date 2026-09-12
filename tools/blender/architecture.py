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
    physical=[cube((0,0,1.18),(5,.69,2.36),'stoneDark',0)]
    for row in range(4):
        # Alternate half blocks at the ends so the wall has a running bond.
        ends=[-2.5,-1.25,0,1.25,2.5] if row%2==0 else [-2.5,-1.875,-.625,.625,1.875,2.5]
        for a,b in zip(ends,ends[1:]):
            cube(((a+b)/2,0,(row+.5)*.59),(b-a,.72,.59),'stone',.018)
    for side in [-1,1]:
        physical.append(cube((side*2.14,0,3.38),(.67,.82,1.96),'stoneDark',0))
        for j in range(3):physical.append(cube((side*2.14,0,2.685+j*.65),(.70,.85,.65),'stoneLight',.018))
    cube((0,0,2.44),(5.15,.86,.18),'stoneLight',.025)
    finish('abbeyWall',physical)

    physical=[]
    for p,s in [((0,0,.18),(1.4,2.8,.36)),((0,.15,1.45),(1.04,2.1,2.5)),((0,.48,3.35),(.78,1.35,1.6)),((0,.7,4.85),(.6,.7,1.4))]:
        physical.append(cube(p,s,'stoneDark',.045))
    finish('buttress',physical)

    # Four continuous piers carry bonded walls, maintenance floors and a timber
    # bell frame. The ground storey is a ringing porch; ladders serve the belfry.
    physical=[]
    for x in [-2.5,2.5]:
        for y in [-2.5,2.5]:
            physical.append(cube((x,y,10.25),(1.02,1.02,20.5),'stoneDark',0))
            for level in range(15):
                cube((x,y,.34+(level+.5)*1.36),(1.05,1.05,1.36),'stoneLight' if level%5==0 else 'stone',.018)
            physical.append(cube((x,y,.3),(1.55,1.55,.6),'stoneDark',.04))
    for axis in [0,1]:
        for side in [-1,1]:
            for z in [4.6,8.7,12.8,20.5]:
                p=(0,side*2.5,z) if axis==0 else (side*2.5,0,z)
                s=(5.8,1.18,.4) if axis==0 else (1.18,5.8,.4)
                physical.append(cube(p,s,'stoneLight',.018))
            # Solid backing fills the bed joints of the two lancet jambs.
            for sign in [-1,1]:
                p=(sign*1.5,side*2.5,8.635) if axis==0 else (side*2.5,sign*1.5,8.635)
                s=(.98,.79,7.67) if axis==0 else (.79,.98,7.67)
                physical.append(cube(p,s,'stoneDark',0))
            for level in range(10):
                z=5.19+level*.78
                # Narrow lancet openings through the middle storey.
                for sign in [-1,1]:
                    p=(sign*1.5,side*2.5,z) if axis==0 else (side*2.5,sign*1.5,z)
                    s=(1.0,.82,.78) if axis==0 else (.82,1.0,.78)
                    cube(p,s,'stone',.018)
            # Jamb-to-jamb lintel, with its ends bearing on the side masonry.
            p=(0,side*2.5,12.35) if axis==0 else (side*2.5,0,12.35)
            s=(2.4,.9,.5) if axis==0 else (.9,2.4,.5)
            physical.append(cube(p,s,'stoneLight',.018))
    # Floor boards rest on joists carried by the perimeter string courses.
    # The back-left hatch stays open on every landing, with a guarded ladder.
    for z in [4.6,8.7,12.8]:
        for x in [-1.8,0,1.8]:physical.append(cube((x,0,z),( .18,5.0,.24),'timber',.012))
        for j in range(16):
            x=-2.0+(j+.5)*.25
            y0=-2.0;y1=1.05 if x<-1.0 else 2.0
            physical.append(cube((x,(y0+y1)/2,z+.19),(.248,y1-y0,.14),'timber',.01))
        for x,y in [(-.95,1.0),(-.95,1.95),(-1.95,1.0)]:
            cube((x,y,z+.72),(.08,.08,1.2),'timber',.01)
        beam((-.95,1,z+1.3),(-.95,2,z+1.3),.04,'timber',.04)
        beam((-2,1,z+1.3),(-.95,1,z+1.3),.04,'timber',.04)
    for low,high in [(.1,4.86),(4.86,8.96),(8.96,13.06)]:
        for x in [-1.85,-1.15]:
            physical.append(cube((x,1.65,(low+high+.9)/2),(.085,.10,high+.9-low),'timber',.012))
        for i in range(math.ceil((high-low)/.28)+1):
            z=min(high,low+i*.28)
            beam((-1.87,1.59,z),(-1.13,1.59,z),.028,'iron',.028)
    # Braced posts transfer the bell's weight to the corner piers. The yoke's
    # axle is seated on the side beams rather than hanging in empty space.
    for x in [-2.5,2.5]:
        physical.append(cube((x,0,18.8),(.30,5.3,.38),'timber',.018))
        for y in [-2.5,2.5]:
            beam((x,y,17.1),(x,y*.45,18.8),.12,'timber',.12)
    cube((0,0,18.8),(5.0,.36,.42),'timber',.018)
    cube((0,0,18.25),(1.5,.42,.32),'timber',.025)
    for x in [-.5,.5]:
        beam((x,0,18.8),(x,0,17.65),.055,'iron',.055)
        beam((x,0,17.65),(0,0,17.55),.055,'iron',.055)
    # One watertight revolved shell: flared sound bow, curved waist, shoulder,
    # crown and inner cavity. No cone end-caps obscure the mouth or clapper.
    profile=[(1.38,15.35),(1.43,15.40),(1.42,15.48),(1.33,15.56),
             (1.22,15.63),(1.08,15.79),(.95,16.02),(.84,16.30),
             (.75,16.62),(.68,16.96),(.60,17.21),(.48,17.39),
             (.29,17.49),(.12,17.52),(.12,17.36),(.26,17.33),
             (.40,17.24),(.50,17.09),(.58,16.86),(.65,16.56),
             (.74,16.25),(.85,15.96),(.98,15.73),(1.13,15.55),
             (1.25,15.42),(1.27,15.35)]
    n=64;verts=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for r,z in profile for i in range(n)]
    faces=[]
    for j in range(len(profile)):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i))
    bell=mesh('Cast bronze bell — hollow sound bow',verts,faces,'bronze')
    uv=bell.data.uv_layers.new(name='Continuous turned bronze')
    for poly in bell.data.polygons:
        poly.use_smooth=True
        j=poly.index//n;i=poly.index%n
        for li,coord in zip(poly.loop_indices,[(i/n,j/len(profile)),((i+1)/n,j/len(profile)),((i+1)/n,(j+1)/len(profile)),(i/n,(j+1)/len(profile))]):uv.data[li].uv=coord
    bell['export_uv']=True
    cone((0,0,17.55),.18,.14,.30,'bronze',32)
    beam((0,0,17.45),(0,0,15.30),.055,'iron',.075)
    ico((0,0,15.30),(.17,.17,.22),'iron',2)
    # A pull rope and lever explain how the keeper rings it from the porch.
    cube((.85,0,18.25),(.13,1.8,.12),'timber',.014)
    beam((.85,-.85,18.25),(.85,-.85,.8),.018,'leather',.018)
    # Belfry guard rails and roof ties meet the piers; the square roof covers
    # all four corners instead of leaving a diamond-shaped unsupported lid.
    for side in [-1,1]:
        cube((0,side*2.5,14.0),(5,.12,.14),'timber',.014)
        cube((side*2.5,0,14.0),(.12,5,.14),'timber',.014)
        for a in [-1.6,-.8,0,.8,1.6]:
            cube((a,side*2.5,13.4),(.07,.07,1.1),'timber',.008)
            cube((side*2.5,a,13.4),(.07,.07,1.1),'timber',.008)
    cube((0,0,20.55),(5.4,.28,.30),'timber',.018)
    cube((0,0,20.55),(.28,5.4,.30),'timber',.018)
    roof=cone((0,0,23.1),4.45,.10,4.8,'stoneDark',4);roof.rotation_euler[2]=math.pi/4
    beam((0,0,25.4),(0,0,27.8),.085,'brass',.025)
    finish('bellTower',physical)

    # Fixed iron service ladder, authored in repeatable 1.8 m sections. Wall
    # brackets anchor it; stone blocks stretched into rungs are not hardware.
    physical=[]
    for x in [-.3,.3]:
        physical.append(beam((x,0,0),(x,0,1.8),.035,'iron',.035))
        for z in [.15,1.65]:beam((x,0,z),(x,.26,z),.025,'iron',.025)
    for i in range(6):physical.append(beam((-.3,0,.15+i*.3),(.3,0,.15+i*.3),.024,'iron',.024))
    finish('serviceLadder',physical)

    # Votive banner stand. Its independent skin is driven by native Meep cloth.
    physical=[cube((0,0,.12),(.52,.52,.3),'stoneDark',.06),beam((0,0,.1),(0,0,3.8),.06,'iron',.04)]
    beam((0,0,3.5),(1.8,0,3.5),.045,'brass',.028)
    beam((0,0,2.85),(.65,0,3.5),.025,'iron',.025)
    for x in [.18,1.62]:beam((x,0,3.5),(x,0,3.4),.014,'brass',.014)
    ico((0,0,3.9),(.09,.07,.15),'brass',2)
    finish('bannerStand',physical)

    # Broad massifs meet at saddles. Rounded summit profiles and warped ridge
    # lines avoid repeating a row of cones behind the pilgrimage landmarks.
    ridges=[
      ('mountain',[(-23,4,76,58,48),(17,-8,89,55,46),(46,8,48,42,37)]),
      ('mountainRidge',[(-38,5,53,44,42),(-4,-9,72,62,51),(38,1,65,48,40)]),
      ('mountainShoulder',[(-29,-8,64,54,45),(8,8,52,59,48),(43,-5,38,40,38)]),
    ]
    for variant,(name,peaks) in enumerate(ridges):
        vertices=[];faces=[];nx=80;ny=60
        for j in range(ny+1):
            y=-65+j*130/ny
            for i in range(nx+1):
                x=-88+i*176/nx
                wx=x+8*noise.noise(Vector((x*.018,y*.018,variant*11.7)))
                wy=y+7*noise.noise(Vector((x*.024+31,y*.024,variant*11.7)))
                h=max(height*max(0,1-((wx-cx)/rx)**2-((wy-cy)/ry)**2)**1.65 for cx,cy,height,rx,ry in peaks)
                erosion=noise.fractal(Vector((x*.032,y*.047,variant*11.7)),.8,2,4)
                gullies=abs(noise.noise(Vector((x*.11+y*.035,y*.08,variant*7.1))))
                foothill=min(1,h/12)
                # The ridge continues below the world's edge. A flat base at
                # mountain altitude exposed a floating underside from the east.
                skirt=90*max(0,1-h/20)**2
                z=h+foothill*(erosion*6-gullies*2)-skirt
                vertices.append((x,y,z))
        for j in range(ny):
            for i in range(nx):
                a=j*(nx+1)+i;b=a+1;c=a+nx+1;d=c+1
                faces.extend([(a,b,c),(b,d,c)])
        ridge=mesh(name+' eroded strata',vertices,faces,'stoneDark')
        for poly in ridge.data.polygons:poly.use_smooth=True
        finish(name)
