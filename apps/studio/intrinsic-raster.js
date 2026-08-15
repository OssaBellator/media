function createCanvas(width=1,height=1){
  if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(width,height);
  const canvas=globalThis.document?.createElement?.('canvas');
  if(!canvas)throw new Error('Intrinsic rasterization requires a canvas implementation');
  canvas.width=width;canvas.height=height;return canvas;
}
function positive(value,fallback){const number=Number(value);return Number.isFinite(number)&&number>0?number:fallback;}
function textAlign(value){return ['left','right','center'].includes(value)?value:'center';}
function roundedRectPath(context,x,y,width,height,radius){
  const r=Math.max(0,Math.min(Number(radius)||0,Math.min(width,height)/2));
  context.beginPath();context.moveTo(x+r,y);context.lineTo(x+width-r,y);context.quadraticCurveTo(x+width,y,x+width,y+r);context.lineTo(x+width,y+height-r);context.quadraticCurveTo(x+width,y+height,x+width-r,y+height);context.lineTo(x+r,y+height);context.quadraticCurveTo(x,y+height,x,y+height-r);context.lineTo(x,y+r);context.quadraticCurveTo(x,y,x+r,y);context.closePath();
}
export function intrinsicAnchorForItem(item){
  if(item?.kind==='text'){
    const align=textAlign(item?.style?.align);
    return{x:align==='left'?0:align==='right'?1:.5,y:.5};
  }
  return{x:.5,y:.5};
}
export function intrinsicRasterDimensions(item,{measureText=null}={}){
  if(item?.kind==='shape'){
    const shape=item.shape??{},stroke=Math.max(0,Number(shape.strokeWidth??0));
    return{width:Math.max(1,Math.ceil(positive(shape.width,500)+stroke*2)),height:Math.max(1,Math.ceil(positive(shape.height,300)+stroke*2))};
  }
  if(item?.kind==='text'){
    const style=item.style??{},fontSize=positive(style.fontSize,96),lineHeight=fontSize*positive(style.lineHeight,1.1),lines=String(item.text??'').split('\n'),fallback=(line)=>fontSize*Math.max(1,line.length)*.75;
    const widths=lines.map((line)=>Math.max(1,Number(measureText?.(line)?.width??fallback(line))));
    return{width:Math.max(1,Math.ceil(Math.max(...widths,1)+2)),height:Math.max(1,Math.ceil(Math.max(fontSize,lineHeight*lines.length)+2))};
  }
  throw new Error(`Unsupported intrinsic item ${item?.kind??'unknown'}`);
}
export function rasterizeIntrinsicCanvas(item,{canvasFactory=createCanvas}={}){
  if(!['text','shape'].includes(item?.kind))throw new Error(`Unsupported intrinsic item ${item?.kind??'unknown'}`);
  const style=item.style??{},fontSize=positive(style.fontSize,96),font=`${Number(style.fontWeight??700)} ${fontSize}px ${style.fontFamily??'sans-serif'}`;
  const probe=canvasFactory(1,1);probe.width=1;probe.height=1;const probeContext=probe.getContext?.('2d');if(!probeContext)throw new Error('Intrinsic rasterization requires Canvas2D');
  if(item.kind==='text')probeContext.font=font;
  const dimensions=intrinsicRasterDimensions(item,{measureText:item.kind==='text'?(text)=>probeContext.measureText?.(text):null}),canvas=canvasFactory(dimensions.width,dimensions.height);canvas.width=dimensions.width;canvas.height=dimensions.height;const context=canvas.getContext?.('2d');if(!context)throw new Error('Intrinsic rasterization requires Canvas2D');context.clearRect?.(0,0,canvas.width,canvas.height);
  if(item.kind==='shape'){
    const shape=item.shape??{},stroke=Math.max(0,Number(shape.strokeWidth??0)),left=stroke,top=stroke,width=Math.max(1,canvas.width-stroke*2),height=Math.max(1,canvas.height-stroke*2);context.fillStyle=shape.fill??'#ffffff';context.strokeStyle=shape.stroke??'transparent';context.lineWidth=stroke;
    if(shape.type==='ellipse'){context.beginPath();context.ellipse(canvas.width/2,canvas.height/2,width/2,height/2,0,0,Math.PI*2);}
    else roundedRectPath(context,left,top,width,height,shape.cornerRadius??0);
    context.fill();if(stroke>0)context.stroke();
  }else{
    const align=textAlign(style.align),lines=String(item.text??'').split('\n'),lineHeight=fontSize*positive(style.lineHeight,1.1),blockHeight=(lines.length-1)*lineHeight;context.font=font;context.fillStyle=style.color??'#ffffff';context.textAlign=align;context.textBaseline='middle';if('letterSpacing'in context)context.letterSpacing=`${Number(style.letterSpacing??0)}px`;const x=align==='left'?1:align==='right'?canvas.width-1:canvas.width/2,y=canvas.height/2;for(let index=0;index<lines.length;index++)context.fillText(lines[index],x,y+index*lineHeight-blockHeight/2);
  }
  return{canvas,width:canvas.width,height:canvas.height,anchor:intrinsicAnchorForItem(item)};
}
