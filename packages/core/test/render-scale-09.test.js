import test from 'node:test';
import assert from 'node:assert/strict';
import { previewScaleForPlan, scaleRenderPlan } from '../src/render-scale.js';

test('preview scaling bounds a 4K plan without changing crop semantics',()=>{const plan={width:3840,height:2160,visual:[{kind:'clip',transform:{x:200,y:100,scaleX:1,scaleY:.5,cropLeft:.1},effects:[{type:'blur',params:{radius:8}}]}]};const scale=previewScaleForPlan(plan,{maxWidth:1280,maxHeight:720,maxPixels:1280*720});assert.equal(scale,1/3);const out=scaleRenderPlan(plan,{scale});assert.equal(out.width,1280);assert.ok(Math.abs(out.visual[0].transform.x-200/3)<1e-9);assert.equal(out.visual[0].transform.scaleX,1/3);assert.equal(out.visual[0].transform.cropLeft,.1);assert.ok(Math.abs(out.visual[0].effects[0].params.radius-8/3)<1e-9);});

test('text and shape intrinsic sizes scale without double-scaling transform scale',()=>{const plan={width:1000,height:1000,visual:[{kind:'text',style:{fontSize:100},transform:{x:20,y:0,scaleX:2,scaleY:2}},{kind:'shape',shape:{width:400,height:200},transform:{scaleX:1.5,scaleY:1.5}}]};const out=scaleRenderPlan(plan,{scale:.5});assert.equal(out.visual[0].style.fontSize,50);assert.equal(out.visual[0].transform.scaleX,2);assert.equal(out.visual[1].shape.width,200);assert.equal(out.visual[1].transform.scaleX,1.5);});
