import {MAP_SIZE,worldToMap} from '@old-circle/game/world/map.mjs';
import {REGIONS,LANDMARKS,HEARTHS} from '@old-circle/game/world/regions.mjs';
import {BOSSES} from '@old-circle/game/content/catalog.mjs';
import {RELICS} from '@old-circle/game/content/relics.mjs';

const PLAYER_ZOOM=2.5;
// Keep the explored view when the map dialog is rebuilt during this journey.
let savedView;

export function worldMapMarkup(player){
  const [x,y]=worldToMap(player.x,player.z);
  const names=REGIONS.map(r=>{const [x,y]=worldToMap(...r.center);return `<text class="map-region" x="${x}" y="${y+23}" text-anchor="middle">${r.name}</text>`;}).join('');
  const places=LANDMARKS.filter(l=>l.kind!=='hearth').map(l=>{
    const [x,y]=worldToMap(l.position[0],l.position[2]),boss=Object.values(BOSSES).find(b=>b.landmark===l.id),relic=RELICS.find(r=>r.dungeon===l.id),done=boss?player.seals.includes(boss.seal):relic&&(player.relics??[]).includes(relic.id);
    const marker=l.kind==='dungeon'?`<path d="M${x} ${y-4}l4 4-4 4-4-4Z"`:`<circle cx="${x}" cy="${y}" r="3"`;
    return `<g class="map-place"><title>${l.name}${done?relic?' · Relic recovered':' · Seal recovered':''}</title>${marker} fill="${done?'#e6c984':'#233830'}" stroke="#e6c984" stroke-width=".7"/><text x="${x}" y="${y-7}" text-anchor="middle">${l.name}</text></g>`;
  }).join('');
  const fires=HEARTHS.filter(h=>player.hearths.includes(h.id)).map(h=>{const [x,y]=worldToMap(h.position[0],h.position[2]);return `<g><title>${h.name}${h.id===player.checkpointId?' · Return point':''}</title><circle cx="${x}" cy="${y}" r="${h.id===player.checkpointId?4:2.5}" fill="#e6c984" stroke="#233830" stroke-width="1"/></g>`;}).join('');
  return `<div class="panel-top"><div><div class="eyebrow">The known lands</div><h2>All roads turn inward</h2></div><button class="close" aria-label="Close">×</button></div>
    <div class="map-toolbar"><button class="subtle" id="map-out" aria-label="Zoom out">−</button><button class="subtle" id="map-in" aria-label="Zoom in">+</button><button class="subtle" id="map-you">Find me</button><button class="subtle" id="map-all">All lands</button><span>North ↑ · Drag to explore</span></div>
    <svg class="map terrain-map" id="world-map" viewBox="0 0 ${MAP_SIZE.join(' ')}" role="img" aria-label="Terrain map of Old Circle. North is up. Gold dots are kindled hearths; rings are landmarks; diamonds are dungeons; the white pointer is your position."><image href="/assets/map/world.svg" width="${MAP_SIZE[0]}" height="${MAP_SIZE[1]}"/>${names}${places}${fires}<g id="map-player" transform="translate(${x} ${y})"><circle r="3.7" fill="#fff8e5" stroke="#1c2c23" stroke-width="1"/><circle r="7" fill="none" stroke="#fff8e5" stroke-width=".7"/></g></svg>
    <p>Gold dots mark your kindled hearths. Filled keeper rings mark recovered seals. Diamonds mark dungeons and fill when their relic is recovered.<br>Relief and contours show the slopes; pale lines follow the actual roads. Scale: the full map spans 480 × 640 metres.</p>`;
}

export function installMapControls(getPlayer){
  const svg=document.querySelector('#world-map'),[width,height]=MAP_SIZE,player=getPlayer();
  let {zoom,center}=savedView??{zoom:PLAYER_ZOOM,center:worldToMap(player.x,player.z)},drag;
  const update=()=>{
    const w=width/zoom,h=height/zoom;
    center=[Math.max(w/2,Math.min(width-w/2,center[0])),Math.max(h/2,Math.min(height-h/2,center[1]))];
    savedView={zoom,center};
    svg.setAttribute('viewBox',`${center[0]-w/2} ${center[1]-h/2} ${w} ${h}`);
    const rect=svg.getBoundingClientRect(),scale=Math.min(rect.width/w,rect.height/h);
    svg.style.setProperty('--map-label',`${12/scale}px`);svg.classList.toggle('map-close',zoom>1.5);
  };
  document.querySelector('#map-in').onclick=()=>{zoom=Math.min(4,zoom*1.5);update();};
  document.querySelector('#map-out').onclick=()=>{zoom=Math.max(1,zoom/1.5);update();};
  document.querySelector('#map-all').onclick=()=>{zoom=1;update();};
  document.querySelector('#map-you').onclick=()=>{const player=getPlayer();zoom=PLAYER_ZOOM;center=worldToMap(player.x,player.z);update();};
  svg.onpointerdown=e=>{
    if(e.button!==0||drag)return;
    e.preventDefault();svg.focus({preventScroll:true});
    drag={pointerId:e.pointerId,x:e.clientX,y:e.clientY,center};svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove=e=>{if(!drag||e.pointerId!==drag.pointerId)return;const rect=svg.getBoundingClientRect(),scale=Math.min(rect.width/(width/zoom),rect.height/(height/zoom));center=[drag.center[0]-(e.clientX-drag.x)/scale,drag.center[1]-(e.clientY-drag.y)/scale];update();};
  svg.onpointerup=svg.onpointercancel=svg.onlostpointercapture=e=>{if(e.pointerId===drag?.pointerId)drag=null;};
  svg.setAttribute('tabindex','0');svg.onkeydown=e=>{const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},d=directions[e.key];if(d){e.preventDefault();center=center.map((v,i)=>v+d[i]*30/zoom);update();}};update();
}
