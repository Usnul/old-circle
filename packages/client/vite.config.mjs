import { defineConfig } from 'vite';
import strip from '@rollup/plugin-strip';
import {compositionCapture} from '../../tools/capture-plugin.mjs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  plugins:[{name:'canonical-world-map',buildStart(){execFileSync(process.execPath,['tools/generate-world-map.mjs'],{cwd:fileURLToPath(new URL('../..',import.meta.url)),stdio:'inherit',windowsHide:true});}},compositionCapture(),{...strip({functions:['assert.*'],include:['**/*.js','**/*.mjs']}),apply:'build'}],
  server:{port:5188,strictPort:true,headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'},fs:{allow:['../..']},proxy:{'/multiplayer':{target:'ws://127.0.0.1:8787',ws:true}}},
  optimizeDeps:{exclude:['@woosh/meep-engine'],include:['dat.gui','opentype.js']},
  worker:{format:'es'},
  build:{target:'esnext',chunkSizeWarningLimit:3500},
});
