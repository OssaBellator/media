import { createCutPlaybackRuntime, installCutPlaybackBridge } from './cut-playback-runtime.js';
import { loadAssetBlob, loadStoredGraph } from './storage.js';

let graphCache=null,graphCacheAt=0,raf=null,closed=false;
async function blobResolver(id){return loadAssetBlob(id).catch(()=>null);}
const runtime=createCutPlaybackRuntime({blobResolver,sourceCacheBytes:128*1024*1024});
const removeBridge=installCutPlaybackBridge(runtime);
async function graph(){if(!graphCache||performance.now()-graphCacheAt>350){graphCache=await loadStoredGraph().catch(()=>null);graphCacheAt=performance.now();}return graphCache;}
function invalidateGraph({sources=false}={}){graphCache=null;graphCacheAt=0;runtime.invalidate({sources});}
function timelineTime(){const text=document.querySelector('#timecode')?.textContent?.trim()??'00:00.000';const match=text.match(/^(\d+):(\d+)(?:\.(\d+))?$/);if(!match)return 0;return Number(match[1])*60+Number(match[2])+Number(`0.${match[3]??0}`);}
function isPlaying(){return document.querySelector('#transport-play')?.textContent?.includes('❚')??false;}
async function presentTimeline(mode=isPlaying()?'playback':'scrub'){
  const g=await graph(),time=timelineTime(),container=document.querySelector('.cut-preview .composition-frame');
  if(!container||!g)return;
  try{await runtime.present(g,time,{mode,container,priority:mode==='scrub'?120:100});}
  catch(error){if(error?.name!=='AbortError')runtime.resources.compositionEngine.showFallback(container);}
}
function loop(){if(closed)return;if(isPlaying())presentTimeline('playback').catch(()=>{});raf=requestAnimationFrame(loop);}
function attachSeekListeners(){document.querySelectorAll('[data-transport], [data-seek-ruler], .track-lane').forEach((node)=>{if(node.dataset.kernelSeekAttached)return;node.dataset.kernelSeekAttached='1';node.addEventListener('click',()=>queueMicrotask(()=>presentTimeline('scrub').catch(()=>{})));});}
function meaningfulMutation(mutation){for(const node of mutation.addedNodes??[]){if(node?.nodeType!==1)return true;if(!node.matches?.('canvas[data-composition-playback], canvas[data-kernel-playback]')&&!node.closest?.('canvas[data-composition-playback], canvas[data-kernel-playback]'))return true;}for(const node of mutation.removedNodes??[])if(node?.nodeType===1&&!node.matches?.('canvas[data-composition-playback], canvas[data-kernel-playback]'))return true;return false;}
function scan(mutations=[]){if(mutations.some(meaningfulMutation))invalidateGraph();attachSeekListeners();if(!raf)raf=requestAnimationFrame(loop);if(mutations.length)queueMicrotask(()=>presentTimeline(isPlaying()?'playback':'scrub').catch(()=>{}));}
new MutationObserver((mutations)=>scan(mutations)).observe(document.querySelector('#app')??document.documentElement,{childList:true,subtree:true});scan();
window.addEventListener('media:project-replaced',()=>invalidateGraph({sources:true}));
window.addEventListener('beforeunload',()=>{closed=true;removeBridge();if(raf)cancelAnimationFrame(raf);runtime.close();},{once:true});
