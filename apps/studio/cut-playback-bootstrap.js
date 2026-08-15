import { createCutPlaybackEngine } from './cut-playback-factory.js';
import { CompositionPlaybackEngine } from './composition-playback-engine.js';
import { createCutFidelityPlayback } from './cut-fidelity-playback.js';
import { BrowserFrameProvider } from './render-engine.js';
import { BrowserGpuCompositionRenderer } from './gpu-composition-renderer.js';
import { loadAssetBlob, loadStoredGraph } from './storage.js';

let graphCache=null,graphCacheAt=0,lastFrameKey='',raf=null,closed=false,presentAbort=null;
async function blobResolver(id){return loadAssetBlob(id).catch(()=>null);}
const videoEngine=createCutPlaybackEngine({blobResolver,sourceCacheBytes:128*1024*1024});
const fallbackProvider=new BrowserFrameProvider({blobResolver,maxCacheBytes:128*1024*1024,concurrency:2});
const gpuRenderer=new BrowserGpuCompositionRenderer({maxCacheBytes:192*1024*1024});
const compositionEngine=new CompositionPlaybackEngine({videoEngine,fallbackProvider,gpuRenderer,maxWidth:1600,maxHeight:900,maxPixels:1_500_000});
const fidelityEngine=createCutFidelityPlayback({compositionEngine});
async function graph(){if(!graphCache||performance.now()-graphCacheAt>350){graphCache=await loadStoredGraph().catch(()=>null);graphCacheAt=performance.now();}return graphCache;}
function invalidateGraph(){presentAbort?.abort();presentAbort=null;graphCache=null;graphCacheAt=0;lastFrameKey='';fidelityEngine.reset();compositionEngine.invalidate();}
function timelineTime(){const text=document.querySelector('#timecode')?.textContent?.trim()??'00:00.000';const match=text.match(/^(\d+):(\d+)(?:\.(\d+))?$/);if(!match)return 0;return Number(match[1])*60+Number(match[2])+Number(`0.${match[3]??0}`);}
function isPlaying(){return document.querySelector('#transport-play')?.textContent?.includes('❚')??false;}
async function presentTimeline(mode=isPlaying()?'playback':'scrub'){
  const g=await graph(),time=timelineTime(),container=document.querySelector('.cut-preview .composition-frame');
  if(!container||!g)return;
  const frameKey=`${mode}:${Math.round(time*1000)}:${Object.keys(g.nodes??{}).length}`;
  if(frameKey===lastFrameKey)return;
  lastFrameKey=frameKey;
  if(mode==='scrub'){presentAbort?.abort();presentAbort=new AbortController();}
  const signal=mode==='scrub'?presentAbort.signal:undefined;
  try{await fidelityEngine.present(g,time,{mode,container,priority:mode==='scrub'?120:100,signal});}
  catch(error){if(error?.name!=='AbortError'){lastFrameKey='';compositionEngine.showFallback(container);}}
}
function loop(){if(closed)return;if(isPlaying())presentTimeline('playback').catch(()=>{});raf=requestAnimationFrame(loop);}
function attachSeekListeners(){document.querySelectorAll('[data-transport], [data-seek-ruler], .track-lane').forEach((node)=>{if(node.dataset.kernelSeekAttached)return;node.dataset.kernelSeekAttached='1';node.addEventListener('click',()=>{lastFrameKey='';queueMicrotask(()=>presentTimeline('scrub').catch(()=>{}));});});}
function meaningfulMutation(mutation){for(const node of mutation.addedNodes??[]){if(node?.nodeType!==1)return true;if(!node.matches?.('canvas[data-composition-playback], canvas[data-kernel-playback]')&&!node.closest?.('canvas[data-composition-playback], canvas[data-kernel-playback]'))return true;}for(const node of mutation.removedNodes??[])if(node?.nodeType===1&&!node.matches?.('canvas[data-composition-playback], canvas[data-kernel-playback]'))return true;return false;}
function scan(mutations=[]){if(mutations.some(meaningfulMutation))invalidateGraph();attachSeekListeners();if(!raf)raf=requestAnimationFrame(loop);if(mutations.length)queueMicrotask(()=>presentTimeline(isPlaying()?'playback':'scrub').catch(()=>{}));}
new MutationObserver((mutations)=>scan(mutations)).observe(document.querySelector('#app')??document.documentElement,{childList:true,subtree:true});scan();
window.addEventListener('beforeunload',()=>{closed=true;presentAbort?.abort();if(raf)cancelAnimationFrame(raf);compositionEngine.close();videoEngine.close();fallbackProvider.clear?.();},{once:true});
