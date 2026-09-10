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
},{
  id:'root-cloister',name:'The Rootbound Cloister',region:'wood',level:8,origin:[-115,-86],elevation:2.4,
  materials:{floor:'stoneDark',wall:'stone',trim:'bark',roof:'bark'},
  rooms:[
    {id:'court',name:'The Rain Court',rect:[-14,0,14,10],level:0,roof:false},
    {id:'chapel',name:'Chapel of Fallen Leaves',rect:[-14,10,-4,24],level:0,roof:true},
    {id:'ascent',name:'The Gardener’s Stair',rect:[10,10,14,26],level:0,rise:4.8,roof:false},
    {id:'gallery',name:'The Moss Gallery',rect:[-14,26,14,30],level:4.8,roof:false},
    {id:'loft',name:'The Thorn Choir',rect:[-14,14,-4,26],level:4.8,roof:true},
    {id:'return',name:'The Leaf Walk',rect:[-8,0,-4,14],level:4.8,roof:false},
  ],
  partitions:[{a:[-14,10],b:[-4,10],level:0,door:[-9,3]}],
  openings:[{a:[-2,0],b:[2,0],level:0},{a:[-8,0],b:[-4,0],level:4.8}],entrance:[0,-12],exit:[-6,0,4.8],
  connections:[['entry','court',[0,0,0]],['court','chapel',[-9,10,0]],['court','ascent',[12,10,0]],['ascent','gallery',[12,26,4.8]],['gallery','loft',[-9,26,4.8]],['loft','return',[-6,14,4.8]]],
  encounters:[{id:'court',type:'hound',at:[4,6,0],name:'Cloister Hound',health:110},{id:'chapel',type:'sentinel',at:[-9,19,0],name:'The Moss Sexton',health:240},{id:'stair',type:'hollow',at:[12,19,2.7],name:'Thornbound Gardener',health:115},{id:'gallery',type:'archer',at:[1,28,4.8],name:'The Green Watch',health:110},{id:'choir',type:'mage',at:[-11,18,4.8],name:'The Thorn Cantor',health:165}],
  lamps:[[-11,3,0],[11,3,0],[-12,14,0],[12,14,1.2],[-12,28,4.8],[-5.5,23,4.8]],tombs:[[-12,20,0],[-6,16,0]],
  treasure:{id:'briar-knot',name:'The Briar Knot',at:[-9,23,4.8],embers:650,charm:'briar',description:'Unlocks the Briar Knot charm: faster stamina recovery, at the cost of protection. Choose a charm at a hearth.'},
},{
  id:'ashen-cistern',name:'The Ashen Cistern',region:'desert',level:13,origin:[178,-128],elevation:22,
  materials:{floor:'sand',wall:'sand',trim:'brass',roof:'stoneDark'},
  rooms:[
    {id:'court',name:'The Dry Fountain',rect:[-10,0,14,6],level:0,roof:false},
    {id:'west',name:'The Salt Descent',rect:[-10,6,-6,22],level:0,rise:-4.8,roof:false},
    {id:'channel',name:'The Empty Channel',rect:[-10,22,14,28],level:-4.8,roof:true},
    {id:'vault',name:'The Cinder Reservoir',rect:[-6,10,10,22],level:-4.8,roof:true},
    {id:'east',name:'The Bucket Stair',rect:[10,6,14,22],level:0,rise:-4.8,roof:false},
  ],
  partitions:[{a:[-6,22],b:[10,22],level:-4.8,door:[2,3.6]}],
  openings:[{a:[-2,0],b:[2,0],level:0}],entrance:[0,-30],exit:[12,6,0],
  connections:[['entry','court',[0,0,0]],['court','west',[-8,6,0]],['court','east',[12,6,0]],['west','channel',[-8,22,-4.8]],['east','channel',[12,22,-4.8]],['channel','vault',[2,22,-4.8]]],
  encounters:[{id:'court',type:'archer',at:[-5,3,0],name:'Salt Road Watcher',health:130},{id:'east',type:'archer',at:[12,9,-.9],name:'The Bucket Keeper',health:130},{id:'channel',type:'hollow',at:[-6,25,-4.8],name:'The Thirsting',health:170},{id:'channel-hound',type:'hound',at:[9,25,-4.8],name:'Ash Hound',health:145},{id:'reservoir',type:'sentinel',at:[-1,14,-4.8],name:'Warden of the Last Water',health:310}],
  lamps:[[-8,2,0],[12,2,0],[-8,18,-3.6],[-8,25,-4.8],[12,25,-4.8],[8,12,-4.8]],tombs:[[-4,12,-4.8],[8,17,-4.8]],
  treasure:{id:'ashen-lens',name:'The Ashen Lens',at:[3,13,-4.8],embers:900,charm:'ash',description:'Unlocks the Ashen Lens charm: stronger arrows in exchange for weaker melee blows. Choose a charm at a hearth.'},
},{
  id:'glass-observatory',name:'The Listening Observatory',region:'magic',level:19,origin:[-169,-216],elevation:43,
  materials:{floor:'stoneDark',wall:'stoneDark',trim:'ice',roof:'iron'},
  rooms:[
    {id:'court',name:'The Astronomer’s Court',rect:[-12,0,8,8],level:0,roof:false},
    {id:'first-stair',name:'The Moon Stair',rect:[-12,8,-8,24],level:0,rise:4.8,roof:false},
    {id:'gallery',name:'Gallery of Lost Stars',rect:[-12,24,12,28],level:4.8,roof:false},
    {id:'library',name:'The Unread Library',rect:[-8,8,8,24],level:4.8,roof:true},
    {id:'balcony',name:'The Blue Balcony',rect:[-8,4,12,8],level:4.8,roof:false},
    {id:'second-stair',name:'The Star Stair',rect:[8,8,12,24],level:4.8,rise:4.8,roof:false},
    {id:'observatory',name:'The Listening Chamber',rect:[-4,24,12,34],level:9.6,roof:true},
    {id:'return',name:'The Falling Star Walk',rect:[-4,6,0,24],level:9.6,roof:false},
  ],
  partitions:[{a:[-8,16],b:[8,16],level:4.8,door:[0,3.6]}],
  openings:[{a:[-2,0],b:[2,0],level:0},{a:[-4,6],b:[0,6],level:9.6},{a:[-4,4],b:[0,4],level:4.8}],entrance:[0,-20],exit:[-2,6,9.6],
  connections:[['entry','court',[0,0,0]],['court','first-stair',[-10,8,0]],['first-stair','gallery',[-10,24,4.8]],['gallery','library',[0,24,4.8]],['library','balcony',[0,8,4.8]],['balcony','second-stair',[10,8,4.8]],['second-stair','observatory',[10,24,9.6]],['observatory','return',[-2,24,9.6]]],
  encounters:[{id:'court',type:'hound',at:[3,5,0],name:'Glass Hound',health:175},{id:'gallery',type:'mage',at:[4,26,4.8],name:'The Unseeing Scholar',health:195},{id:'library',type:'sentinel',at:[-4,12,4.8],name:'Keeper of Unread Names',health:350},{id:'balcony',type:'archer',at:[7,6,4.8],name:'The Blue Watcher',health:180},{id:'chamber',type:'mage',at:[7,29,9.6],name:'The Last Astronomer',health:300}],
  lamps:[[-10,2,0],[6,2,0],[-10,16,2.4],[-10,26,4.8],[-6,21,4.8],[6,10,4.8],[10,18,7.8],[10,32,9.6]],tombs:[[-6,18,4.8],[6,20,4.8]],
  treasure:{id:'listening-glass',name:'The Listening Glass',at:[1,31,9.6],embers:1250,charm:'glass',description:'Unlocks the Listening Glass charm: cheaper, stronger spells, with greater vulnerability to incoming damage. Choose a charm at a hearth.'},
},{
  id:'white-ossuary',name:'The White Ossuary',region:'tundra',level:25,origin:[153,-270],elevation:49,
  materials:{floor:'stoneLight',wall:'bone',trim:'ice',roof:'snow'},
  rooms:[
    {id:'hall',name:'The Pilgrims’ Rest',rect:[-6,0,18,8],level:0,roof:true},
    {id:'ascent',name:'The Wind Stair',rect:[-6,8,-2,28],level:0,rise:4.8,roof:false},
    {id:'bridge',name:'The White Crossing',rect:[-6,28,6,32],level:4.8,roof:false},
    {id:'chapel',name:'Chapel of the Still Heart',rect:[6,20,18,36],level:4.8,roof:true},
    {id:'return',name:'The Snow Walk',rect:[14,8,18,20],level:4.8,roof:false},
  ],
  partitions:[{a:[6,28],b:[6,32],level:4.8,door:[30,2.8]}],
  openings:[{a:[-2,0],b:[2,0],level:0},{a:[14,8],b:[18,8],level:4.8}],entrance:[0,-34],exit:[16,8,4.8],
  connections:[['entry','hall',[0,0,0]],['hall','ascent',[-4,8,0]],['ascent','bridge',[-4,28,4.8]],['bridge','chapel',[6,30,4.8]],['chapel','return',[16,20,4.8]]],
  encounters:[{id:'hall',type:'sentinel',at:[9,4,0],name:'The Kneeling Pilgrim',health:380},{id:'stair',type:'hollow',at:[-4,19,2.64],name:'The Windless',health:240},{id:'bridge',type:'archer',at:[3,30,4.8],name:'The White Watch',health:225},{id:'chapel',type:'mage',at:[9,24,4.8],name:'The Still Singer',health:250},{id:'heart',type:'sentinel',at:[14,31,4.8],name:'Guardian of the Still Heart',health:480}],
  lamps:[[-4,2,0],[16,2,0],[-4,13,1.2],[-4,30,4.8],[8,22,4.8],[16,34,4.8]],tombs:[[3,3,0],[13,3,0],[8,33,4.8]],
  treasure:{id:'frozen-heart',name:'The Frozen Heart',at:[10,33,4.8],embers:1700,charm:'frost',description:'Unlocks the Frozen Heart charm: stronger protection, slower movement and slower focus recovery. Choose a charm at a hearth.'},
},{
  id:'uncrowned-archive',name:'The Uncrowned Archive',region:'crown',level:32,origin:[64,-362],elevation:59,
  materials:{floor:'stoneDark',wall:'stone',trim:'brass',roof:'iron'},
  rooms:[
    {id:'vestibule',name:'The Oathless Gate',rect:[-12,0,12,10],level:0,roof:false},
    {id:'archive',name:'The Ledger of Kings',rect:[-8,10,8,28],level:0,roof:true},
    {id:'west',name:'The First Vow',rect:[-12,10,-8,30],level:0,rise:4.8,roof:false},
    {id:'east',name:'The Last Vow',rect:[8,10,12,30],level:0,rise:4.8,roof:false},
    {id:'gallery',name:'Gallery of Empty Crowns',rect:[-12,30,12,34],level:4.8,roof:false},
    {id:'throne',name:'The Uncrowned Seat',rect:[-8,18,8,30],level:4.8,roof:true},
    {id:'return',name:'The King’s Descent',rect:[-2,0,2,18],level:4.8,roof:false},
  ],
  partitions:[{a:[-8,10],b:[8,10],level:0,door:[0,3.6]},{a:[-8,24],b:[8,24],level:4.8,door:[0,3.6]}],
  openings:[{a:[-2,0],b:[2,0],level:0},{a:[-2,0],b:[2,0],level:4.8}],entrance:[0,-18],exit:[0,0,4.8],
  connections:[['entry','vestibule',[0,0,0]],['vestibule','archive',[0,10,0]],['vestibule','west',[-10,10,0]],['vestibule','east',[10,10,0]],['west','gallery',[-10,30,4.8]],['east','gallery',[10,30,4.8]],['gallery','throne',[0,30,4.8]],['throne','return',[0,18,4.8]]],
  encounters:[{id:'gate',type:'sentinel',at:[6,6,0],name:'The Oathless Guard',health:440},{id:'ledger',type:'mage',at:[-4,20,0],name:'The King’s Witness',health:310},{id:'west',type:'archer',at:[-10,24,3.36],name:'The First Vow',health:280},{id:'east',type:'hollow',at:[10,24,3.36],name:'The Last Vow',health:310},{id:'seat',type:'sentinel',at:[4,27,4.8],name:'The Empty Crown',health:620}],
  lamps:[[-10,3,0],[10,3,0],[-6,14,0],[6,25,0],[-10,32,4.8],[10,32,4.8],[-6,26,4.8]],tombs:[[-5,20,0],[5,20,0]],
  treasure:{id:'kings-brand',name:'The King’s Brand',at:[0,27,4.8],embers:2200,charm:'crown',description:'Unlocks the King’s Brand charm: stronger attacks in exchange for taking more damage. Choose a charm at a hearth.'},
}];

export const dungeonPoint=(d,[x,n,y=0])=>[d.origin[0]+x,d.elevation+y,d.origin[1]-n];
export function dungeonFootprint(x,z,margin=0){
  return DUNGEONS.some(d=>{const px=x-d.origin[0],n=d.origin[1]-z;return Math.abs(px)<=2+margin&&n>=d.entrance[1]-margin&&n<=margin||d.rooms.some(r=>px>=r.rect[0]-margin&&px<=r.rect[2]+margin&&n>=r.rect[1]-margin&&n<=r.rect[3]+margin);});
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
