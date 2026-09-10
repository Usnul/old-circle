import {WebSocketTransport} from '@woosh/meep-engine/src/engine/network/transport/adapters/WebSocketTransport.js';
export const MAX_QUEUED_BYTES=512*1024;

/** Preserve Meep Transport's caller-may-reuse-bytes contract when Node ws
 * queues a view instead of copying it synchronously. See MEEP-004. */
export class GameSocketTransport extends WebSocketTransport {
  send(bytes,length){
    if(this.overloaded||this.socket.readyState!==1)return;
    if((this.socket.bufferedAmount??0)+length>MAX_QUEUED_BYTES){this.overloaded=true;this.socket.close(4001,'Connection too slow; continuing locally');return;}
    super.send(bytes.slice(0,length),length);
  }
}
