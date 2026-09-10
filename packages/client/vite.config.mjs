import { defineConfig } from 'vite';
import strip from '@rollup/plugin-strip';
import {compositionCapture} from '../../tools/capture-plugin.mjs';
export default defineConfig({
  plugins:[compositionCapture(),{...strip({functions:['assert.*'],include:['**/*.js','**/*.mjs']}),apply:'build'}],
  server:{port:5188,strictPort:true,headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'},fs:{allow:['../..']},proxy:{'/multiplayer':{target:'ws://127.0.0.1:8787',ws:true}}},
  optimizeDeps:{exclude:['@woosh/meep-engine'],include:['dat.gui','opentype.js']},
  worker:{format:'es'},
  build:{target:'esnext',chunkSizeWarningLimit:3500},
});
