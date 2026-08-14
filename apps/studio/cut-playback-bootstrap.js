import { effectsForTarget } from '../../packages/core/src/effects.js';
import { sourceTimeForClip } from '../../packages/core/src/evaluation.js';
import { createCutPlaybackEngine } from './cut-playback-factory.js';
import { createCompositor } from './gpu-compositor.js';
import { loadAssetBlob, loadStoredGraph } from './storage.js';

const compositors=new WeakMap();
let graphCache=null,graphCacheAt=0,lastFrameKey='',raf=null,closed=false;
async function graph(){if(!graphCache||performance.now()-graphCacheAt>350){graphCache=await loadStoredGraph().catch(()=>null);graphCacheAt=performance.now();}return graphCache;}
function timelineTime(){const text=document.querySelector('#timecode')?.textContent?.trim()??'00:00.000';const match=text.match(/^(\d+):(\d+)(?:\.(\d+))?$/);if(!match)return 0;return Number(match[1])*60+Number(match[2])+Number(`0.${match[3]??0}`);}
function activeClip(g,time){if(!g)return null;const clips=Object.values(g.nodes??{}).filter((node)=>node.kind==='clip'&&Number(node.props?.start??0)<=time&&time<Number(node.props?.start??0)+Number(node.props?.duration??0)).filter((clip)=>{const track=g.nodes[clip.props.trackId];return track&&track.props?.mediaKind!=='audio'&&!track.props?.muted;});clips.sort((a,b)=>Number(g.nodes[a.props.trackId]?.props?.order??0)-Number(g.nodes[b.props.trackId]?.props?.order??0)||Number(a.props?.start??0)-Number(b.props?.start??0));return clips.at(-1)??null;}
function effectParams(g,id){const params={};for(const effect of effectsForTarget(g,id).filter((e)=>e.props.enabled!==false)){const p=effect.props.params??{};if(effect.props.effectType==='brightness')params.brightness=Number(p.amount??1);if(effect.props.effectType==='contrast')params.contrast=Number(p.amount??1);if(effect.props.effectType==='saturation')params.saturation=Number(p.amount??1);if(effect.props.effectType==='blur')params.blur=Number(p.radius??0);if(effect.props.effectType==='hue')params.hueDegrees=Number(p.degrees??0);}return params;}
async function drawFrame(frame,canvas,effects){let compositor=compositors.get(canvas);if(!compositor){compositor=await createCompositor(canvas,{maxCacheBytes:192*1024*1024});compositors.set(canvas,compositor);}return compositor.drawFrame(frame,{cacheKey:`cut:${frame.timestamp??0}`,...effects});}
const engine=createCutPlaybackEngine({blobResolver:async(id)=>loadAssetBlob(id).catch(()=>null),drawFrame});
async function presentTimeline(){const g=await graph(),time=timelineTime(),clip=activeClip(g,time),container=document.querySelector('.cut-preview .composition-frame');if(!container||!clip){if(container)engine.showFallback(container);return;}const asset=g.nodes[clip.props.assetId];if(!asset)return;const sourceTime=Math.max(0,sourceTimeForClip(clip,time));const frameKey=`${asset.id}:${Math.round(sourceTime*30)}`;if(frameKey===lastFrameKey)return;lastFrameKey=frameKey;try{await engine.present(asset,sourceTime,container,{direction:Number(clip.props.playbackRate??1)>=0?1:-1,effects:effectParams(g,clip.id)});}catch{engine.showFallback(container);}}
function loop(){if(closed)return;const playing=document.querySelector('#transport-play')?.textContent?.includes('❚');if(playing)presentTimeline().catch(()=>{});raf=requestAnimationFrame(loop);}
function attachSeekListeners(){document.querySelectorAll('[data-transport], [data-seek-ruler], .track-lane').forEach((node)=>{if(node.dataset.kernelSeekAttached)return;node.dataset.kernelSeekAttached='1';node.addEventListener('click',()=>{lastFrameKey='';queueMicrotask(()=>presentTimeline().catch(()=>{}));});});}
function scan(){attachSeekListeners();if(!raf)raf=requestAnimationFrame(loop);}
new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});scan();
window.addEventListener('beforeunload',()=>{closed=true;if(raf)cancelAnimationFrame(raf);for(const compositor of compositors.values?.()??[])compositor.destroy?.();engine.close();},{once:true});
