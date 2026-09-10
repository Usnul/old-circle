import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {resolve,extname,sep} from 'node:path';

const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wav':'audio/wav','.svg':'image/svg+xml'};
// RFC 9110 §12.5.3: explicit exclusions override *, and identity is otherwise
// acceptable. Prefer a supported compressed representation when not outweighed
// by an explicit preference for identity. Never compress on the simulation host.
function preferences(header=''){
  const weights=new Map();
  for(const entry of header.toLowerCase().split(',')){
    const [coding,...parameters]=entry.trim().split(';'),quality=parameters.map(p=>p.trim()).find(p=>p.startsWith('q='));
    if(!coding)continue;
    const value=quality?.slice(2);
    weights.set(coding.trim(),value===undefined?1:/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)?Number(value):0);
  }
  const identity=weights.get('identity')??(weights.get('*')===0?0:1),br=weights.get('br')??weights.get('*')??0;
  return {identity,br:br>0&&br>=(weights.get('identity')??0)};
}

export function staticAssets(directory){
  const root=resolve(directory);
  return async(req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    try{
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
      const original=await stat(file);if(!original.isFile()){res.writeHead(404);res.end();return;}
      const accepted=preferences(req.headers['accept-encoding']);let selected=file,metadata=original,encoding;
      if(accepted.br){
        const encoded=await stat(file+'.br').catch(error=>{if(error.code!=='ENOENT')throw error;});
        // A local rebuild may replace an original before its sidecar is ready.
        if(encoded?.isFile()&&encoded.mtimeMs>=original.mtimeMs){selected=file+'.br';metadata=encoded;encoding='br';}
      }
      res.setHeader('Vary','Accept-Encoding');
      if(!encoding&&accepted.identity===0){res.writeHead(406);res.end();return;}
      const headers={'Content-Type':types[extname(file)]??'application/octet-stream','Content-Length':metadata.size,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'};
      if(encoding)headers['Content-Encoding']=encoding;
      res.writeHead(200,headers);
      if(req.method==='HEAD'){res.end();return;}
      await pipeline(createReadStream(selected),res);
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      res.writeHead(error.code==='ENOENT'?404:error instanceof URIError?400:500);res.end('Build the client with pnpm build, or use the development server on port 5188.');
    }
  };
}
