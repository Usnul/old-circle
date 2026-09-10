import {WebSocketTransport} from '@woosh/meep-engine/src/engine/network/transport/adapters/WebSocketTransport.js';

/** Preserve Meep Transport's caller-may-reuse-bytes contract when Node ws
 * queues a view instead of copying it synchronously. See MEEP-004. */
export class GameSocketTransport extends WebSocketTransport {
  send(bytes,length){super.send(bytes.slice(0,length),length);}
}
