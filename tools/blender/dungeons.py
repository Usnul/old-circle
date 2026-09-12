"""Masonry rooms, a rising watch stair and an upper gallery over a lower crypt.
All collision pieces and visible surfaces use the exported gameplay floor plan.
"""
import bpy,math

def build_dungeons(world,cube,mesh,finish,cone):
    for dungeon in world['dungeons']:
        ox,oz=dungeon['origin'];base=dungeon['elevation'];physical=[];support_keys=set()
        theme=dungeon.get('materials',{});floor_mat=theme.get('floor','limestone');wall_mat=theme.get('wall','limestone');trim_mat=theme.get('trim','stoneLight');roof_mat=theme.get('roof','stoneDark')
        floors=dungeon['floors']
        def point(x,n,y):return (ox+x,n-oz,y)
        def height(f,n):return f['elevation']+f.get('rise',0)*(n-f['rect'][1])/(f['rect'][3]-f['rect'][1])
        def ground(x,n):
            gx=(ox+x-world['minX'])/2;gz=(oz-n-world['minZ'])/2;ix=math.floor(gx);iz=math.floor(gz);u=gx-ix;v=gz-iz
            h=world['heights'];a,b,c,d=h[iz][ix],h[iz][ix+1],h[iz+1][ix],h[iz+1][ix+1]
            return a+(b-a)*u+(c-a)*v if u+v<=1 else d+(c-d)*(1-u)+(b-d)*(1-v)
        def prism(x0,n0,x1,n1,y0,y1,thickness,material=None,visible=True):
            material=material or floor_mat
            vertices=[point(x,n,y-depth) for depth in [0,thickness] for x,n,y in [(x0,n0,y0),(x1,n0,y0),(x1,n1,y1),(x0,n1,y1)]]
            faces=[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
            if visible:obj=mesh('Dressed floor',vertices,faces,material)
            else:
                data=bpy.data.meshes.new('Stair walking ramp');data.from_pydata(vertices,[],faces);data.update()
                obj=bpy.data.objects.new('Stair walking ramp',data);bpy.context.scene.collection.objects.link(obj)
                obj.hide_render=True;obj.hide_viewport=True
            physical.append(obj)
        def course_uv(obj,bottom,top,local=False):
            # Four rows per tile, with complete courses between bearing joints.
            courses=max(1,round((top-bottom)*.45*4))
            uv=obj.data.uv_layers.new(name='Masonry courses');obj.data.uv_layers.active=uv;uv.active_render=True
            for poly in obj.data.polygons:
                for li in poly.loop_indices:
                    vertex=obj.data.vertices[obj.data.loops[li].vertex_index].co
                    world_vertex=obj.matrix_world@vertex;v=vertex if local else world_vertex
                    if abs(poly.normal.z)>.65:coords=(v.x*.45,v.y*.45)
                    else:coords=((v.y if abs(poly.normal.x)>abs(poly.normal.y) else v.x)*.45+(.25 if local else 0),(world_vertex.z-bottom)*courses/(4*(top-bottom)))
                    uv.data[li].uv=coords
            obj['export_uv']=True
        def solid_wall(a,b,ya,yb,h,thickness=.55,material=None,capped=False,courses=None):
            material=material or wall_mat
            dx,dn=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dn);sx=-dn/length*thickness/2;sn=dx/length*thickness/2
            # Only exposed parapets need coping. It replaces the top of the
            # wall; thin strips laid over full masonry courses are not lintels.
            coping=.18 if capped else 0
            vertices=[point(x+side*sx,n+side*sn,y+up) for up in [0,h-coping] for x,n,y,side in [(a[0],a[1],ya,-1),(b[0],b[1],yb,-1),(b[0],b[1],yb,1),(a[0],a[1],ya,1)]]
            obj=mesh('Crypt wall',vertices,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material);physical.append(obj)
            if courses:course_uv(obj,*courses)
            if coping:
                tx=-dn/length*(thickness+.10)/2;tn=dx/length*(thickness+.10)/2
                verts=[point(x+side*tx,n+side*tn,y+up) for up in [h-coping,h] for x,n,y,side in [(a[0],a[1],ya,-1),(b[0],b[1],yb,-1),(b[0],b[1],yb,1),(a[0],a[1],ya,1)]]
                physical.append(mesh('Continuous sloping coping',verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],trim_mat,.015))
        def masonry_pier(x,n,bottom,top,head_slope=0):
            # Jambs and gallery supports share the same dressed base, coursed
            # shaft and capital. Each component ends where the next begins.
            cap=min(.22,(top-bottom)/4);shaft_bottom=bottom+cap;shaft_top=top-cap
            for label,y in [('Pier plinth',bottom+cap/2),('Pier capital',top-cap/2)]:
                if label=='Pier capital' and head_slope:
                    # Stair beams rise with their flight; dress the bearing
                    # face to that pitch while keeping the shaft bed level.
                    verts=[point(x+dx,n+dn,top-cap if lower else top+head_slope*dn) for lower in [True,False] for dx,dn in [(-.43,-.43),(.43,-.43),(.43,.43),(-.43,.43)]]
                    block=mesh(label,verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'stoneLight',.018)
                else:block=cube(point(x,n,y),(.86,.86,cap),'stoneLight',.018)
                block.name=label;physical.append(block)
            shaft=cube(point(x,n,(shaft_bottom+shaft_top)/2),(.72,.72,shaft_top-shaft_bottom),wall_mat,.025)
            shaft.name='Coursed masonry pier';physical.append(shaft)
            course_uv(shaft,shaft_bottom,shaft_top,local=True)
        def connected(x,n,y,own):
            return any(f is not own and f['rect'][0]-.001<=x<=f['rect'][2]+.001 and f['rect'][1]-.001<=n<=f['rect'][3]+.001 and abs(height(f,n)-y)<.2 for f in floors)
        def supports(f):
            x0,n0,x1,n1=f['rect']
            if f['level']<=0:
                # Ground-floor masonry and the first stair flight need a
                # continuous footing, not a row of short stilts over a ditch.
                for a,b in [((x0,n0),(x1,n0)),((x1,n0),(x1,n1)),((x1,n1),(x0,n1)),((x0,n1),(x0,n0))]:
                    length=math.dist(a,b);count=max(1,math.ceil(length/2));sx=-(b[1]-a[1])/length*.35;sn=(b[0]-a[0])/length*.35
                    for i in range(count):
                        start=tuple(a[k]+(b[k]-a[k])*i/count for k in range(2));end=tuple(a[k]+(b[k]-a[k])*(i+1)/count for k in range(2))
                        corners=[(x+side*sx,n+side*sn) for x,n,side in [(*start,-1),(*end,-1),(*end,1),(*start,1)]]
                        verts=[point(x,n,min(height(f,n)-.4,ground(x,n)-.4)) for x,n in corners]+[point(x,n,height(f,n)-.22) for x,n in corners]
                        foundation=mesh('Continuous masonry foundation',verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],wall_mat);physical.append(foundation)
                return
            # Perimeter piers carry galleries and bridges without closing the
            # lower storey. A continuous edge beam seats the whole capital;
            # a slab ending on the pier centre leaves half its bearing exposed.
            outer=[(x0-.43,n0-.43),(x1+.43,n0-.43),(x1+.43,n1+.43),(x0-.43,n1+.43)]
            inner=[(x0+.43,n0+.43),(x1-.43,n0+.43),(x1-.43,n1-.43),(x0+.43,n1-.43)]
            for i in range(4):
                j=(i+1)%4;corners=[outer[i],outer[j],inner[j],inner[i]]
                verts=[point(x,n,height(f,n)-depth) for depth in [.66,.30] for x,n in corners]
                beam=mesh('Gallery bearing beam',verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],'stoneLight',.018)
                physical.append(beam)
            # Intermediate piers keep unsupported spans below 4m.
            positions=set()
            for a,b in [((x0,n0),(x1,n0)),((x1,n0),(x1,n1)),((x1,n1),(x0,n1)),((x0,n1),(x0,n0))]:
                count=max(1,math.ceil(math.dist(a,b)/4))
                for i in range(count+1):positions.add(tuple(round(a[k]+(b[k]-a[k])*i/count,4) for k in range(2)))
            for x,n in sorted(positions):
                top=height(f,n)-.66
                lower=[height(g,n) for g in floors if g is not f and g['rect'][0]-.01<=x<=g['rect'][2]+.01 and g['rect'][1]-.01<=n<=g['rect'][3]+.01 and height(g,n)<top-.5]
                bottom=max(lower) if lower else min(ground(x+dx,n+dn) for dx in [-.38,.38] for dn in [-.38,.38])-.35
                if top-bottom<.32:continue
                # Authored room links and door centres retain generous clearance.
                if any(math.hypot(x-c[2][0],n-c[2][1])<1.65 and bottom-.1<=base+c[2][2]<=top+.1 for c in dungeon['connections']):continue
                if any(min(w['a'][0],w['b'][0])-.8<=x<=max(w['a'][0],w['b'][0])+.8 and min(w['a'][1],w['b'][1])-.8<=n<=max(w['a'][1],w['b'][1])+.8 and abs((x if w['a'][0]!=w['b'][0] else n)-w['door'][0])<w['door'][1]/2+.6 and bottom<=base+w['level']<=top for w in dungeon['partitions']):continue
                key=(x,n,round(bottom,3),round(top,3))
                if key in support_keys:continue
                support_keys.add(key)
                masonry_pier(x,n,bottom,top,head_slope=f.get('rise',0)/(n1-n0))
        def pitched_roof(f):
            x0,n0,x1,n1=f['rect'];middle=(x0+x1)/2;eave=height(f,n0)+4.4;ridge=eave+min(3.2,(x1-x0)*.28)
            for a,b,ha,hb in [(x0-.3,middle,eave,ridge),(middle,x1+.3,ridge,eave)]:
                verts=[point(x,n,y+up) for up in [0,.24] for x,n,y in [(a,n0-.3,ha),(b,n0-.3,hb),(b,n1+.3,hb),(a,n1+.3,ha)]]
                roof=mesh('Pitched weather roof',verts,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],roof_mat);physical.append(roof)
            for n in [n0,n1]:
                verts=[point(x,n+depth,y) for depth in [-.275,.275] for x,y in [(x0,eave),(x1,eave),(middle,ridge)]]
                gable=mesh('Bearing masonry gable',verts,[(0,1,2),(5,4,3),(3,4,1,0),(4,5,2,1),(5,3,0,2)],wall_mat);physical.append(gable)
        for f in floors:
            x0,n0,x1,n1=f['rect'];ya=height(f,n0);yb=height(f,n1)
            stair=abs(yb-ya)>.3
            prism(x0,n0,x1,n1,ya,yb,.30,visible=not stair)
            if stair:
                count=math.ceil(abs(yb-ya)/.15);run=(n1-n0)/count
                for i in range(count):
                    start=n0+i*run;end=start+run;low=min(height(f,start),height(f,end));top=max(height(f,start),height(f,end))
                    cube(point((x0+x1)/2,(start+end)/2,(top+low-.3)/2),(x1-x0,run,top-low+.3),floor_mat,.01)
            supports(f)
            if f['roof']:
                # An adjoining upper return walk also needs its low roof
                # landing clear; a gable there would seal the authored exit.
                above=any(g is not f and min(x1+.35,g['rect'][2])-max(x0-.35,g['rect'][0])>.05 and min(n1+.35,g['rect'][3])-max(n0-.35,g['rect'][1])>.05 and min(height(g,g['rect'][1]),height(g,g['rect'][3]))>max(ya,yb)+2 for g in floors)
                if above:prism(x0-.15,n0-.15,x1+.15,n1+.15,ya+4.5,yb+4.5,.22,roof_mat)
                else:pitched_roof(f)
            # Grid-aligned walls leave shared floor edges and authored doors open.
            for a,b,out in [((x0,n0),(x1,n0),(0,-.3)),((x1,n0),(x1,n1),(.3,0)),((x1,n1),(x0,n1),(0,.3)),((x0,n1),(x0,n0),(-.3,0))]:
                length=math.dist(a,b);steps=math.ceil(length/2)
                for i in range(steps):
                    start=tuple(a[j]+(b[j]-a[j])*i/steps for j in range(2));end=tuple(a[j]+(b[j]-a[j])*(i+1)/steps for j in range(2));mid=tuple((start[j]+end[j])/2 for j in range(2));y=height(f,mid[1])
                    if connected(mid[0]+out[0],mid[1]+out[1],y,f):continue
                    if f['id']=='entry' and abs(mid[1]-n0)<.01:continue
                    if any(abs(o['level']-f['level'])<.01 and min(o['a'][0],o['b'][0])-.01<=mid[0]<=max(o['a'][0],o['b'][0])+.01 and min(o['a'][1],o['b'][1])-.01<=mid[1]<=max(o['a'][1],o['b'][1])+.01 for o in dungeon['openings']):continue
                    h=.92 if f.get('rise') or f['level']>0 and not f['roof'] else 4.4
                    solid_wall(start,end,height(f,start[1]),height(f,end[1]),h,capped=h<1.2)
        for wall in dungeon['partitions']:
            a,b=wall['a'],wall['b'];y=base+wall['level'];axis=0 if a[0]!=b[0] else 1;center,width=wall['door'];lo=center-width/2;hi=center+width/2
            p=a.copy();q=b.copy();p[axis]=lo;q[axis]=hi
            # Reserve full jamb bays in the wall instead of burying decorative
            # posts in it. A deep stone lintel bears across both capitals;
            # the masonry above begins at its top, with no overlay strip.
            # The jamb bay follows the narrower shaft between its projecting
            # caps. Keeping the cap width throughout leaves an open slit.
            for bottom,top,half_width in [(0,.22,.43),(.22,2.68,.36),(2.68,3.42,.43)]:
                left=p.copy();right=q.copy();left[axis]-=half_width;right[axis]+=half_width
                solid_wall(a,left,y+bottom,y+bottom,top-bottom,courses=(y,y+3.42))
                solid_wall(right,b,y+bottom,y+bottom,top-bottom,courses=(y,y+3.42))
            for v in [p,q]:masonry_pier(v[0],v[1],y,y+2.9)
            lintel_size=[.86,.86,.52];lintel_size[axis]=width+.86
            lintel=cube(point((p[0]+q[0])/2,(p[1]+q[1])/2,y+3.16),lintel_size,'stoneLight',.018)
            lintel.name='Bearing doorway lintel';physical.append(lintel)
            # Two complete courses run across the entire partition above the
            # lintel, without cutting the first course at its bearing surface.
            solid_wall(a,b,y+3.42,y+3.42,.98,courses=(y+3.42,y+4.4))
        # A small blind arcade above the threshold marks the dungeon from the cave.
        front=height(floors[-1],-3)
        for side in [-1,1]:
            backing=cube(point(side*2.35,-3,front+2.1),(.57,.82,4.2),wall_mat,.0);physical.append(backing)
            for row in range(7):cube(point(side*2.35,-3,front+.3+row*.6),(.6,.85,.6),trim_mat,.018)
        for i in range(11):
            a=i*math.pi/11;b=(i+1)*math.pi/11
            vertices=[point(r*math.cos(t),n,front+4.2+r*math.sin(t)) for n in [-3.425,-2.575] for r in [2.05,2.65] for t in [a,b]]
            # Match the outward winding of the freestanding arch stones.
            faces=[(2,3,1,0),(5,7,6,4),(1,5,4,0),(6,7,3,2),(4,6,2,0),(3,7,5,1)]
            mesh('Threshold arch',vertices,faces,trim_mat,.018)
            core=[point(r*math.cos(t),n,front+4.2+r*math.sin(t)) for n in [-3.405,-2.595] for r in [2.07,2.63] for t in [a,b]]
            physical.append(mesh('Threshold arch mortar',core,faces,wall_mat))
        finish('dungeon_'+dungeon['id'],physical)
    # Two native states make the personal reward legible without a UI marker.
    for opened in [False,True]:
        body=cube((0,0,.45),(1.4,.85,.8),'stoneDark',.07)
        lid=cube((0,.42 if opened else 0,1.25 if opened else .92),(1.52,.96,.22),'stoneLight',.065)
        if opened:lid.rotation_euler[0]=math.radians(68)
        for x in [-.52,.52]:cube((x,0,.57),(.12,.90,.9),'brass',.025)
        if not opened:cone((0,0,1.15),.18,.07,.3,'ember',10)
        finish('reliquarySpent' if opened else 'reliquary',[body])
