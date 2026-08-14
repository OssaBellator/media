import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseHlsManifest, parseDashManifest } from '../packages/core/src/adaptive-manifest.js';
import { projectClassicMp4Scale, validateClassicMp4Scale } from '../packages/core/src/mp4-scale.js';
import { rasterizeVectorMatte } from '../packages/core/src/vector-matte.js';

function timed(fn){const start=performance.now(),value=fn(),durationMs=performance.now()-start;return{value,durationMs};}
const hours=Math.max(1,Number(process.env.MEDIA_STRESS_HOURS??12)),hlsSegments=Math.max(100,Number(process.env.MEDIA_STRESS_HLS_SEGMENTS??10000)),matteSize=Math.max(32,Number(process.env.MEDIA_STRESS_MATTE_SIZE??256));
const mp4=projectClassicMp4Scale({durationSeconds:hours*3600,videoFps:60,interleaveSeconds:1}),mp4Validation=validateClassicMp4Scale(mp4,{maxTableBytes:128*1024*1024});
let hls='#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n';for(let i=0;i<hlsSegments;i++)hls+=`#EXTINF:2,\ns${i}.m4s\n`;hls+='#EXT-X-ENDLIST\n';const hlsRun=timed(()=>parseHlsManifest(hls,{baseUrl:'https://stress.invalid/live.m3u8'}));
const dashRepeats=Math.max(0,hlsSegments-1),dash=`<MPD type="static" mediaPresentationDuration="PT${hlsSegments*2}S"><Period><AdaptationSet contentType="video"><SegmentTemplate timescale="1" initialization="i.mp4" media="s-$Number$.m4s"><SegmentTimeline><S t="0" d="2" r="${dashRepeats}"/></SegmentTimeline></SegmentTemplate><Representation id="v" bandwidth="1000000"/></AdaptationSet></Period></MPD>`,dashRun=timed(()=>parseDashManifest(dash,{baseUrl:'https://stress.invalid/a.mpd',maxSegments:hlsSegments+1}));
const matteRun=timed(()=>rasterizeVectorMatte({width:matteSize,height:matteSize,feather:8,supersample:2,paths:[{points:[[8,8],[matteSize-8,12],[matteSize-16,matteSize-8],[16,matteSize-12]]}]}));
const report={version:1,generatedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},inputs:{hours,hlsSegments,matteSize},mp4:{...mp4,validation:mp4Validation},adaptive:{hlsParseMs:hlsRun.durationMs,hlsParsedSegments:hlsRun.value.segments.length,dashParseMs:dashRun.durationMs,dashParsedSegments:dashRun.value.variants[0]?.segments.length??0},matte:{rasterMs:matteRun.durationMs,pixels:matteSize*matteSize}};
console.log(JSON.stringify(report,null,2));if(!mp4Validation.passed)process.exitCode=1;const target=process.env.MEDIA_STRESS_REPORT;if(target)await writeFile(path.resolve(target),JSON.stringify(report,null,2));
