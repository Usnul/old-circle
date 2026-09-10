import {afterEach,expect,test} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat,utimes,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {precompress} from '../../client/precompress.mjs';
import {staticAssets} from './static-assets.mjs';
import {GeometryCache} from '../../client/src/render/geometry-cache.mjs';

const resources=[],bytes=Buffer.from('Native meshlets and serialized BVHs.\n'.repeat(4096));
async function setup(){
  const directory=await mkdtemp(join(tmpdir(),'old-circle-assets-')),entry={directory};resources.push(entry);
  await mkdir(join(directory,'geometry'));
  await writeFile(join(directory,'geometry','model.meep'),bytes);
  await writeFile(join(directory,'index.html'),'<h1>Old Circle</h1>');
  await precompress(directory);
  const server=createServer(staticAssets(directory));entry.server=server;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {directory,url:`http://127.0.0.1:${server.address().port}`};
}
afterEach(async()=>{for(const {server,directory} of resources){if(server)await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}resources.length=0;});

test('build-time compression preserves native bytes and removes an obsolete sidecar when an asset stops compressing well',async()=>{
  const {directory}=await setup(),file=join(directory,'geometry','model.meep'),encoded=await readFile(file+'.br');
  expect(brotliDecompressSync(encoded)).toEqual(bytes);expect(await readFile(file)).toEqual(bytes);
  expect(encoded.length).toBeLessThan(bytes.length/4);
  const replacement=randomBytes(8192);await writeFile(file,replacement);await precompress(directory);
  await expect(stat(file+'.br')).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(file)).toEqual(replacement);
  expect((await readdir(join(directory,'geometry'))).some(n=>n.endsWith('.tmp'))).toBe(false);
});

test.each([
  ['gzip, deflate, br','br'],['BR;Q=1, identity;q=0.5','br'],['*','br'],['br;q=0.5, identity;q=0.1','br'],
  ['br;q=0, *;q=1',null],['br;q=0.2, identity;q=0.9',null],['gzip',null],['',null],
])('static assets negotiate %s, preserve MIME and isolation headers, and transparently decode',async(header,encoding)=>{
  const {url}=await setup(),response=await fetch(url+'/geometry/model.meep?revision=one',{headers:{'Accept-Encoding':header}});
  expect(response.status).toBe(200);expect(response.headers.get('content-encoding')).toBe(encoding);
  expect(response.headers.get('content-type')).toBe('application/octet-stream');expect(response.headers.get('vary')).toBe('Accept-Encoding');
  expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  const head=await fetch(url+'/geometry/model.meep',{method:'HEAD',headers:{'Accept-Encoding':header}});
  expect(head.headers.get('content-length')).toBe(response.headers.get('content-length'));expect(await head.text()).toBe('');
});

test('a stale compressed asset falls back to current bytes and an excluded identity response is rejected',async()=>{
  const {url,directory}=await setup(),file=join(directory,'geometry','model.meep');
  const replacement=Buffer.from('Updated geometry.');await writeFile(file,replacement);await utimes(file+'.br',1,1);
  const current=await fetch(url+'/geometry/model.meep',{headers:{'Accept-Encoding':'br'}});
  expect(current.headers.get('content-encoding')).toBeNull();expect(Buffer.from(await current.arrayBuffer())).toEqual(replacement);
  for(const header of ['br, identity;q=0','*;q=0','gzip, identity;q=0']){
    const response=await fetch(url+'/geometry/model.meep',{headers:{'Accept-Encoding':header}});expect(response.status).toBe(406);await response.text();
  }
});

test('the offline geometry cache stores decoded HTTP bytes without retaining a transfer encoding',async()=>{
  const {url}=await setup(),disk=new Map(),manifest={revision:'compressed',models:{model:[{file:'model.meep'}]}};
  const storage={open:async()=>({match:async key=>disk.get(key)?.clone(),put:async(key,response)=>disk.set(key,response)})};
  let online=true,requests=0;
  const fetcher=async path=>{
    if(!online)throw new Error('Disconnected');requests++;
    const response=await fetch(url+path.replace('/assets/','/'),{headers:{'Accept-Encoding':'br'}});
    expect(response.headers.get('content-encoding')).toBe('br');return response;
  };
  await new GeometryCache(manifest,{storage,fetcher}).warm();online=false;
  expect(disk.get('/assets/geometry/model.meep').headers.get('content-encoding')).toBeNull();
  const reopened=new GeometryCache(manifest,{storage,fetcher});expect(Buffer.from(await reopened.read('model.meep'))).toEqual(bytes);expect(requests).toBe(1);
});

test('uncompressed entry pages remain usable and asset serving stays within the built directory',async()=>{
  const {url}=await setup();
  const index=await fetch(url+'/',{headers:{'Accept-Encoding':'br'}});expect(index.headers.get('content-type')).toBe('text/html');expect(await index.text()).toContain('Old Circle');
  for(const [path,status] of [['/missing.meep',404],['/%2e%2e%2foutside.txt',403],['/bad%path',400]]){
    const response=await fetch(url+path);expect(response.status).toBe(status);await response.text();
  }
  const post=await fetch(url+'/geometry/model.meep',{method:'POST'});expect(post.status).toBe(405);expect(post.headers.get('allow')).toBe('GET, HEAD');await post.text();
});
