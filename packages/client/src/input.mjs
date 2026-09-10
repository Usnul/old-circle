import {InputMapSystem} from '@woosh/meep-engine/src/engine/input/ecs/ism/InputMapSystem.js';
import {InputMap} from '@woosh/meep-engine/src/engine/input/ecs/ism/map/InputMap.js';
import {InputTriggerKey} from '@woosh/meep-engine/src/engine/input/ecs/ism/trigger/InputTriggerKey.js';
import {InputTriggerMouseButton} from '@woosh/meep-engine/src/engine/input/ecs/ism/trigger/InputTriggerMouseButton.js';
import {InputCoordinateSwitches} from '@woosh/meep-engine/src/engine/input/ecs/ism/coordinate/InputCoordinateSwitches.js';
import {KeyboardInputDeviceAdapter} from '@woosh/meep-engine/src/engine/input/ecs/ism/device/KeyboardInputDeviceAdapter.js';
import {PointerInputDeviceAdapter} from '@woosh/meep-engine/src/engine/input/ecs/ism/device/PointerInputDeviceAdapter.js';

const keys={sprint:'shift',crouch:'c',jump:'space',nova:'q',heal:'r',rest:'e',journal:'tab',map:'m',escape:'escape',sword:'1',spear:'2',bow:'3',staff:'4'};
export class GameInput {
  constructor(engine,{action,look,captureChanged,error,inspect=false}){
    Object.assign(this,{engine,action,look,captureChanged,error,inspect});this.enabled=true;this.pending=new Map();this.axis=[0,0];this.lookAxis=[0,0];this.edge=[0,0];this.capturePending=false;
    this.element=engine.viewStack.el;this.element.tabIndex=0;
  }
  async start(){
    const devices=this.engine.devices;
    // Menus and the canvas share the engine's keyboard device and action map.
    devices.keyboard.stop();devices.keyboard.domElement=document.body;devices.keyboard.start();
    this.system=new InputMapSystem([new KeyboardInputDeviceAdapter(devices.keyboard),new PointerInputDeviceAdapter(devices.pointer)]);
    await this.engine.entityManager.addSystem(this.system);
    this.map=new InputMap();this.map.bindCoordinate('move',InputCoordinateSwitches.from(['a','d','s','w'].map(k=>InputTriggerKey.from(k))));
    this.map.bindCoordinate('look',InputCoordinateSwitches.from(['left_arrow','right_arrow','up_arrow','down_arrow'].map(k=>InputTriggerKey.from(k))));
    for(const [name,key] of Object.entries(keys))this.map.bind(name,InputTriggerKey.from(key));
    this.map.bind('attack',InputTriggerMouseButton.from(0));
    const ecd=this.engine.entityManager.dataset;this.entity=ecd.createEntity();ecd.addComponentToEntity(this.entity,this.map);
    for(const name of Object.keys(keys))ecd.addEntityEventListener(this.entity,name,()=>{
      if(['journal','map','escape'].includes(name))this.action(name);
      else if(this.enabled){if(['jump','nova','heal','rest'].includes(name))this.pulse(name);else if(['sword','spear','bow','staff'].includes(name))this.action(name);}
    });
    devices.pointer.on.down.add(()=>{if(this.enabled&&!this.activeLook){this.suppressAttack=true;this.capture();}});
    devices.pointer.on.move.add((_p,event,delta)=>{
      if(this.enabled&&(this.activeLook||(this.inspect&&(event.buttons&2))))this.look(delta.x,delta.y);
      const rect=this.element.getBoundingClientRect(),edge=(v,lo,hi)=>v<lo||v>hi?0:v<lo+64?-(((lo+64-v)/64)**2):v>hi-64?((v-hi+64)/64)**2:0;
      this.edge[0]=edge(event.clientX,rect.left,rect.right);this.edge[1]=edge(event.clientY,rect.top,rect.bottom);
    });
    this.element.addEventListener('pointerleave',()=>this.edge.fill(0));
    document.addEventListener('pointerlockchange',()=>{this.capturePending=false;this.captureChanged(this.locked);if(!this.locked)this.pending.clear();});
    window.addEventListener('blur',()=>{this.pending.clear();this.edge.fill(0);this.suppressAttack=true;this.freeLook=false;this.element.classList.remove('free-look');this.captureChanged(false);});
    this.captureChanged(this.locked);return this;
  }
  get locked(){return document.pointerLockElement===this.element;}
  get activeLook(){return this.locked||this.freeLook;}
  async capture(){
    if(this.locked||this.capturePending)return;this.capturePending=true;this.element.focus();
    try{await this.element.requestPointerLock();}
    catch(e){
      this.capturePending=false;this.freeLook=true;this.element.classList.add('free-look');this.captureChanged(true);
      this.error('Mouse look is active. Hold near an edge or use arrow keys to keep turning. Escape releases.');
    }
  }
  suspend(value){this.enabled=!value;this.pending.clear();this.edge.fill(0);if(value){this.freeLook=false;this.element.classList.remove('free-look');document.exitPointerLock();}}
  update(dt){
    if(!this.enabled)return;
    this.map.coordinate(this.lookAxis,0,'look');
    const x=this.lookAxis[0]*800+(this.freeLook?this.edge[0]*650:0),y=this.lookAxis[1]*600+(this.freeLook?this.edge[1]*420:0);
    if(x||y)this.look(x*dt,y*dt);
  }
  pulse(action){if(this.enabled)this.pending.set(action,performance.now()+100);}
  sample(yaw){
    if(!this.enabled)return {x:0,z:0,yaw,buttons:0};
    const now=performance.now(),down=name=>this.map.isActive(name)||(this.pending.get(name)??0)>now;
    this.map.coordinate(this.axis,0,'move');const [side,forward]=this.axis;
    if(!this.map.isActive('attack'))this.suppressAttack=false;
    const attack=this.activeLook&&!this.suppressAttack&&this.map.isActive('attack');
    return {x:-Math.sin(yaw)*forward+Math.cos(yaw)*side,z:-Math.cos(yaw)*forward-Math.sin(yaw)*side,yaw,
      buttons:(down('sprint')?1:0)|(down('crouch')?2:0)|(down('jump')?4:0)|(attack?8:0)|(down('nova')?16:0)|(down('heal')?32:0)|(down('rest')?64:0)};
  }
}
