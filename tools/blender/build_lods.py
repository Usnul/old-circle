"""Editable distant representations of the authored world; no runtime mesh synthesis.

Terrain keeps every two-metre perimeter vertex, so mixed detail tiles meet without
cracks. Other large static models use Blender's material-aware decimation.
"""
import bpy, bmesh, json, math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.local/blender'
world=json.loads((OUT/'world.json').read_text())
source=ROOT/'assets/blender/old-circle-kit.blend'
with bpy.data.libraries.load(str(source),link=False) as (available,loaded):
 loaded.collections=[name for name in available.collections if name in
  ['tree','pine','magicTree','winterTree','bellTower','abbeyFloor',
   'bellkeeperHollow','mountain','mountainRidge','mountainShoulder','abbeyWall','arch'] or name.startswith('dungeon_')]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
assets={}

def export(name,objects,terrain=False):
 collection=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(collection)
 chunks=[];deps=bpy.context.evaluated_depsgraph_get()
 for mat in sorted({m.name for o in objects for m in o.data.materials if m}):
  positions=[];normals=[];uvs=[];indices=[]
  for o in objects:
   ev=o.evaluated_get(deps);m=ev.to_mesh();m.calc_loop_triangles()
   matrix=o.matrix_world;normal_matrix=matrix.to_3x3().inverted().transposed()
   for tri in m.loop_triangles:
    if m.materials[m.polygons[tri.polygon_index].material_index].name!=mat:continue
    for vi,li in zip(tri.vertices,tri.loops):
     v=matrix@m.vertices[vi].co
     n=(normal_matrix@(m.vertices[vi].normal if m.polygons[tri.polygon_index].use_smooth else tri.normal)).normalized()
     if terrain:
      ix=round((v.x-world['minX'])/2);iz=round((-v.y-world['minZ'])/2);h=world['heights']
      ax,bx=max(0,ix-1),min(240,ix+1);az,bz=max(0,iz-1),min(320,iz+1)
      n=Vector((-(h[iz][bx]-h[iz][ax])/((bx-ax)*2),(h[bz][ix]-h[az][ix])/((bz-az)*2),1)).normalized()
     indices.append(len(positions)//3);positions.extend((v.x,v.z,-v.y));normals.extend((n.x,n.z,-n.y))
     if o.get('export_uv') and m.uv_layers.active:uvs.extend(m.uv_layers.active.data[li].uv)
     elif abs(n.z)>.65:uvs.extend((v.x*.45,v.y*.45))
     elif abs(n.x)>abs(n.y):uvs.extend((v.y*.45,v.z*.45))
     else:uvs.extend((v.x*.45,v.z*.45))
   ev.to_mesh_clear()
  if indices:chunks.append(dict(material=mat,positions=positions,normals=normals,indices=indices,uvs=uvs))
 for o in objects:
  for prior in list(o.users_collection):prior.objects.unlink(o)
  collection.objects.link(o)
 assets[name]=chunks;collection.hide_viewport=True;collection.hide_render=True

for collection in loaded.collections:
 objects=[]
 for original in list(collection.objects):
  if original.type!='MESH':continue
  o=original.copy();o.data=original.data.copy();bpy.context.scene.collection.objects.link(o)
  # Welding is local to each authored object and never crosses material seams.
  bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0001);bm.to_mesh(o.data);bm.free()
  # Keep contact edges on dressed masonry, stair treads and timber supports.
  # Collapsing their 54-face bevelled prisms shifts the bearing surfaces and
  # opens cracks between neighbouring stones (or removes narrow stair tops).
  # Curved bell shells and organic silhouettes still benefit from decimation.
  architectural=collection.name in ['arch','abbeyFloor','abbeyWall','bellTower'] or collection.name.startswith('dungeon_')
  preserve=architectural and len(o.data.polygons)<=80
  if not preserve and (o.modifiers or len(o.data.polygons)>12):
   mod=o.modifiers.new('Distant silhouette','DECIMATE');mod.ratio=.22 if collection.name in ['tree','pine','magicTree'] else .3
   mod.use_collapse_triangulate=True
  objects.append(o)
 export(collection.name+'_distant',objects)
 bpy.data.collections.remove(collection)

landscape=bpy.data.materials.get('landscape') or bpy.data.materials.new('landscape')
def height(x,z):return world['heights'][round((z-world['minZ'])/2)][round((x-world['minX'])/2)]
for tx in range(-3,3):
 for tz in range(-6,2):
  vertices=[];faces=[];lookup={}
  def vertex(x,z):
   key=(x,z)
   if key not in lookup:lookup[key]=len(vertices);vertices.append((x,-z,height(x,z)))
   return lookup[key]
  for j in range(10):
   for i in range(10):
    x=tx*80+i*8;z=tz*80+j*8
    if i not in (0,9) and j not in (0,9):
     a,b,c,d=[vertex(*p) for p in [(x,z),(x+8,z),(x,z+8),(x+8,z+8)]];faces.extend([(a,c,b),(b,c,d)])
    else:
     ring=[]
     for a,b,edge in [((x,z),(x,z+8),i==0),((x,z+8),(x+8,z+8),j==9),((x+8,z+8),(x+8,z),i==9),((x+8,z),(x,z),j==0)]:
      steps=4 if edge else 1
      ring.extend(vertex(a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps) for k in range(steps))
     center=vertex(x+4,z+4);faces.extend((center,ring[k],ring[(k+1)%len(ring)]) for k in range(len(ring)))
  mesh=bpy.data.meshes.new('Stitched eight-metre terrain');mesh.from_pydata(vertices,[],faces);mesh.update();mesh.materials.append(landscape)
  o=bpy.data.objects.new(f'terrain_{tx}_{tz}_distant',mesh);bpy.context.scene.collection.objects.link(o)
  export(o.name,[o],terrain=True)

(OUT/'lods.json').write_text(json.dumps(assets,separators=(',',':')))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/old-circle-lods.blend'))
print('OLD CIRCLE: authored',len(assets),'distant representations')
