import { createCompositionDeliveryRuntime } from './composition-delivery-runtime.js';
import { loadAssetBlob, loadStoredGraph } from './storage.js';

function safeName(value){return String(value||'media').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'media';}
function download(bytes,name,type){const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function toast(message,kind='info'){let node=document.querySelector('#composition-delivery-toast');if(!node){node=document.createElement('div');node.id='composition-delivery-toast';Object.assign(node.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:10001,maxWidth:'440px',padding:'10px 14px',borderRadius:'8px',background:'#17191f',color:'#fff',font:'12px system-ui',boxShadow:'0 10px 30px #0008'});document.body.appendChild(node);}node.textContent=message;node.dataset.kind=kind;clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.remove(),5000);}
async function blobResolver(assetId){return loadAssetBlob(assetId).catch(()=>null);}
const runtime=createCompositionDeliveryRuntime({blobResolver});

async function renderOutput(outputId,container,button){
  const graph=await loadStoredGraph(),output=graph?.nodes?.[outputId];if(!output)throw new Error('Output is unavailable');
  button.disabled=true;const original=button.textContent;button.textContent=`Rendering ${container.toUpperCase()}…`;
  try{
    const result=await runtime.render(graph,outputId,{container,temporalSamples:8,vectorSupersample:4,onProgress:({stage,ratio})=>{button.textContent=`${stage} ${Math.round(ratio*100)}%`;}}),type=container==='mp4'?'video/mp4':'video/webm',name=`${safeName(output.name)}.${container}`;
    if(!result.bytes)throw new Error('Memory delivery returned no output bytes');download(result.bytes,name,type);toast(`${output.name}: ${container.toUpperCase()} rendered with graph-backed composition fidelity · ${Math.round(result.bytes.byteLength/1024)} KB`);return result;
  }finally{button.disabled=false;button.textContent=original;}
}

export function upgradeDeliveryButtons(root=document,{documentObject=document,render=renderOutput}={}){
  let replaced=0;
  for(const old of root.querySelectorAll?.('[data-advanced-render="mp4"], [data-advanced-render="webm"]')??[]){
    const container=old.dataset.advancedRender,outputId=old.dataset.outputId;if(!outputId||old.dataset.compositionUpgraded)continue;
    const button=documentObject.createElement('button');button.textContent=`Render ${container.toUpperCase()}`;button.dataset.compositionRender=container;button.dataset.outputId=outputId;button.addEventListener('click',async(event)=>{event.stopPropagation();try{await render(outputId,container,button);}catch(error){toast(error?.name==='AbortError'?'Render cancelled':error.message,'error');}});old.replaceWith(button);replaced++;
  }
  return replaced;
}

const observer=new MutationObserver(()=>upgradeDeliveryButtons());observer.observe(document.documentElement,{subtree:true,childList:true});queueMicrotask(()=>upgradeDeliveryButtons());
window.addEventListener('beforeunload',()=>{observer.disconnect();runtime.close();},{once:true});
