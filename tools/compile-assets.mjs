import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir, unlink, rename } from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import { resolve } from 'node:path';
import {createHash} from 'node:crypto';
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
Object.assign(meshes,JSON.parse(await readFile(resolve(root,'.local/blender/lods.json'),'utf8')));
Object.assign(meshes,JSON.parse(await readFile(resolve(root,'.local/blender/characters.json'),'utf8')));
const manifest = { version: 2, engine: '3.20.0', models: {}, bounds:{}, lods:{} };
let previous;try{previous=JSON.parse(await readFile(resolve(out,'manifest.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const serializer = new MeshletGeometrySerializationAdapter();
const fingerprint=createHash('sha256');
async function writeChanged(path,bytes){
  const next=Buffer.from(bytes);let current;
  try{current=await readFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(current?.equals(next))return;
  const temporary=`${path}.${process.pid}.tmp`;
  try{
    await writeFile(temporary,next);
    // Asset readers and antivirus can briefly hold a Windows file open. Publish
    // complete geometry atomically so a live preview never reads half a mesh.
    for(let attempt=0;;attempt++){
      try{await rename(temporary,path);break;}
      catch(error){if(attempt===6||!['EBUSY','EPERM','EACCES','UNKNOWN'].includes(error.code))throw error;await delay(50*(attempt+1));}
    }
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
for (const [name, chunks] of Object.entries(meshes)) {
  manifest.models[name] = [];
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for (let i=0; i<chunks.length; i++) {
    const chunk=chunks[i], geo=new Geometry(); geo.name=name;
    for(let j=0;j<chunk.positions.length;j++){const axis=j%3;bounds[axis]=Math.min(bounds[axis],chunk.positions[j]);bounds[axis+3]=Math.max(bounds[axis+3],chunk.positions[j]);}
    geo.attributes=[Attribute.from(new Float32Array(chunk.positions),3,'position'), Attribute.from(new Float32Array(chunk.normals),3,'normal'), Attribute.from(new Float32Array(chunk.uvs),2,'uv0')];
    geo.index=Attribute.from(new Uint32Array(chunk.indices),1,'index');
    if(chunk.joints){geo.attributes.push(Attribute.from(new Uint16Array(chunk.joints),4,'joints'),Attribute.from(new Float32Array(chunk.weights),4,'weights'));}
    geo.computeTangents();
    const meshlet=meshlet_geometry_build_from_geometry(geo), buffer=new BinaryBuffer();
    serializer.serialize(buffer, meshlet);
    const file=`${name}-${i}.meep`;
    fingerprint.update(name).update(chunk.material).update(new Uint8Array(buffer.data,0,buffer.position));
    await writeChanged(resolve(out,file),new Uint8Array(buffer.data,0,buffer.position));
    manifest.models[name].push({ file, material: chunk.material, triangles: chunk.indices.length/3, bytes:buffer.position });
  }
  manifest.bounds[name]=bounds;
  if(name.endsWith('_distant'))manifest.lods[name.slice(0,-8)]=name;
}
manifest.revision=fingerprint.digest('hex').slice(0,24);
await writeChanged(resolve(out,'manifest.json'),JSON.stringify(manifest));
const files=new Set(Object.values(manifest.models).flat().map(c=>c.file));
for(const chunk of Object.values(previous?.models??{}).flat())if(!files.has(chunk.file)&&/^[a-zA-Z0-9_-]+\.meep$/.test(chunk.file))await unlink(resolve(out,chunk.file)).catch(e=>{if(e.code!=='ENOENT')throw e;});
console.log(`Compiled ${Object.keys(meshes).length} Blender models to Meep meshlets with serialized BVHs.`);
