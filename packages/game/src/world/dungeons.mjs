// Authored metres: local X runs east, N runs north. Floor surfaces, Blender
// masonry, encounter placement and layered navigation share these definitions.
export const DUNGEONS=[{
  id:'reliquary',name:'The Bellkeeper’s Reliquary',region:'meadow',origin:[38,-48],elevation:4.3,
  rooms:[
    {id:'vestibule',name:'The Unlit Vestibule',rect:[-6,0,6,10],level:0,roof:false},
    {id:'burial',name:'Hall of Quiet Bells',rect:[-18,4,-6,14],level:0,roof:true},
    {id:'chapter',name:'The Broken Chapter',rect:[-6,10,6,22],level:0,roof:true},
    {id:'ascent',name:'The Watcher’s Stair',rect:[-18,14,-14,30],level:0,rise:4.8,roof:false},
    {id:'gallery',name:'The Returning Gallery',rect:[-18,30,6,34],level:4.8,roof:false},
    {id:'relic',name:'The Lantern Chamber',rect:[-6,14,6,30],level:4.8,roof:true},
    {id:'bridge',name:'The Bell Walk',rect:[-2,0,2,14],level:4.8,roof:false},
  ],
  partitions:[
    {a:[-6,4],b:[-6,10],level:0,door:[7,3]},
    {a:[-6,10],b:[6,10],level:0,door:[0,3.6]},
    {a:[-6,22],b:[6,22],level:4.8,door:[0,3.6]},
  ],
  openings:[{a:[-2,0],b:[2,0],level:0},{a:[-2,0],b:[2,0],level:4.8}],
  entrance:[0,-10],exit:[0,0,4.8],
  connections:[
    ['entry','vestibule',[0,0,0]],['vestibule','burial',[-6,7,0]],
    ['vestibule','chapter',[0,10,0]],['burial','chapter',[-6,12,0]],
    ['burial','ascent',[-16,14,0]],['ascent','gallery',[-16,30,4.8]],
    ['gallery','relic',[0,30,4.8]],['relic','bridge',[0,14,4.8]],
  ],
  encounters:[
    {id:'threshold',type:'hollow',at:[2,6,0],name:'Votive Guard',health:80},
    {id:'burial',type:'hound',at:[-12,10,0],name:'Crypt Hound',health:60},
    {id:'chapter',type:'sentinel',at:[0,18,0],name:'Warden of the Quiet Bells',health:190},
    {id:'gallery',type:'archer',at:[-10,32,4.8],name:'The Last Lookout',health:75},
    {id:'lantern',type:'mage',at:[3,18,4.8],name:'The Lanternless',health:95},
  ],
  lamps:[[-4,2,0],[-14,7,0],[4,12,0],[-16,18,1.2],[-16,32,4.8],[4,24,4.8]],
  tombs:[[-14,6,0],[-10,12,0],[4,17,0]],
  treasure:{id:'quiet-flame',name:'The Quiet Flame',at:[0,27,4.8],embers:450,flasks:1,description:'A lantern flame carried through the dark. Resting now restores one additional flask.'},
}];

export const dungeonPoint=(d,[x,n,y=0])=>[d.origin[0]+x,d.elevation+y,d.origin[1]-n];
export function dungeonFootprint(x,z,margin=0){
  return DUNGEONS.some(d=>{const px=x-d.origin[0],n=d.origin[1]-z;return d.rooms.some(r=>px>=r.rect[0]-margin&&px<=r.rect[2]+margin&&n>=r.rect[1]-margin&&n<=r.rect[3]+margin);});
}
export function dungeonFloors(d,heightAt){
  const entry=d.entrance,point=dungeonPoint(d,entry),toe=heightAt(point[0],point[2])+.025;
  return [...d.rooms.map(r=>({...r,elevation:d.elevation+r.level})),{id:'entry',rect:[-2,entry[1],2,0],level:toe-d.elevation,elevation:toe,rise:d.elevation-toe,roof:false}];
}
export function floorHeight(f,x,n){
  if(x<f.rect[0]||x>f.rect[2]||n<f.rect[1]||n>f.rect[3])return null;
  return f.elevation+(f.rise??0)*(n-f.rect[1])/(f.rect[3]-f.rect[1]);
}
export function dungeonRoomAt(position,heightAt){
  for(const dungeon of DUNGEONS)for(const room of dungeonFloors(dungeon,heightAt)){
    const y=floorHeight(room,position[0]-dungeon.origin[0],dungeon.origin[1]-position[2]);
    if(y!==null&&Math.abs(position[1]-y)<1.7)return {dungeon,room};
  }
  return null;
}
