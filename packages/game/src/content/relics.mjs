import {DUNGEONS,dungeonPoint} from '../world/dungeons.mjs';
export const RELICS=DUNGEONS.map(d=>({...d.treasure,dungeon:d.id,position:dungeonPoint(d,d.treasure.at)}));
export const knownRelics=ids=>[...new Set(Array.isArray(ids)?ids.filter(id=>RELICS.some(r=>r.id===id)):[])];
export const flaskCapacity=a=>3+RELICS.reduce((n,r)=>n+((a.relics??[]).includes(r.id)?r.flasks??0:0),0);
export function nearbyRelic(a){return a.hp>0?RELICS.find(r=>!(a.relics??[]).includes(r.id)&&Math.hypot(a.x-r.position[0],a.y-r.position[1]-.85,a.z-r.position[2])<2.2):null;}
