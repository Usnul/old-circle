import {resolve} from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import {GameWorld} from '../packages/game/src/simulation/world.mjs';
import {SpatialAtlas,COMPOSITION_VIEWS,compositionPoints} from '../packages/game/src/world/spatial-atlas.mjs';
import {LANDMARKS,ROUTES,landmarkPosition} from '../packages/game/src/world/regions.mjs';

const args=process.argv.slice(2),mode=args[0]??'report',world=await new GameWorld().start({populate:false});
const point=name=>{if(LANDMARKS.some(l=>l.id===name))return landmarkPosition(name);const p=name?.split(',').map(Number);if(p?.length===3&&p.every(Number.isFinite))return p;throw new Error(`Unknown point '${name}'. Use ${LANDMARKS.map(l=>l.id).join(', ')} or x,y,z.`);};
try{
  if(mode==='los')console.log(JSON.stringify(new SpatialAtlas(world).visibility(point(args[1]),point(args[2])),null,2));
  else{
    const atlas=new SpatialAtlas(world).build();
    if(mode==='path'){const result=atlas.path(point(args[1]),point(args[2]));console.log(JSON.stringify(result,null,2));if(!result.reachable)process.exitCode=1;}
    else if(mode==='report'){
      const routes=ROUTES.map(([a,b])=>{const path=atlas.path(point(a),point(b));return {from:a,to:b,reachable:path.reachable,length:path.length,reason:path.reason};});
      const views=COMPOSITION_VIEWS.map(v=>{const {from,to}=compositionPoints(v);return {...v,...atlas.visibility(from,to,{targetHeight:0})};});
      const result={schema:1,spacing:atlas.spacing,faces:atlas.faceCount,routes,views,heatmap:atlas.samples,notes:'Sampled ground navigation; roof/interior layers require separately authored surfaces. Visibility uses gameplay collision BVHs.'};
      const output=resolve(args[1]??'.local/world-report.json');await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(result));
      console.table(routes);console.log(`${atlas.faceCount} navigation faces, ${atlas.samples.length} 3D occupancy/SH flow samples. Report: ${output}`);
      if(routes.some(r=>!r.reachable))process.exitCode=1;
      if(views.some(v=>v.visibleFraction<2/3))process.exitCode=1;
    }else throw new Error('Usage: world-check.mjs [report [output.json] | path from to | los from to]');
  }
}finally{await world.stop();}
