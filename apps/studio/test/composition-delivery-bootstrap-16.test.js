import test from 'node:test';
import assert from 'node:assert/strict';

// This file tests the pure upgrade helper after browser globals are installed.
class MutationObserverStub { observe(){} disconnect(){} }
globalThis.MutationObserver=MutationObserverStub;
globalThis.document={documentElement:{},querySelector(){return null;},querySelectorAll(){return[];},createElement(){return{};},body:{appendChild(){}}};
globalThis.window={addEventListener(){}};
const {upgradeDeliveryButtons}=await import('../composition-delivery-bootstrap.js');

function oldButton(container,id){return{dataset:{advancedRender:container,outputId:id},replaceWith(value){this.replacement=value;}};}
function newButton(){return{dataset:{},listeners:{},addEventListener(type,handler){this.listeners[type]=handler;}};}

test('upgrade replaces immediate MP4/WebM buttons and leaves other controls alone',()=>{
  const mp4=oldButton('mp4','o1'),webm=oldButton('webm','o1'),root={querySelectorAll:()=>[mp4,webm]},doc={createElement:newButton};
  const count=upgradeDeliveryButtons(root,{documentObject:doc,render:async()=>{}});
  assert.equal(count,2);assert.equal(mp4.replacement.dataset.compositionRender,'mp4');assert.equal(webm.replacement.dataset.compositionRender,'webm');assert.equal(mp4.replacement.dataset.outputId,'o1');
});

test('upgrade skips malformed controls instead of aborting later replacements',()=>{
  const invalid=oldButton('mp4',''),valid=oldButton('webm','o2'),root={querySelectorAll:()=>[invalid,valid]},doc={createElement:newButton};
  assert.equal(upgradeDeliveryButtons(root,{documentObject:doc,render:async()=>{}}),1);assert.equal(valid.replacement.dataset.compositionRender,'webm');
});
