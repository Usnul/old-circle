import {LANDMARKS} from '@old-circle/game/world/regions.mjs';
import {COMPOSITION_VIEWS,compositionPoints} from '@old-circle/game/world/spatial-atlas.mjs';

/** Development-only composition controls; never connected to the shared world. */
export function installInspector({send,getView,getSnapshot,playerId}){
  const panel=document.createElement('aside');panel.className='inspector';panel.innerHTML=`<strong>World workshop</strong><select aria-label="Inspection location">${LANDMARKS.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select><button data-action="travel">Visit</button><button data-action="day">Day</button><button data-action="night">Night</button><button data-action="flow">Show occupancy / flow</button><button data-action="capture">Capture composition</button><output aria-live="polite"></output>`;document.body.append(panel);
  const output=panel.querySelector('output');let markers=[],flowVisible=false,messageUntil=0;
  for(const v of COMPOSITION_VIEWS){const option=document.createElement('option');option.value='view:'+v.id;option.textContent='Composition · '+v.label;panel.querySelector('select').append(option);}
  const freeze=document.createElement('button');freeze.textContent='Freeze simulation';let frozen=false;
  freeze.onclick=()=>{frozen=!frozen;send({type:'pause',paused:frozen});freeze.textContent=frozen?'Resume simulation':'Freeze simulation';};panel.insertBefore(freeze,output);
  panel.querySelector('[data-action=travel]').onclick=()=>{
    const selection=panel.querySelector('select').value,v=COMPOSITION_VIEWS.find(v=>'view:'+v.id===selection),view=getView();
    if(v){const {from}=compositionPoints(v);send({type:'inspect',position:[from[0],from[1]+.85,from[2]],time:v.time});view.yaw=v.yaw;view.pitch=v.pitch;view.distance=v.distance??5.8;}
    else send({type:'inspect',landmark:selection});view.cameraPosition=null;view.cameraLimit=null;
  };
  for(const [name,time] of [['day',15],['night',23]])panel.querySelector(`[data-action=${name}]`).onclick=()=>send({type:'inspect',time});
  panel.querySelector('[data-action=flow]').onclick=()=>{flowVisible=!flowVisible;for(const marker of markers)getView().remove(marker);markers=[];if(flowVisible){output.textContent='Sampling Meep navigation and collision surfaces…';send({type:'atlas'});}else output.textContent='';};
  panel.querySelector('[data-action=capture]').onclick=async()=>{
    const canvas=getView().engine.viewStack.el.querySelector('canvas');if(!canvas){output.textContent='No render surface';return;}
    const name=panel.querySelector('select').value.replace(':','-')+'-'+Date.now(),state=getSnapshot(),view=getView();
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob){output.textContent='Capture unavailable';return;}
    const response=await fetch(`/__capture/${name}.png`,{method:'POST',body:blob,headers:{'X-Capture-Metadata':JSON.stringify({camera:view.cameraPosition,yaw:view.yaw,pitch:view.pitch,tick:state.tick,time:state.time,player:state.actors.find(a=>a.id===playerId)})}});
    output.textContent=response.ok?`Saved .local/captures/${name}.png`:'Capture failed';
    messageUntil=performance.now()+6000;
  };
  return {
    onMessage(data){
      if(data.type!=='atlas')return;const p=getSnapshot().actors.find(a=>a.id===playerId),view=getView();
      for(const sample of data.samples.filter((s,i)=>i%2===0&&s.occupancy>.08&&Math.hypot(s.position[0]-p.x,s.position[2]-p.z)<45)){
        const spot=view.model('spell',sample.position,[sample.occupancy*1.7,.2,sample.occupancy*1.7]);markers.push(spot);
        const arrow=view.model('arrow');view.pose(arrow,sample.position,.8,Math.atan2(-sample.flow[3],-sample.flow[1]),-Math.PI/2);markers.push(arrow);
      }
      output.textContent=`${data.faces} nav faces · ${data.samples.length} occupancy samples · nine SH coefficients per sample`;
    },
    update(state){if(!flowVisible&&state&&performance.now()>messageUntil){const p=state.actors.find(a=>a.id===playerId);if(p)output.textContent=`${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} · HP ${p.hp.toFixed(0)} · tick ${state.tick}`;}}
  };
}
