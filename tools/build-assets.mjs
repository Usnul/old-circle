import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const blender=process.env.BLENDER_PATH??'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
if(!existsSync(blender))throw new Error('Set BLENDER_PATH to your installed Blender executable.');
for(const [command,args] of [
  [process.execPath,['tools/export-world-layout.mjs']],
  [blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/blender/build_world.py']],
  [blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/blender/build_lods.py']],
  [blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/blender/build_characters.py']],
  [blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/blender/build_footprints.py']],
  [blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/blender/build_warnings.py']],
  [process.execPath,['tools/compile-assets.mjs']],
  [process.execPath,['tools/world-check.mjs','bake']],
  [process.execPath,['tools/bake-acoustics.mjs']],
  [process.execPath,['tools/generate-world-map.mjs']],
]){
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status??1);
}
