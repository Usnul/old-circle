import {BinaryClassSerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/storage/binary/BinaryClassSerializationAdapter.js';
import {lz4_compress_bound} from '@woosh/meep-engine/src/core/binary/lz4/lz4_compress_bound.js';
import {lz4_compress_block} from '@woosh/meep-engine/src/core/binary/lz4/lz4_compress_block.js';
import {lz4_decompress_block} from '@woosh/meep-engine/src/core/binary/lz4/lz4_decompress_block.js';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX_STATE_BYTES=2*1024*1024;

/** Lossless gameplay records inside Meep's binary component protocol.
 * LZ4 removes repeated field names and actor data without quantizing simulation
 * state, so prediction and rollback read exactly the values the host recorded.
 */
export class FrameAdapter extends BinaryClassSerializationAdapter {
  constructor(klass){super();this.klass=klass;this.version=2;this.scratch=new Uint8Array(0);}
  serialize(buffer,value){
    const source=encoder.encode(JSON.stringify(value));if(source.length>MAX_STATE_BYTES)throw new Error('Gameplay record exceeds its state budget');
    const capacity=lz4_compress_bound(source.length);if(this.scratch.length<capacity)this.scratch=new Uint8Array(capacity);
    const length=lz4_compress_block(this.scratch,0,this.scratch.length,source,0,source.length);
    buffer.writeUintVar(source.length);buffer.writeUintVar(length);buffer.writeBytes(this.scratch,0,length);
  }
  deserialize(buffer,value){
    const size=buffer.readUintVar(),length=buffer.readUintVar();
    if(size>MAX_STATE_BYTES||length>lz4_compress_bound(size)||buffer.position+length>buffer.capacity)throw new Error('Malformed gameplay record size');
    const bytes=new Uint8Array(size),end=buffer.position+length;
    if(lz4_decompress_block(bytes,0,size,buffer.raw_bytes,buffer.position,end)!==size)throw new Error('Truncated gameplay record');
    buffer.position=end;Object.assign(value,JSON.parse(decoder.decode(bytes)));
  }
}
