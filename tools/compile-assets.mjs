import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(new URL('../packages/game/package.json', import.meta.url));
const meep = async path => import(pathToFileURL(require.resolve(`@woosh/meep-engine/src/${path}`)).href);
const { Geometry } = await meep('shade/renderer/geometry/Geometry.js');
const { Attribute } = await meep('shade/renderer/geometry/Attribute.js');
const { meshlet_geometry_build_from_geometry } = await meep('shade/renderer/geometry/meshlet_geometry_build_from_geometry.js');
const { MeshletGeometrySerializationAdapter } = await meep('shade/renderer/geometry/MeshletGeometrySerializationAdapter.js');
const { BinaryBuffer } = await meep('core/binary/BinaryBuffer.js');
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'packages/client/public/assets/geometry');
await mkdir(out, { recursive: true });
const meshes = JSON.parse(await readFile(resolve(root, '.local/blender/meshes.json'), 'utf8'));
const manifest = { version: 1, engine: '3.20.0', models: {} };
let previous;try{previous=JSON.parse(await readFile(resolve(out,'manifest.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const serializer = new MeshletGeometrySerializationAdapter();
for (const [name, chunks] of Object.entries(meshes)) {
  manifest.models[name] = [];
  for (let i=0; i<chunks.length; i++) {
    const chunk=chunks[i], geo=new Geometry(); geo.name=name;
    geo.attributes=[Attribute.from(new Float32Array(chunk.positions),3,'position'), Attribute.from(new Float32Array(chunk.normals),3,'normal'), Attribute.from(new Float32Array(chunk.uvs),2,'uv0')];
    geo.index=Attribute.from(new Uint32Array(chunk.indices),1,'index');
    geo.computeTangents();
    const meshlet=meshlet_geometry_build_from_geometry(geo), buffer=new BinaryBuffer();
    serializer.serialize(buffer, meshlet);
    const file=`${name}-${i}.meep`;
    await writeFile(resolve(out,file),new Uint8Array(buffer.data,0,buffer.position));
    manifest.models[name].push({ file, material: chunk.material, triangles: chunk.indices.length/3 });
  }
}
await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest));
const files=new Set(Object.values(manifest.models).flat().map(c=>c.file));
for(const chunk of Object.values(previous?.models??{}).flat())if(!files.has(chunk.file)&&/^[a-zA-Z0-9_-]+\.meep$/.test(chunk.file))await unlink(resolve(out,chunk.file)).catch(e=>{if(e.code!=='ENOENT')throw e;});
console.log(`Compiled ${Object.keys(meshes).length} Blender models to Meep meshlets with serialized BVHs.`);
