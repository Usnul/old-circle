import {MAP_SIZE,worldToMap} from '@old-circle/game/world/map.mjs';
import {REGIONS,LANDMARKS,HEARTHS} from '@old-circle/game/world/regions.mjs';
import {BOSSES} from '@old-circle/game/content/catalog.mjs';
import {RELICS} from '@old-circle/game/content/relics.mjs';
import {clamp} from '@woosh/meep-engine/src/core/math/clamp.js';

const PLAYER_ZOOM=2.5;
// Keep the explored view when the map is rebuilt during this journey.
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
  return `<div class="panel-top"><h2>World map</h2><button class="close" aria-label="Close">×</button></div>
    <div class="map-toolbar"><button class="subtle" id="map-out" aria-label="Zoom out">−</button><button class="subtle" id="map-in" aria-label="Zoom in">+</button><button class="subtle" id="map-you">Center on player</button><button class="subtle" id="map-all">Show whole map</button><span>North ↑ · Drag or arrow keys to pan</span></div>
    <svg class="map terrain-map" id="world-map" viewBox="0 0 ${MAP_SIZE.join(' ')}" role="img" aria-label="World map. North is up. Gold dots are kindled hearths; rings are landmarks; diamonds are dungeons. Filled landmarks and dungeons have recovered seals or relics. The white ring is your position."><image href="/assets/map/world.svg" width="${MAP_SIZE[0]}" height="${MAP_SIZE[1]}"/>${names}${places}${fires}<g id="map-player" transform="translate(${x} ${y})"><circle r="3.7" fill="#fff8e5" stroke="#1c2c23" stroke-width="1"/><circle r="7" fill="none" stroke="#fff8e5" stroke-width=".7"/></g></svg>
    <div class="map-legend" aria-label="Map legend"><span><i class="map-key player" aria-hidden="true"></i>You</span><span><i class="map-key hearth" aria-hidden="true"></i>Kindled hearth</span><span><i class="map-key" aria-hidden="true"></i>Landmark</span><span><i class="map-key dungeon" aria-hidden="true"></i>Dungeon</span><span>Filled landmark / dungeon: seal / relic recovered</span></div>`;
}

export function installMapControls(getPlayer){
  const svg=document.querySelector('#world-map'),[width,height]=MAP_SIZE,player=getPlayer();
  let {zoom,center}=savedView??{zoom:PLAYER_ZOOM,center:worldToMap(player.x,player.z)},drag;
  const viewport=()=>{
    const rect=svg.getBoundingClientRect(),ready=rect.width>0&&rect.height>0;
    const viewportWidth=ready?rect.width:width,viewportHeight=ready?rect.height:height;
    // At zoom 1 the whole world fits; closer views use the full viewport aspect.
    const scale=Math.min(viewportWidth/width,viewportHeight/height)*zoom;
    return {w:viewportWidth/scale,h:viewportHeight/scale,scale};
  };
  const update=()=>{
    const {w,h,scale}=viewport();
    center=center.map((value,i)=>{const size=[w,h][i],extent=MAP_SIZE[i];return size>=extent?extent/2:clamp(value,size/2,extent-size/2);});
    savedView={zoom,center};
    svg.setAttribute('viewBox',`${center[0]-w/2} ${center[1]-h/2} ${w} ${h}`);
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
  svg.onpointermove=e=>{if(!drag||e.pointerId!==drag.pointerId)return;const {scale}=viewport();center=[drag.center[0]-(e.clientX-drag.x)/scale,drag.center[1]-(e.clientY-drag.y)/scale];update();};
  svg.onpointerup=svg.onpointercancel=svg.onlostpointercapture=e=>{if(e.pointerId===drag?.pointerId)drag=null;};
  svg.setAttribute('tabindex','0');svg.onkeydown=e=>{const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},d=directions[e.key];if(d){e.preventDefault();center=center.map((v,i)=>v+d[i]*30/zoom);update();}};update();
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{drag=null;update();});
  observer?.observe(svg);
  return ()=>{observer?.disconnect();drag=null;};
}
