import test from 'node:test';
import assert from 'node:assert/strict';
import { alignedMaskGeometry, maskAlphaFromRgba } from '../render-engine.js';

test('mask alpha uses alpha mode, opacity and inversion deterministically',()=>{
  const rgba=new Uint8ClampedArray([10,20,30,64,10,20,30,255]);
  const plain=maskAlphaFromRgba(rgba,2,1,{assetId:'m',mode:'alpha',opacity:.5});
  assert.deepEqual([...plain],[32,128]);
  const inverted=maskAlphaFromRgba(rgba,2,1,{assetId:'m',mode:'alpha',opacity:1,invert:true});
  assert.deepEqual([...inverted],[191,0]);
});

test('luma masks include source alpha',()=>{
  const rgba=new Uint8ClampedArray([255,255,255,128,0,0,0,255]);
  const alpha=maskAlphaFromRgba(rgba,2,1,{assetId:'m',mode:'luma'});
  assert.deepEqual([...alpha],[128,0]);
});

test('mask geometry maps different mask dimensions onto source UV geometry',()=>{
  const canvas={width:800,height:600},item={transform:{x:10,y:-20,scaleX:2,scaleY:.5,anchorX:.25,anchorY:.75,cropLeft:.1,cropRight:.2,cropTop:.25,cropBottom:.25,rotation:90}},mask={width:100,height:50};
  const geometry=alignedMaskGeometry(mask,item,{width:400,height:200},canvas);
  assert.equal(geometry.maskSource.x,10);
  assert.equal(geometry.maskSource.width,70);
  assert.equal(geometry.destinationWidth,560);
  assert.equal(geometry.destinationHeight,50);
  assert.equal(geometry.x,410);
  assert.equal(geometry.y,280);
  assert.ok(Math.abs(geometry.rotation-Math.PI/2)<1e-12);
});

test('masked intrinsic shapes use raster source instead of leaking or failing',async()=>{
  const {renderPlanToCanvas2D}=await import('../render-engine.js');
  function canvasFactory(width=1,height=1){
    const context={
      globalAlpha:1,globalCompositeOperation:'source-over',filter:'none',fillStyle:'#000',strokeStyle:'transparent',lineWidth:0,
      save(){},restore(){},clearRect(){},fillRect(){},translate(){},rotate(){},scale(){},drawImage(){},beginPath(){},ellipse(){},moveTo(){},lineTo(){},quadraticCurveTo(){},closePath(){},fill(){},stroke(){},fillText(){},measureText(){return{width:20};},
      getImageData(_x,_y,w,h){return{data:new Uint8ClampedArray(w*h*4).fill(255)};},putImageData(){},createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)};},
    };
    return{width,height,getContext(){return context;}};
  }
  const canvas=canvasFactory(64,64),plan={time:0,fps:30,width:64,height:64,background:'#000',visual:[{kind:'shape',shape:{type:'rectangle',width:20,height:20,fill:'#fff'},transform:{},effects:[],blendMode:'normal',mask:{assetId:'mask',mode:'alpha'}}]};
  const result=await renderPlanToCanvas2D(canvas,plan,{assetResolver:(id)=>id==='mask'?{id:'mask',props:{mediaKind:'image'}}:null,frameProvider:{async get(){return{width:20,height:20};}},canvasFactory});
  assert.equal(result.errors.length,0);
});
