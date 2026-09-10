import './ui/style.scss';
import { ORIGINS,WEAPONS,BOSSES,levelCost } from '@old-circle/game/content/catalog.mjs';
import { LANDMARKS,HEARTHS,regionAt } from '@old-circle/game/world/regions.mjs';
import {restStatus} from '@old-circle/game/simulation/resting.mjs';
import {GameInput} from './input.mjs';
import {compassMarkup,updateCompass} from './ui/compass.mjs';
import {worldMapMarkup,installMapControls} from './ui/world-map.mjs';
import {worldToMap} from '@old-circle/game/world/map.mjs';
import {equipmentMarkup} from './ui/equipment.mjs';
import {ARMOR,armorFor,reinforcement,hasAllSeals} from '@old-circle/game/content/equipment.mjs';
import {BOSS_MOVES,bossEnraged} from '@old-circle/game/content/boss-moves.mjs';

const app=document.querySelector('#app');
const SAVE_KEY='old-circle-character-v1';
const inspecting=import.meta.env.DEV&&new URLSearchParams(location.search).has('inspect');let inspector;
const playerId=localStorage.getItem('old-circle-id')??crypto.randomUUID();localStorage.setItem('old-circle-id',playerId);
let view=null,worker=null,snapshot=null,started=false,menu=false,origin='pilgrim',lastArea='',areaTimer,toastTimer,lastHud=0;
let input=null,equipmentOpen=false,completionPending=false,journalPending=false;
function saved(){try{return JSON.parse(localStorage.getItem(SAVE_KEY));}catch{return null;}}
app.innerHTML=`
<section class="screen title-screen" id="title">
  <header class="masthead"><span class="wordmark">Old Circle</span><span class="top-note">A world that remembers</span></header>
  <div class="title-content"><div class="sigil" aria-hidden="true"></div><div class="eyebrow">An open-world dark fantasy</div><h1>OLD<br>CIRCLE</h1><p class="subtitle">The light has faded.<br>The road still calls.</p><div class="rule"></div><button class="primary" id="begin"><span>${saved()?'Continue your journey':'Begin your journey'}</span><span>⟶</span></button><button class="menu-link" id="new-journey">${saved()?'Begin anew':'Choose your beginning'}</button><button class="menu-link" id="controls-menu">How to play</button></div>
  <footer class="title-footer"><div><strong>One world. Many wanderers.</strong>Walk alone, or find your way together.</div><div class="coordinates"><strong>The Waking Fields</strong>Where every circle begins</div><div>Built with <strong style="display:inline;letter-spacing:.1em">MEEP</strong><br>Early playable build · WebGPU</div></footer>
</section>
<section class="screen loading" id="loading" hidden><div><div class="sigil"></div><div class="eyebrow">Old Circle</div><h2 id="loading-text">The road awaits.</h2><div class="loading-bar"><div id="loading-progress"></div></div><p>Every ending leaves a path.</p></div></section>
<section class="hud" id="hud" hidden>
 <div class="vitals"><div class="crest">◌</div><div class="bars"><div class="bar"><span id="health"></span></div><div class="bar mana"><span id="mana"></span></div><div class="bar stamina"><span id="stamina"></span></div></div></div>
 <div id="stamina-state" class="stamina-state" role="status"></div><div class="compass">${compassMarkup()}</div>
 <div class="world-status"><div class="mode" id="network-state">Solo journey</div><div id="daytime">Evening · The Waking Fields</div><div id="pvp-state">PvP off</div></div>
 <div class="area-title" id="area-title"><div class="eyebrow" id="area-level"></div><h2 id="area-name"></h2></div>
 <div class="weapon-name" id="weapon-name"></div><div class="quickbar">${Object.entries(WEAPONS).map(([id,w],i)=>`<button class="slot" data-weapon="${id}" title="${w.name}"><kbd>${i+1}</kbd><img src="/assets/icons/${w.icon}.png" alt="${w.name}"></button>`).join('')}<button class="slot" id="flask" title="Drink healing flask"><kbd>R</kbd><img src="/assets/icons/flask.png" alt="Healing flask"><span class="count" id="flask-count">3</span></button></div>
 <div class="embers" id="embers">0</div><div class="hint" id="interact" hidden><kbd>E</kbd>Rest at the Pilgrim’s Hearth</div><div class="controls">WASD move · Shift sprint · C crouch · Space jump / mantle · Click attack · Q frost nova · R heal · Tab journal</div>
 <div class="boss" id="boss" hidden><div class="boss-name" id="boss-name"></div><div class="bar"><span id="boss-health"></span></div><div id="boss-move" class="boss-move" role="status"></div></div><div class="toast" id="toast"></div><div class="death" id="death" hidden>LIGHT FADES</div>
</section><button id="capture-mouse" hidden>Resume mouse look <span>Click to capture · Escape releases</span></button><div id="modal-root"></div>`;

