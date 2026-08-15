import {FidelityPlaybackEngine} from './fidelity-playback.js';

export function createCutFidelityPlayback({compositionEngine,controller,evaluate=compositionEngine?.evaluate,defaultFps=30}={}){
  if(!compositionEngine||typeof compositionEngine.presentEvaluated!=='function')throw new Error('Cut fidelity playback requires CompositionPlaybackEngine.presentEvaluated');
  if(typeof evaluate!=='function')throw new Error('Cut fidelity playback requires composition evaluation');
  return new FidelityPlaybackEngine({
    evaluate,
    controller,
    defaultFps,
    render:(evaluated,{graph,fidelity,container,...options})=>compositionEngine.presentEvaluated(graph,evaluated,container,{...options,fidelity}),
  });
}
