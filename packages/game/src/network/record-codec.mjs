// Wire schema 3: field ordinals remove repeated JSON keys. Numeric values retain
// their exact IEEE value; only exactly representable integers use varints.
const FIELDS=('x y z yaw vx vy vz tick time id set unset changes removed actors projectiles events fromTick snapshot position animationTime gaitPhase cooldown attackAge windup intent buttons hp stamina mana hurtTime airTime fallSpeed landingAge landingStrength grounded crouch phase attackId attackKind bossMove active targetId kind weapon owner radius age life velocity damage effect key hitIds projectileReleased deathTick deadTime deathVelocity healthMax staminaMax manaMax sprintExhausted level embers flasks pvp seals relics dungeon stats inventory vigor endurance might insight weapons arrows armor armors reinforcements name origin archetype home boss hazardSequence lastButtons mantle checkpoint checkpointId hearths patrolIndex version contentVersion scope recipient actor effects sequence appliedSequence levelStat upgradeWeapon create networkId maxRadius speed delay clip reward seal amount source to from t mass mode').split(' ');
const STRINGS=['','player','enemy','hollow','hound','archer','mage','sentinel','pilgrim','sword','spear','bow','staff','mail','wayfarer','keeper','winter','idle','watch','patrol','pursue','return','windup','attack','retreat','weapon','ritual','wave','sigil','shockwave','frost','roots','stars','cinder','nearby'];
const fields=new Map(FIELDS.map((v,i)=>[v,i+1])),strings=new Map(STRINGS.map((v,i)=>[v,i]));
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const TAG={null:0,false:1,true:2,uint:3,negative:4,float:5,string:6,intern:7,array:8,object:9};
const MAX_NODES=100000,MAX_DEPTH=32;

export function writeRecord(buffer,value,maxBytes){
  let nodes=0;const start=buffer.position;
  const text=s=>{const bytes=encoder.encode(s);buffer.writeUintVar(bytes.length);buffer.writeBytes(bytes,0,bytes.length);};
  function write(v,depth){
    if(++nodes>MAX_NODES||depth>MAX_DEPTH||buffer.position-start>maxBytes)throw new Error('Gameplay record exceeds its structure budget');
    if(v==null){buffer.writeUint8(TAG.null);return;}
    if(typeof v==='boolean'){buffer.writeUint8(v?TAG.true:TAG.false);return;}
    if(typeof v==='number'){
      if(!Number.isFinite(v))throw new Error('Non-finite gameplay number');
      if(Number.isInteger(v)&&Math.abs(v)<=0x7fffffff){buffer.writeUint8(v<0?TAG.negative:TAG.uint);buffer.writeUintVar(Math.abs(v));}
      else{buffer.writeUint8(TAG.float);buffer.writeFloat64(v);}return;
    }
    if(typeof v==='string'){const id=strings.get(v);if(id!==undefined){buffer.writeUint8(TAG.intern);buffer.writeUintVar(id);}else{buffer.writeUint8(TAG.string);text(v);}return;}
    if(Array.isArray(v)){buffer.writeUint8(TAG.array);buffer.writeUintVar(v.length);for(const item of v)write(item,depth+1);return;}
    if(typeof v!=='object'||ArrayBuffer.isView(v))throw new Error('Unsupported gameplay record value');
    const entries=Object.entries(v).filter(([,value])=>value!==undefined);buffer.writeUint8(TAG.object);buffer.writeUintVar(entries.length);
    for(const [key,item] of entries){const field=fields.get(key)??0;buffer.writeUintVar(field);if(!field)text(key);write(item,depth+1);}
  }
  write(value,0);if(buffer.position-start>maxBytes)throw new Error('Gameplay record exceeds its state budget');
}

export function readRecord(buffer,end){
  let nodes=0;
  const uint=()=>{const start=buffer.position,value=buffer.readUintVar(),length=buffer.position-start;if(value<0||length>5||buffer.position>end||length===5&&buffer.raw_bytes[buffer.position-1]>7)throw new Error('Malformed gameplay integer');return value;};
  const text=()=>{const length=uint();if(length>end-buffer.position)throw new Error('Truncated gameplay string');const result=decoder.decode(buffer.raw_bytes.subarray(buffer.position,buffer.position+length));buffer.position+=length;return result;};
  function read(depth){
    if(++nodes>MAX_NODES||depth>MAX_DEPTH||buffer.position>=end)throw new Error('Malformed gameplay structure');
    const type=buffer.readUint8();let value;
    if(type===TAG.null)return null;if(type===TAG.false)return false;if(type===TAG.true)return true;
    if(type===TAG.uint||type===TAG.negative)value=uint()*(type===TAG.negative?-1:1);
    else if(type===TAG.float){value=buffer.readFloat64();if(!Number.isFinite(value))throw new Error('Non-finite gameplay number');}
    else if(type===TAG.string)value=text();
    else if(type===TAG.intern){value=STRINGS[uint()];if(value===undefined)throw new Error('Unknown gameplay string');}
    else if(type===TAG.array||type===TAG.object){
      const count=uint();if(count>MAX_NODES-nodes||count>end-buffer.position)throw new Error('Gameplay collection exceeds its budget');
      value=type===TAG.array?[]:{};
      for(let i=0;i<count;i++)if(type===TAG.array)value.push(read(depth+1));else{
        const field=uint(),key=field?FIELDS[field-1]:text();if(key===undefined)throw new Error('Unknown gameplay field');
        Object.defineProperty(value,key,{value:read(depth+1),writable:true,enumerable:true,configurable:true});
      }
    }else throw new Error('Unknown gameplay value');
    if(buffer.position>end)throw new Error('Truncated gameplay value');return value;
  }
  const value=read(0);if(buffer.position!==end)throw new Error('Trailing gameplay bytes');return value;
}
