import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {deflateSync,crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {WORLD_BOUNDS,WORLD_VERSION,REGIONS,ROAD_PATHS,LANDMARKS,HEARTHS,heightAt,terrainSurface} from '../packages/game/src/world/regions.mjs';
import {worldToMap,MAP_SIZE} from '../packages/game/src/world/map.mjs';
import {buildLayout} from '../packages/game/src/world/layout.mjs';
import colliders from '../packages/game/src/content/colliders.json' with {type:'json'};

// The journal and generator share a metre-for-metre, north-up projection.
// No second layout, hand-placed road, or invented shoreline lives here.
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'packages/client/public/assets/map');await mkdir(out,{recursive:true});
const require=createRequire(new URL('../packages/game/package.json',import.meta.url));
const meep=path=>import(pathToFileURL(require.resolve('@woosh/meep-engine/src/'+path)));
const {clamp}=await meep('core/math/clamp.js');
const {convex_hull_monotone_2d}=await meep('core/geom/2d/convex-hull/convex_hull_monotone_2d.js');
const {BinaryBuffer}=await meep('core/binary/BinaryBuffer.js'),{MeshletGeometry}=await meep('shade/renderer/geometry/MeshletGeometry.js'),{MeshletGeometrySerializationAdapter}=await meep('shade/renderer/geometry/MeshletGeometrySerializationAdapter.js');
const layout=buildLayout(),[width,height]=MAP_SIZE,rgba=Buffer.alloc(width*height*4),adapter=new MeshletGeometrySerializationAdapter();
const colors=REGIONS.map(r=>r.color.slice(1).match(/../g).map(c=>parseInt(c,16)));
for(let py=0;py<height;py++)for(let px=0;px<width;px++){
  const x=px+WORLD_BOUNDS.minX,z=py+WORLD_BOUNDS.minZ,h=heightAt(x,z),dx=(heightAt(x+1,z)-heightAt(x-1,z))/2,dz=(heightAt(x,z+1)-heightAt(x,z-1))/2;
  const lighting=clamp((1+dx*.6+dz*.7)/Math.hypot(dx,1,dz),.32,1.1);
  const weights=REGIONS.map(r=>Math.exp(-Math.pow(Math.hypot(x-r.center[0],z-r.center[1])/r.radius,3))),sum=weights.reduce((a,b)=>a+b,0);
  const contour=Math.floor(h/5)!==Math.floor(heightAt(x+1,z+1)/5)?.85:1;
  for(let c=0;c<3;c++)rgba[(py*width+px)*4+c]=Math.round((colors.reduce((v,r,i)=>v+r[c]*weights[i],0)/sum*.58+[64,62,52][c])*(.6+lighting*.4)*contour);
  rgba[(py*width+px)*4+3]=255;
}
function chunk(type,data){const name=Buffer.from(type),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([n,name,data,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
const scan=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)rgba.copy(scan,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
const manifest=JSON.parse(await readFile(resolve(root,'packages/client/public/assets/geometry/manifest.json'),'utf8')),bounds=new Map();
const trees=new Set(['tree','pine','winterTree','magicTree']);
for(const name of trees){
  const b=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(const part of manifest.models[name]??[]){const bytes=await readFile(resolve(root,'packages/client/public/assets/geometry',part.file)),buffer=new BinaryBuffer(),g=new MeshletGeometry();buffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));adapter.deserialize(buffer,g);for(let i=0;i<3;i++){b[i]=Math.min(b[i],g.bounding_box[i]);b[i+3]=Math.max(b[i+3],g.bounding_box[i+3]);}}
  bounds.set(name,b);
}
const fmt=n=>n.toFixed(2),polygons=[],groves=[],water=[];
for(const prop of layout.props){
  const [mx,my]=worldToMap(prop.position[0],prop.position[2]);
  if(trees.has(prop.model)){
    const b=bounds.get(prop.model),rx=(b[3]-b[0])/2*prop.scale[0],ry=(b[5]-b[2])/2*prop.scale[2];
    groves.push(`<ellipse cx="${fmt(mx)}" cy="${fmt(my)}" rx="${fmt(rx)}" ry="${fmt(ry)}" transform="rotate(${fmt(-prop.yaw*180/Math.PI)} ${fmt(mx)} ${fmt(my)})" fill="${prop.model==='magicTree'?'#507b83':prop.model==='winterTree'?'#85918b':'#29483a'}" fill-opacity=".7" stroke="#15271f" stroke-opacity=".4" stroke-width=".35"/>`);continue;
  }
  for(const part of colliders[prop.model]??[]){
    const points=[];for(let i=0;i<part.vertices.length;i+=3){const x=part.vertices[i]*prop.scale[0],z=part.vertices[i+2]*prop.scale[2];points.push(worldToMap(prop.position[0]+Math.cos(prop.yaw)*x+Math.sin(prop.yaw)*z,prop.position[2]-Math.sin(prop.yaw)*x+Math.cos(prop.yaw)*z));}
    const footprint=convex_hull_monotone_2d(points.flat()).map(i=>points[i]);if(footprint.length<3)continue;
    const rock=/rock|sandstone|hollow|cave|mountain/i.test(prop.model),wood=/trunk/i.test(prop.model),isWater=/water/i.test(prop.model);
    const polygon=`<polygon points="${footprint.map(p=>p.map(fmt).join(',')).join(' ')}" fill="${isWater?'#568d9f':wood?'#4b392b':rock?'#747266':'#c1b798'}" stroke="${rock?'#55594b':'#4b493d'}" stroke-width=".35"/>`;
    (isWater?water:polygons).push(polygon);
  }
}
const roads=ROAD_PATHS.map(r=>`<polyline points="${r.points.map(p=>worldToMap(...p).map(fmt).join(',')).join(' ')}" fill="none" stroke="#d7c797" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
const metadata={contentVersion:WORLD_VERSION,bounds:WORLD_BOUNDS,projection:'north-up; one map unit per world metre',props:layout.props.length,waterFootprints:water.length,
  sourceHash:createHash('sha256').update(JSON.stringify({vertices:[...terrainSurface().vertices],layout,colliders,canopyBounds:[...bounds],roads:ROAD_PATHS,landmarks:LANDMARKS,hearths:HEARTHS})).digest('hex')};
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width*2}" height="${height*2}" viewBox="0 0 ${width} ${height}"><title>Old Circle — the known lands</title><desc>Terrain relief, five-metre contours, graded roads, native geometry canopy extents and collision footprints generated from the playable world. North is up.</desc><metadata>${JSON.stringify(metadata)}</metadata><defs><clipPath id="bounds"><rect width="${width}" height="${height}"/></clipPath></defs><g clip-path="url(#bounds)"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/>${water.join('')}${groves.join('')}${roads}${polygons.join('')}</g><rect x="1" y="1" width="${width-2}" height="${height-2}" fill="none" stroke="#343f31" stroke-width="2"/></svg>`;
await writeFile(resolve(out,'world.svg'),svg);await writeFile(resolve(out,'world.json'),JSON.stringify(metadata,null,2)+'\n');
console.log(`Generated ${width} × ${height} m map from ${layout.props.length} props and ${ROAD_PATHS.length} roads (${water.length} water footprints).`);
