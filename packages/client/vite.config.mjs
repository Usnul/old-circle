import { defineConfig } from 'vite';
import strip from '@rollup/plugin-strip';
import {compositionCapture} from '../../tools/capture-plugin.mjs';
import {compressedAssets} from './precompress.mjs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {realpathSync,readdirSync,createReadStream} from 'node:fs';
const meepRoot=realpathSync(fileURLToPath(new URL('./node_modules/@woosh/meep-engine',import.meta.url))).replaceAll('\\','/');
const meepTextures=meepRoot+'/src/shade/assets/textures/';
// Vite 6's Windows /@fs static handler drops drive letters. Linked engine
// textures can be on a different drive from a worktree; serve only this manifest.
const nativeTextures={name:'native-engine-textures',configureServer(server){
  const files=new Map(readdirSync(meepTextures).filter(name=>name.endsWith('.bin')).map(name=>['/@fs/'+meepTextures+name,meepTextures+name]));
  server.middlewares.use((req,res,next)=>{const url=new URL(req.url,'http://localhost');if(['import','url','raw'].some(key=>url.searchParams.has(key)))return next();const file=files.get(decodeURI(url.pathname));if(!file)return next();res.setHeader('Content-Type','application/octet-stream');createReadStream(file).on('error',next).pipe(res);});
}};
export default defineConfig({
  plugins:[nativeTextures,{name:'canonical-world-map',buildStart(){execFileSync(process.execPath,['tools/generate-world-map.mjs'],{cwd:fileURLToPath(new URL('../..',import.meta.url)),stdio:'inherit',windowsHide:true});}},compositionCapture(),compressedAssets(),{...strip({functions:['assert.*'],include:['**/*.js','**/*.mjs']}),apply:'build'}],
  server:{port:5188,strictPort:true,headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'},fs:{allow:['../..',meepRoot]},proxy:{'/multiplayer':{target:'ws://127.0.0.1:8787',ws:true}}},
  optimizeDeps:{exclude:['@woosh/meep-engine'],include:['dat.gui','opentype.js']},
  worker:{format:'es'},
  build:{target:'esnext',chunkSizeWarningLimit:3500},
});
