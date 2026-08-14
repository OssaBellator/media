import { readFile, open, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { demuxIsoBmffAutoSource } from '../packages/core/src/isobmff-auto-range.js';
import { createMemoryRangeSource } from '../packages/core/src/range-source.js';
import { demuxWebmSource } from '../packages/core/src/webm-range.js';
import { runConformanceFixture, summarizeConformanceRuns, validateCorpusManifest } from '../packages/core/src/conformance-corpus.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'conformance/corpus.json'),'utf8'));
const checked=validateCorpusManifest(manifest);if(!checked.valid){console.error(checked.errors.join('\n'));process.exit(2);}
const corpusDir=path.resolve(process.env.MEDIA_CORPUS_DIR??path.join(root,'conformance/fixtures'));
class FileRangeSource{
  constructor(handle,size,id){this.handle=handle;this.size=size;this.id=id;this.reads=0;this.bytesRead=0;}
  async read(offset,length){const out=Buffer.alloc(length);const {bytesRead}=await this.handle.read(out,0,length,offset);if(bytesRead!==length)throw new Error(`Short file range read ${bytesRead}/${length}`);this.reads++;this.bytesRead+=bytesRead;return new Uint8Array(out.buffer,out.byteOffset,bytesRead).slice();}
  stats(){return{id:this.id,size:this.size,reads:this.reads,bytesRead:this.bytesRead};}
  async close(){await this.handle.close();}
}
function concat(parts){const arrays=parts.map((part)=>part instanceof Uint8Array?part:new Uint8Array(part)),out=new Uint8Array(arrays.reduce((n,p)=>n+p.byteLength,0));let offset=0;for(const part of arrays){out.set(part,offset);offset+=part.byteLength;}return out;}
const te=new TextEncoder();
const concatBytes=(...parts)=>{const arrays=parts.flat().filter(Boolean),out=new Uint8Array(arrays.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of arrays){out.set(part,offset);offset+=part.length;}return out;};
const u8=(n)=>new Uint8Array([n&255]);const u16=(n)=>{const a=new Uint8Array(2);new DataView(a.buffer).setUint16(0,n,false);return a;};const u24=(n)=>new Uint8Array([(n>>16)&255,(n>>8)&255,n&255]);const u32=(n)=>{const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n>>>0,false);return a;};const i32=(n)=>{const a=new Uint8Array(4);new DataView(a.buffer).setInt32(0,n,false);return a;};const box=(t,...parts)=>{const body=concatBytes(...parts);return concatBytes(u32(body.length+8),te.encode(t),body);};const full=(t,v,f,...parts)=>box(t,u8(v),u24(f),...parts);
function syntheticFmp4(){const avcC=box('avcC',new Uint8Array([1,100,0,31]));const visual=box('avc1',new Uint8Array(6),u16(1),new Uint8Array(16),u16(16),u16(16),new Uint8Array(50),avcC);const stsd=full('stsd',0,0,u32(1),visual),stbl=box('stbl',stsd),minf=box('minf',stbl),mdhd=full('mdhd',0,0,u32(0),u32(0),u32(1000),u32(0),u16(0),u16(0)),hdlr=full('hdlr',0,0,u32(0),te.encode('vide'),new Uint8Array(12)),mdia=box('mdia',mdhd,hdlr,minf),tkhd=full('tkhd',0,7,u32(0),u32(0),u32(1),u32(0),u32(0),new Uint8Array(60)),trak=box('trak',tkhd,mdia),trex=full('trex',0,0,u32(1),u32(1),u32(40),u32(4),u32(0x01010000)),moov=box('moov',trak,box('mvex',trex)),tfhd=full('tfhd',0,0x020000,u32(1)),tfdt=full('tfdt',1,0,new Uint8Array(4),u32(0));let trun=full('trun',0,0x000f01,u32(2),i32(0),u32(40),u32(4),u32(0x02000000),u32(0),u32(40),u32(4),u32(0x01010000),u32(0)),moof=box('moof',box('traf',tfhd,tfdt,trun));trun=full('trun',0,0x000f01,u32(2),i32(moof.length+8),u32(40),u32(4),u32(0x02000000),u32(0),u32(40),u32(4),u32(0x01010000),u32(0));moof=box('moof',box('traf',tfhd,tfdt,trun));return concatBytes(box('ftyp',te.encode('iso6'),u32(1),te.encode('iso6')),moov,moof,box('mdat',new Uint8Array([1,2,3,4,5,6,7,8])));}
async function sourceFactory(fixture){if(fixture.generated?.type==='synthetic-fmp4')return createMemoryRangeSource(syntheticFmp4(),{id:fixture.id});const filename=path.resolve(corpusDir,fixture.path);const info=await stat(filename);const handle=await open(filename,'r');return new FileRangeSource(handle,Number(info.size),fixture.id);}
async function demux(source,fixture){const ext=path.extname(fixture.path??'').toLowerCase();if(ext==='.webm')return demuxWebmSource(source);return demuxIsoBmffAutoSource(source,{container:ext==='.mov'?'mov':'mp4'});}
const runs=[];for(const fixture of manifest.fixtures){let source=null;try{const run=await runConformanceFixture(fixture,{sourceFactory:async(value)=>{source=await sourceFactory(value);return source;},demux});runs.push(run);const mark=run.status==='passed'?'PASS':run.status==='skipped'?'SKIP':'FAIL';console.log(`${mark.padEnd(4)} ${fixture.id}${run.reason?` — ${run.reason}`:''}`);if(run.violations?.length)for(const violation of run.violations)console.log(`     ${JSON.stringify(violation)}`);}finally{await source?.close?.().catch(()=>{});}}
const summary=summarizeConformanceRuns(runs);console.log(`\nConformance: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.total} total)`);if(summary.failed)process.exitCode=1;
