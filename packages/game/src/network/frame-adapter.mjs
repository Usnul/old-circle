import {BinaryClassSerializationAdapter} from '@woosh/meep-engine/src/engine/ecs/storage/binary/BinaryClassSerializationAdapter.js';
import {lz4_compress_bound} from '@woosh/meep-engine/src/core/binary/lz4/lz4_compress_bound.js';
import {lz4_compress_block} from '@woosh/meep-engine/src/core/binary/lz4/lz4_compress_block.js';
import {lz4_decompress_block} from '@woosh/meep-engine/src/core/binary/lz4/lz4_decompress_block.js';
import {BinaryBuffer} from '@woosh/meep-engine/src/core/binary/BinaryBuffer.js';
import {writeRecord,readRecord} from './record-codec.mjs';

const MAX_STATE_BYTES=2*1024*1024;

/** Lossless gameplay records inside Meep's binary component protocol.
 * Field ordinals and exact numeric encoding precede native LZ4 compression.
 * Prediction and rollback read exactly the values the host recorded.
 */
export class FrameAdapter extends BinaryClassSerializationAdapter {
  constructor(klass){super();this.klass=klass;this.version=3;this.scratch=new Uint8Array(0);this.record=new BinaryBuffer();}
  serialize(buffer,value){
    this.record.position=0;writeRecord(this.record,value,MAX_STATE_BYTES);const source=this.record.raw_bytes.subarray(0,this.record.position);
    const capacity=lz4_compress_bound(source.length);if(this.scratch.length<capacity)this.scratch=new Uint8Array(capacity);
    const length=lz4_compress_block(this.scratch,0,this.scratch.length,source,0,source.length);
    buffer.writeUintVar(source.length);buffer.writeUintVar(length);buffer.writeBytes(this.scratch,0,length);
  }
  deserialize(buffer,value){
    const size=buffer.readUintVar(),length=buffer.readUintVar();
    if(size<1||length<1||size>MAX_STATE_BYTES||length>lz4_compress_bound(size)||buffer.position+length>buffer.capacity)throw new Error('Malformed gameplay record size');
    const bytes=new Uint8Array(size),end=buffer.position+length;
    if(lz4_decompress_block(bytes,0,size,buffer.raw_bytes,buffer.position,end)!==size)throw new Error('Truncated gameplay record');
    buffer.position=end;const record=new BinaryBuffer();record.fromArrayBuffer(bytes.buffer);const decoded=readRecord(record,size);
    if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))throw new Error('Malformed gameplay record');
    for(const [key,item] of Object.entries(decoded))Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});
  }
}
