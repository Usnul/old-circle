const ID_KEY='old-circle-id',SAVE_KEY='old-circle-character-v1';
const unavailable='Browser storage is unavailable. Keep this tab open; saving will retry.';

/** Browser persistence is optional for entering the world. Keep the latest
 * character in this tab when storage is denied or full, and retry each save. */
export class JourneyStore {
  constructor({getStorage=()=>globalThis.localStorage,createId=()=>crypto.randomUUID()}={}){
    this.getStorage=getStorage;this.playerId=createId();this.character=null;this.warning='';
    try{
      const storage=getStorage(),id=storage.getItem(ID_KEY);
      if(typeof id==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(id))this.playerId=id;
      const raw=storage.getItem(SAVE_KEY);
      if(raw!==null)try{
        const character=JSON.parse(raw);
        if(!character||character.version!==1||Array.isArray(character))throw new Error('Unsupported character');
        this.character=character;
      }catch{this.warning='The saved journey could not be read. Choose a new beginning.';}
      storage.setItem(ID_KEY,this.playerId);
    }catch{this.warning=unavailable;}
  }
  save(character){
    let serialized;
    try{
      if(!character||character.version!==1||Array.isArray(character))throw new Error('Unsupported character');
      serialized=JSON.stringify(character);this.character=JSON.parse(serialized);
    }catch{this.warning='The current journey could not be saved. Keep this tab open and try again.';return false;}
    try{
      const storage=this.getStorage();storage.setItem(ID_KEY,this.playerId);storage.setItem(SAVE_KEY,serialized);
      this.warning='';return true;
    }catch{this.warning=unavailable;return false;}
  }
}
