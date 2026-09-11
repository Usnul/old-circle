"""Masonry rooms, a rising watch stair and an upper gallery over a lower crypt.
All collision pieces and visible surfaces use the exported gameplay floor plan.
"""
import math

def build_dungeons(world,cube,mesh,finish,cone):
    for dungeon in world['dungeons']:
        ox,oz=dungeon['origin'];base=dungeon['elevation'];physical=[]
        theme=dungeon.get('materials',{});floor_mat=theme.get('floor','limestone');wall_mat=theme.get('wall','limestone');trim_mat=theme.get('trim','stoneLight');roof_mat=theme.get('roof','stoneDark')
        floors=dungeon['floors']
        def point(x,n,y):return (ox+x,n-oz,y)
        def height(f,n):return f['elevation']+f.get('rise',0)*(n-f['rect'][1])/(f['rect'][3]-f['rect'][1])
        def prism(x0,n0,x1,n1,y0,y1,thickness,material=None):
            material=material or floor_mat
            vertices=[point(x,n,y-depth) for depth in [0,thickness] for x,n,y in [(x0,n0,y0),(x1,n0,y0),(x1,n1,y1),(x0,n1,y1)]]
            obj=mesh('Dressed floor',vertices,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],material);physical.append(obj)
        def solid_wall(a,b,ya,yb,h,thickness=.55,material=None):
            material=material or wall_mat
            dx,dn=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dn);sx=-dn/length*thickness/2;sn=dx/length*thickness/2
            vertices=[point(x+side*sx,n+side*sn,y+up) for up in [0,h] for x,n,y,side in [(a[0],a[1],ya,-1),(b[0],b[1],yb,-1),(b[0],b[1],yb,1),(a[0],a[1],ya,1)]]
            obj=mesh('Crypt wall',vertices,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material);physical.append(obj)
            # Raised mortar courses and coping catch light without adding colliders.
            for offset in [.08,h-.1]:
                p=point((a[0]+b[0])/2,(a[1]+b[1])/2,(ya+yb)/2+offset)
                trim=cube(p,(length+.03,thickness+.10,.12),trim_mat,.02);trim.rotation_euler[2]=math.atan2(dn,dx)
        def connected(x,n,y,own):
            return any(f is not own and f['rect'][0]-.001<=x<=f['rect'][2]+.001 and f['rect'][1]-.001<=n<=f['rect'][3]+.001 and abs(height(f,n)-y)<.2 for f in floors)
        for f in floors:
            x0,n0,x1,n1=f['rect'];ya=height(f,n0);yb=height(f,n1)
            prism(x0,n0,x1,n1,ya,yb,.30)
            if f['roof']:prism(x0-.15,n0-.15,x1+.15,n1+.15,ya+4.5,yb+4.5,.22,roof_mat)
            # Grid-aligned walls leave shared floor edges and authored doors open.
            for a,b,out in [((x0,n0),(x1,n0),(0,-.3)),((x1,n0),(x1,n1),(.3,0)),((x1,n1),(x0,n1),(0,.3)),((x0,n1),(x0,n0),(-.3,0))]:
                length=math.dist(a,b);steps=math.ceil(length/2)
                for i in range(steps):
                    start=tuple(a[j]+(b[j]-a[j])*i/steps for j in range(2));end=tuple(a[j]+(b[j]-a[j])*(i+1)/steps for j in range(2));mid=tuple((start[j]+end[j])/2 for j in range(2));y=height(f,mid[1])
                    if connected(mid[0]+out[0],mid[1]+out[1],y,f):continue
                    if f['id']=='entry' and abs(mid[1]-n0)<.01:continue
                    if any(abs(o['level']-f['level'])<.01 and min(o['a'][0],o['b'][0])-.01<=mid[0]<=max(o['a'][0],o['b'][0])+.01 and min(o['a'][1],o['b'][1])-.01<=mid[1]<=max(o['a'][1],o['b'][1])+.01 for o in dungeon['openings']):continue
                    h=.92 if f.get('rise') or f['level']>0 and not f['roof'] else 4.4
                    solid_wall(start,end,height(f,start[1]),height(f,end[1]),h)
        for wall in dungeon['partitions']:
            a,b=wall['a'],wall['b'];y=base+wall['level'];axis=0 if a[0]!=b[0] else 1;center,width=wall['door'];lo=center-width/2;hi=center+width/2
            p=a.copy();q=b.copy();p[axis]=lo;q[axis]=hi
            solid_wall(a,p,y,y,4.4);solid_wall(q,b,y,y,4.4);solid_wall(p,q,y+2.9,y+2.9,1.5)
            for v in [p,q]:cube(point(v[0],v[1],y+1.45),(.72,.72,2.9),trim_mat,.035)
        # A small blind arcade above the threshold marks the dungeon from the cave.
        front=height(floors[-1],-3)
        for side in [-1,1]:
            for row in range(7):cube(point(side*2.35,-3,front+.3+row*.6),(.6,.85,.58),trim_mat,.035)
        for i in range(11):
            a=i*math.pi/11;b=(i+1)*math.pi/11
            vertices=[point(r*math.cos(t),n,front+3.9+r*math.sin(t)) for n in [-3.35,-2.65] for r in [2.08,2.6] for t in [a,b]]
            # Match the outward winding of the freestanding arch stones.
            mesh('Threshold arch',vertices,[(2,3,1,0),(5,7,6,4),(1,5,4,0),(6,7,3,2),(4,6,2,0),(3,7,5,1)],trim_mat)
        finish('dungeon_'+dungeon['id'],physical)
    # Two native states make the personal reward legible without a UI marker.
    for opened in [False,True]:
        body=cube((0,0,.45),(1.4,.85,.8),'stoneDark',.07)
        lid=cube((0,.42 if opened else 0,1.25 if opened else .92),(1.52,.96,.22),'stoneLight',.065)
        if opened:lid.rotation_euler[0]=math.radians(68)
        for x in [-.52,.52]:cube((x,0,.57),(.12,.90,.9),'brass',.025)
        if not opened:cone((0,0,1.15),.18,.07,.3,'ember',10)
        finish('reliquarySpent' if opened else 'reliquary',[body])
