import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export function compositionCapture(){return {name:'old-circle-composition-capture',apply:'serve',configureServer(server){
  server.middlewares.use(async(req,res,next)=>{
    const match=/^\/__capture\/([a-z0-9-]+)\.png$/.exec(req.url??'');if(req.method!=='POST'||!match)return next();
    const chunks=[];let length=0;
    try{
      for await(const chunk of req){length+=chunk.length;if(length>12*1024*1024)throw new Error('Capture exceeds 12 MiB');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Expected PNG');
      const metadata=JSON.parse(req.headers['x-capture-metadata']??'{}'),folder=resolve(import.meta.dirname,'../.local/captures');await mkdir(folder,{recursive:true});
      await writeFile(resolve(folder,match[1]+'.png'),bytes);await writeFile(resolve(folder,match[1]+'.json'),JSON.stringify(metadata,null,2));res.writeHead(201);res.end('Captured');
    }catch(error){res.writeHead(400);res.end(error.message);}
  });
}};}