const $=s=>document.querySelector(s),send=data=>worker?.postMessage(data);
function modal(content){menu=true;input?.suspend(true);send({type:'pause',paused:true});$('#modal-root').innerHTML=`<div class="modal"><section class="panel">${content}</section></div>`;$('#modal-root .close')?.addEventListener('click',closeModal);}
function closeModal(){menu=false;equipmentOpen=false;input?.suspend(false);$('#modal-root').innerHTML='';send({type:'pause',paused:false});if(started){view?.engine.viewStack.el.focus();input?.capture();}}
function chooseOrigin(){modal(`<div class="panel-top"><div><div class="eyebrow">A life before the road</div><h2>Choose your beginning</h2></div><button class="close" aria-label="Close">×</button></div><p>Your past gives you equipment and attributes. Your journey is yours to shape.</p><div class="origins">${ORIGINS.map(o=>`<button class="origin ${o.id===origin?'selected':''}" data-origin="${o.id}"><img src="/assets/icons/${WEAPONS[o.weapon].icon}.png" alt=""><span class="origin-name">${o.name}</span><p>${o.description}</p><div class="origin-stat">Vigor ${o.stats.vigor} · Endurance ${o.stats.endurance}<br>Might ${o.stats.might} · Insight ${o.stats.insight}</div></button>`).join('')}</div><div class="button-row"><span class="eyebrow">No classes. No fixed path.</span><button class="primary" id="enter"><span>Enter the circle</span><span>⟶</span></button></div>`);for(const b of document.querySelectorAll('[data-origin]'))b.onclick=()=>{origin=b.dataset.origin;document.querySelectorAll('[data-origin]').forEach(x=>x.classList.toggle('selected',x===b));};$('#enter').onclick=()=>{closeModal();start(null);};}
function controls(){modal(`<div class="panel-top"><div><div class="eyebrow">The wanderer’s guide</div><h2>Learn the road</h2></div><button class="close" aria-label="Close">×</button></div><div class="help-grid">${[['Walk','W A S D'],['Look','Mouse / arrow keys'],['Sprint / release after exhaustion','Shift'],['Crouch / stealth','C'],['Jump / grab / climb','Space'],['Weapon attack','Left click'],['Frost nova','Q'],['Healing flask','R'],['Rest at hearth','E'],['Change equipment','1 – 4'],['Journal / map','Tab / M'],['Release mouse','Escape']].map(([a,b])=>`<div>${a}<kbd>${b}</kbd></div>`).join('')}</div><p>Click the world to look around. If the cursor cannot be captured, hold near a screen edge to keep turning. Arrow keys also turn the camera.</p><p>Attacks connect where the weapon meets the body. Watch enemy wind-ups, conserve stamina, and use the terrain. Release Space to hang at a ledge; Space climbs and C drops. The hearth restores your flasks and lets you improve your attributes. Other wanderers can join a boss battle already in progress.</p><p>Multiplayer requires the local server. If the connection goes away, your journey continues in the browser.</p>`);}
$('#begin').onclick=()=>saved()?start(saved()):chooseOrigin();$('#new-journey').onclick=chooseOrigin;$('#controls-menu').onclick=controls;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
async function start(character){
  $('#title').hidden=true;$('#loading').hidden=false;
  try{
    if(!navigator.gpu)throw new Error('Old Circle requires WebGPU. Open this game in a WebGPU-capable desktop browser.');
    const {WorldView}=await import('./render/scene.mjs');view=new WorldView();if(Number.isFinite(character?.motion?.yaw))view.yaw=character.motion.yaw;
    await view.start((text,p)=>{$('#loading-text').textContent=text;$('#loading-progress').style.width=`${p*100}%`;});
    input=await new GameInput(view.engine,{
      action:name=>{if(!started)return;if(['journal','map','escape'].includes(name)){menu?closeModal():name==='map'?map():journal();}else send({type:'equip',weapon:name});},
      look:(x,y)=>{view.yaw-=x*.0025;view.pitch=Math.max(-.45,Math.min(.95,view.pitch+y*.002));},
      captureChanged:locked=>{$('#capture-mouse').hidden=locked||menu||!started;},error:toast,inspect:inspecting
    }).start();
    $('#capture-mouse').onclick=()=>input.capture();
    worker=new Worker(new URL('./simulation.worker.mjs',import.meta.url),{type:'module'});
    worker.onerror=e=>showError(e.message);
    worker.onmessage=({data})=>{
      if(data.type==='foot-surfaces'){view.footsteps.accept(data);return;}
      inspector?.onMessage(data);
      if(data.type==='camera'){view.cameraLimit=data.distance;view.shelter=data.shelter;return;}
      if(data.type==='network-status'){$('#network-state').title=data.message;return;}
      if(data.type==='error'){showError(data.message);return;}
      if(data.type==='save'){if(!inspecting)localStorage.setItem(SAVE_KEY,JSON.stringify(data.character));return;}
      if(data.snapshot){snapshot=data.snapshot;view.acceptSnapshot(snapshot);$('#network-state').textContent=data.mode==='online'?'Shared world':'Solo journey';for(const e of snapshot.events??[])if(e.id===playerId){if(e.type==='boss-defeated')toast(`${e.name} is at rest. +${e.reward} embers`);if(e.type==='rest')toast(`Restored at ${e.name}`);if(e.type==='equipment-found')toast('Found '+WEAPONS[e.weapon].name);}}
      if(data.type==='level-result'){journalPending=false;toast(data.ok?'Your strength takes root.':'Find a safe hearth and enough embers to grow.');if(menu)refreshJournal();return;}
      if(data.type==='equipment-result'){toast(data.ok?'Your equipment is ready.':'This change needs a safe hearth and the required embers or seals.');if(equipmentOpen)equipment();return;}
      if(data.snapshot)for(const e of data.snapshot.events??[])if(e.id===playerId){
        if(e.type==='armor-found')toast(`Recovered ${ARMOR[e.armor].name}. Change armor at a hearth.`);
        if(e.type==='circle-completed'){completionPending=true;send({type:'save'});}
      }
      if(data.type==='ready'){$('#loading').hidden=true;$('#hud').hidden=false;started=true;$('#capture-mouse').hidden=inspecting;requestAnimationFrame(frame);view.engine.viewStack.el.focus();}
    };
    if(inspecting){const {installInspector}=await import('./inspector.mjs');inspector=installInspector({send,getView:()=>view,getSnapshot:()=>snapshot,playerId});}
    send({type:'start',origin:character?.origin??origin,saved:inspecting?null:character,playerId,inspect:inspecting,url:inspecting?null:`${location.protocol==='https:'?'wss':'ws'}://${location.host}/multiplayer`});
    setInterval(()=>send({type:'save'}),8000);
  }catch(e){showError(e.stack??String(e));}
}
function showError(message){$('#loading').hidden=true;modal(`<div class="panel-top"><div><div class="eyebrow">The road is interrupted</div><h2>Unable to enter the world</h2></div></div><p>The engine reported the following error.</p><pre class="error-detail"></pre><button class="primary" id="reload"><span>Return to the beginning</span><span>⟶</span></button>`);$('.error-detail').textContent=message;$('#reload').onclick=()=>location.reload();}
function journal(){
  equipmentOpen=false;
  const p=snapshot?.actors.find(a=>a.id===playerId);if(!p)return;
  const rest=restStatus(p,snapshot.actors),checkpoint=HEARTHS.find(h=>h.id===p.checkpointId)??HEARTHS[0],cost=levelCost(p.level);
  const benefits={vigor:'+5 health',endurance:'+3 stamina',might:'Stronger melee and arrows',insight:'+4 focus, stronger spells and arrows'};
  modal(`<div class="panel-top"><div><div class="eyebrow">The wanderer’s journal</div><h2>Your place in the circle</h2></div><button class="close" aria-label="Close">×</button></div><div class="eyebrow" id="journal-progress">Level ${p.level} · ${p.embers} embers · ${p.seals.length} / 6 seals</div><div class="stats-grid">${Object.entries(p.stats).map(([name,n])=>`<div class="stat-row"><span>${name[0].toUpperCase()+name.slice(1)}<small>${benefits[name]}</small></span><span><span data-stat-value="${name}">${n}</span> <button data-stat="${name}" aria-label="Improve ${name}" title="${rest.reason??(p.embers<cost?'Not enough embers':benefits[name])}" ${rest.reason||p.embers<cost?'disabled':''}>+</button></span></div>`).join('')}</div><p>${p.inventory.arrows} arrows · ${armorFor(p).name}</p><p id="growth-status" role="status" aria-live="polite"></p><p>Return point: <strong>${checkpoint.name}</strong><br>${p.hearths?.length??1} of ${HEARTHS.length} hearths kindled. Rest at a hearth to remember it.</p><div class="button-row"><button class="subtle" id="show-equipment">Equipment & forge</button><button class="subtle" id="show-map">World map</button><button class="subtle" id="toggle-pvp">PvP ${p.pvp?'on':'off'} — ${p.pvp?'disable':'enable'}</button><button class="subtle" id="save-game">Save journey</button></div><div class="seal-list">${Object.values(BOSSES).map(b=>`<div class="${p.seals.includes(b.seal)?'recovered':''}"><span>${p.seals.includes(b.seal)?'✦':'○'} ${b.seal}</span><small>${b.name}</small></div>`).join('')}</div>${hasAllSeals(p)?'<button class="subtle" id="read-ending">The circle is broken · Read the ending</button>':''}`);
  document.querySelectorAll('[data-stat]').forEach(b=>b.onclick=()=>{journalPending=true;refreshJournal();send({type:'level',stat:b.dataset.stat});});$('#show-equipment').onclick=equipment;$('#read-ending')?.addEventListener('click',ending);$('#show-map').onclick=map;$('#toggle-pvp').onclick=()=>{send({type:'pvp',enabled:!p.pvp});p.pvp=!p.pvp;journal();};$('#save-game').onclick=()=>{send({type:'save'});closeModal();toast('Your journey is remembered.');};refreshJournal();
}
function refreshJournal(){
  if(!$('#journal-progress'))return;
  const p=snapshot?.actors.find(a=>a.id===playerId);if(!p)return;
  const rest=restStatus(p,snapshot.actors),cost=levelCost(p.level),reason=rest.reason??(p.embers<cost?`You need ${cost-p.embers} more embers.`:null);
  $('#journal-progress').textContent=`Level ${p.level} · ${p.embers} embers · ${p.seals.length} / 6 seals`;
  const status=journalPending?'Remembering your improvement…':`Next improvement: ${cost} embers. ${reason??`Ready at ${rest.hearth.name}. Choose an attribute to improve.`}`;
  if($('#growth-status').textContent!==status)$('#growth-status').textContent=status;
  document.querySelectorAll('[data-stat]').forEach(b=>{b.disabled=journalPending||!!reason;b.title=reason??`Spend ${cost} embers to improve ${b.dataset.stat}`;});
  document.querySelectorAll('[data-stat-value]').forEach(el=>el.textContent=p.stats[el.dataset.statValue]);
}
function equipment(){
  const p=snapshot?.actors.find(a=>a.id===playerId);if(!p)return;
  modal(equipmentMarkup(p,restStatus(p,snapshot.actors)));equipmentOpen=true;
  const request=(type,item)=>{document.querySelectorAll('[data-armor],[data-reinforce]').forEach(b=>b.disabled=true);send({type,item});};
  document.querySelectorAll('[data-armor]').forEach(b=>b.onclick=()=>request('armor',b.dataset.armor));
  document.querySelectorAll('[data-reinforce]').forEach(b=>b.onclick=()=>request('reinforce',b.dataset.reinforce));
  document.querySelectorAll('[data-equip]').forEach(b=>b.onclick=()=>{send({type:'equip',weapon:b.dataset.equip});closeModal();});
  $('#back-journal').onclick=journal;
}
function ending(){
  equipmentOpen=false;completionPending=false;
  modal(`<div class="ending"><div class="sigil" aria-hidden="true"></div><div class="eyebrow">Six keepers at rest</div><h2>The circle is broken</h2><p>At the highest hearth, the last bell falls silent.<br>The king's vigil ends. The sun belongs to the road again.</p><p>Dawn. Root. Ash. Star. Frost. Circle.<br>Six vows carried by a wanderer who chose to keep walking.</p><div class="rule"></div><p>Your seals, equipment and kindled hearths remain. There are still roads to revisit, builds to try, and wanderers who need a companion.</p><button class="primary" id="continue-road">Walk the road again ⟶</button></div>`);
  $('#continue-road').onclick=closeModal;
}
function map(){
  const p=snapshot?.actors.find(a=>a.id===playerId);if(!p)return;
  equipmentOpen=false;modal(worldMapMarkup(p));installMapControls(()=>snapshot.actors.find(a=>a.id===playerId));
}
for(const b of document.querySelectorAll('[data-weapon]'))b.onclick=()=>send({type:'equip',weapon:b.dataset.weapon});$('#flask').onclick=()=>input?.pulse('heal');
let previous=performance.now();
function frame(now){
  const dt=Math.min(.1,(now-previous)/1000);previous=now;
  if(!menu){
    input.update(dt);send({type:'input',intent:input.sample(view.yaw)});
  }
  const player=snapshot?.actors.find(a=>a.id===playerId),next=player&&Object.values(BOSSES).find(b=>!player.seals.includes(b.seal));
  if(player&&completionPending&&player.hp>0&&player.attackAge<0)ending();
  if(player)updateCompass(view.yaw,player,next&&LANDMARKS.find(l=>l.id===next.landmark));
  view.queryFootSurfaces=send;view.update(snapshot,playerId,dt);if(now-lastHud>80){updateHud();inspector?.update(snapshot);if(view.wantedCamera)send({type:'camera',from:view.cameraTarget,position:view.wantedCamera});lastHud=now;}requestAnimationFrame(frame);
}
function updateHud(){
  const p=snapshot?.actors.find(a=>a.id===playerId);if(!p)return;
  if(menu)refreshJournal();
  $('#map-player')?.setAttribute('transform',`translate(${worldToMap(p.x,p.z).join(' ')})`);
  $('#stamina-state').textContent=p.sprintExhausted?'Recover stamina and release Shift to sprint again':'';
  for(const [id,v,m] of [['health',p.hp,p.healthMax],['mana',p.mana,p.manaMax],['stamina',p.stamina,p.staminaMax]])$(`#${id}`).style.width=`${Math.max(0,v/m*100)}%`;
  $('#embers').textContent=Math.floor(p.embers).toLocaleString();$('#flask-count').textContent=p.flasks;$('#weapon-name').textContent=WEAPONS[p.weapon].name+(reinforcement(p)?' +'+reinforcement(p):'');
  document.querySelectorAll('[data-weapon]').forEach(b=>{b.classList.toggle('active',b.dataset.weapon===p.weapon);b.disabled=!p.inventory.weapons.includes(b.dataset.weapon);b.title=b.disabled?'Find this weapon on your journey':WEAPONS[b.dataset.weapon].name;});
  const region=regionAt(p.x,p.z),hour=snapshot.time;$('#daytime').textContent=`${hour<6||hour>=18?'Night':hour>16?'Evening':'Day'} · ${region.name}`;$('#pvp-state').textContent=`PvP ${p.pvp?'on':'off'}`;
  const next=Object.values(BOSSES).find(b=>!p.seals.includes(b.seal));$('#objective').textContent=next?LANDMARKS.find(l=>l.id===next.landmark).name.toUpperCase():'THE CIRCLE IS BROKEN';
  if(lastArea!==region.id){lastArea=region.id;$('#area-name').textContent=region.name;$('#area-level').textContent=`Recommended level ${region.level.join('–')}`;$('#area-title').style.opacity=1;clearTimeout(areaTimer);areaTimer=setTimeout(()=>$('#area-title').style.opacity=0,5500);}
  const rest=restStatus(p,snapshot.actors);$('#interact').hidden=!rest.hearth;
  if(rest.hearth)$('#interact').innerHTML=rest.reason??`<kbd>E</kbd>Rest at ${rest.hearth.name}`;
  $('#death').hidden=p.hp>0;
  const boss=snapshot.actors.find(a=>a.boss&&a.hp>0&&Math.hypot(a.x-p.x,a.z-p.z)<25);$('#boss').hidden=!boss;if(boss){$('#boss-name').textContent=boss.name;$('#boss-health').style.width=`${boss.hp/boss.healthMax*100}%`;$('#boss-move').textContent=boss.windup>0?BOSS_MOVES[boss.bossMove]?.name??'':bossEnraged(boss)?'The keeper’s vow breaks':'';}
}
