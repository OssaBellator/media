import { normalizeMask } from '../../packages/core/src/compositing.js';
import { vectorSupersampleForFidelity } from '../../packages/core/src/fidelity-render.js';
import { rasterizeVectorMaskCanvas } from './vector-mask-raster.js';

function dimensions(value){return{width:Number(value?.displayWidth||value?.codedWidth||value?.videoWidth||value?.naturalWidth||value?.width||0),height:Number(value?.displayHeight||value?.codedHeight||value?.videoHeight||value?.naturalHeight||value?.height||0)};}
function hashString(value){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return(hash>>>0).toString(36);}
function vectorMask(item){const normalized=normalizeMask(item?.mask);return normalized?.type==='vector'?normalized:null;}

export function gpuVectorMaskSupport(plan){try{for(const item of plan?.visual??[])if(vectorMask(item)&&!item.assetId)return{supported:false,reason:`intrinsic-vector-mask-${item.kind??'item'}`};return{supported:true,reason:'supported'};}catch(error){return{supported:false,reason:error.message};}}

export function prepareGpuVectorMaskPlan(plan,{assetResolver,frameProvider,fidelity={},rasterizer=rasterizeVectorMaskCanvas}={}){
  if(typeof assetResolver!=='function')throw new Error('GPU vector-mask adapter requires assetResolver');
  if(!frameProvider?.get)throw new Error('GPU vector-mask adapter requires frameProvider');
  const support=gpuVectorMaskSupport(plan);if(!support.supported)return{...support,plan};
  const synthetic=new Map(),sourceDimensions=new Map(),supersample=vectorSupersampleForFidelity(fidelity);
  const visual=(plan.visual??[]).map((item,index)=>{
    const mask=vectorMask(item);if(!mask)return item;
    const signature=hashString(JSON.stringify({sourceAssetId:item.assetId,paths:mask.paths,fillRule:mask.fillRule,feather:mask.feather,invert:mask.invert,supersample})),assetId=`__media_vector_mask_${item.nodeId??index}_${signature}`;
    synthetic.set(assetId,{id:assetId,name:'Vector mask',props:{mediaKind:'image',syntheticVectorMask:true,sourceAssetId:item.assetId,mask}});
    return{...item,mask:{assetId,mode:'alpha',invert:false,opacity:mask.opacity,feather:0}};
  });
  if(!synthetic.size)return{supported:true,reason:'supported',plan,assetResolver,frameProvider,vectorMasks:0};
  const wrappedResolver=(id)=>synthetic.get(id)??assetResolver(id);
  const wrappedProvider={
    async get(asset,time,options={}){
      if(asset?.props?.syntheticVectorMask){
        const sourceId=asset.props.sourceAssetId,sourceAsset=assetResolver(sourceId),known=sourceDimensions.get(`${sourceId}:${Number(time)||0}`)??dimensions(sourceAsset?.props),width=known.width,height=known.height;
        if(!width||!height)throw new Error(`Vector mask source dimensions unavailable for ${sourceId}`);
        return rasterizer(asset.props.mask,{width,height,fidelity}).canvas;
      }
      const frame=await frameProvider.get(asset,time,options),size=dimensions(frame);if(size.width&&size.height)sourceDimensions.set(`${asset?.id}:${Number(time)||0}`,size);return frame;
    },
    clear(){return frameProvider.clear?.();},
    stats(){return frameProvider.stats?.();},
  };
  return{supported:true,reason:'supported',plan:{...plan,visual},assetResolver:wrappedResolver,frameProvider:wrappedProvider,vectorMasks:synthetic.size};
}
