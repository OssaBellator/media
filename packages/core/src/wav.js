import { createPcmBuffer } from './pcm.js';
function viewOf(input) { if (input instanceof DataView) return input; if (input instanceof ArrayBuffer) return new DataView(input); if (ArrayBuffer.isView(input)) return new DataView(input.buffer, input.byteOffset, input.byteLength); throw new Error('WAV input must be binary data'); }
function ascii(view, offset, length) { let value=''; for (let i=0;i<length;i++) value += String.fromCharCode(view.getUint8(offset+i)); return value; }
function requireRange(view, offset, length, label) { if (offset < 0 || offset + length > view.byteLength) throw new Error(`Truncated WAV ${label}`); }
export function parseWav(input) {
  const view=viewOf(input); requireRange(view,0,12,'header');
  if (ascii(view,0,4)!=='RIFF' || ascii(view,8,4)!=='WAVE') throw new Error('Not a RIFF/WAVE file');
  const riffSize=view.getUint32(4,true); let offset=12; let format=null; let data=null; const chunks=[];
  while (offset + 8 <= view.byteLength) {
    const id=ascii(view,offset,4); const size=view.getUint32(offset+4,true); const dataOffset=offset+8;
    requireRange(view,dataOffset,Math.min(size, view.byteLength-dataOffset),`chunk ${id}`);
    chunks.push({id,size,offset:dataOffset});
    if (id==='fmt ') {
      requireRange(view,dataOffset,16,'fmt');
      const audioFormat=view.getUint16(dataOffset,true); const channels=view.getUint16(dataOffset+2,true); const sampleRate=view.getUint32(dataOffset+4,true); const byteRate=view.getUint32(dataOffset+8,true); const blockAlign=view.getUint16(dataOffset+12,true); const bitsPerSample=view.getUint16(dataOffset+14,true);
      format={audioFormat,channels,sampleRate,byteRate,blockAlign,bitsPerSample};
    } else if (id==='data') data={offset:dataOffset,size:Math.min(size,view.byteLength-dataOffset)};
    offset=dataOffset+size+(size%2);
  }
  if (!format) throw new Error('WAV fmt chunk not found'); if (!data) throw new Error('WAV data chunk not found');
  if (![1,3].includes(format.audioFormat)) throw new Error(`Unsupported WAV format code: ${format.audioFormat}`);
  if (!format.channels || !format.sampleRate || !format.blockAlign || !format.bitsPerSample) throw new Error('Invalid WAV format');
  const frameCount=Math.floor(data.size/format.blockAlign);
  return {container:'wav',riffSize,format,data,chunks,frameCount,duration:frameCount/format.sampleRate};
}
function pcmInteger(view, offset, bits) { if (bits===8) return (view.getUint8(offset)-128)/128; if (bits===16) return view.getInt16(offset,true)/32768; if (bits===24) { let value=view.getUint8(offset)|(view.getUint8(offset+1)<<8)|(view.getUint8(offset+2)<<16); if (value&0x800000) value|=0xff000000; return value/8388608; } if (bits===32) return view.getInt32(offset,true)/2147483648; throw new Error(`Unsupported PCM bit depth: ${bits}`); }
export function decodeWavPcm(input) {
  const view=viewOf(input); const parsed=parseWav(view); const {format,data,frameCount}=parsed; const bytesPerSample=format.bitsPerSample/8;
  if (!Number.isInteger(bytesPerSample)) throw new Error(`Unsupported WAV bit depth: ${format.bitsPerSample}`);
  const output=createPcmBuffer({channels:format.channels,sampleRate:format.sampleRate,length:frameCount});
  for (let frame=0; frame<frameCount; frame++) for (let channel=0; channel<format.channels; channel++) {
    const offset=data.offset+frame*format.blockAlign+channel*bytesPerSample; let value;
    if (format.audioFormat===3) { if (format.bitsPerSample===32) value=view.getFloat32(offset,true); else if (format.bitsPerSample===64) value=view.getFloat64(offset,true); else throw new Error(`Unsupported float WAV bit depth: ${format.bitsPerSample}`); }
    else value=pcmInteger(view,offset,format.bitsPerSample);
    output.channels[channel][frame]=Math.max(-1,Math.min(1,value));
  }
  return {pcm:output,metadata:parsed};
}
