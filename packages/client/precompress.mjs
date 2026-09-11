import {readFile,readdir,writeFile,unlink,rename} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {brotliCompress,constants} from 'node:zlib';
import {promisify} from 'node:util';

const compress=promisify(brotliCompress);
const extensions=new Set(['.html','.js','.css','.json','.svg','.meep','.bin']);
/** Transfer encoding only: browsers still receive the exact native asset bytes. */
export async function precompress(directory){
  const totals={files:0,original:0,encoded:0};
  async function visit(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const file=join(folder,entry.name);
      if(entry.isDirectory()){await visit(file);continue;}
      if(!entry.isFile()||!extensions.has(extname(file)))continue;
      const bytes=await readFile(file),encoded=bytes.length>=1024?await compress(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}):null;
      if(encoded&&encoded.length<bytes.length*.98){
        const temporary=file+`.br.${process.pid}.tmp`;
        try{await writeFile(temporary,encoded);await rename(temporary,file+'.br');}
        finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
        totals.files++;totals.original+=bytes.length;totals.encoded+=encoded.length;
      }else await unlink(file+'.br').catch(error=>{if(error.code!=='ENOENT')throw error;});
    }
  }
  await visit(directory);return totals;
}

export function compressedAssets(){
  let directory,write;
  return {name:'old-circle-precompressed-assets',apply:'build',
    configResolved(config){directory=resolve(config.root,config.build.outDir);write=config.build.write;},
    async closeBundle(){
      if(write===false)return;
      const totals=await precompress(directory);
      console.log(`Precompressed ${totals.files} assets: ${(totals.original/1048576).toFixed(1)} → ${(totals.encoded/1048576).toFixed(1)} MiB transferred with Brotli.`);
    },
  };
}
