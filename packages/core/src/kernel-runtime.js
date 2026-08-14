import { assertKernelMessage, createKernelError, createKernelResult } from './kernel-protocol.js';
export class KernelRuntime {
  constructor(){this.handlers=new Map();this.controllers=new Map();}
  register(kind,handler){if(typeof handler!=='function')throw new Error('Kernel handler must be a function');this.handlers.set(kind,handler);return this;}
  unregister(kind){return this.handlers.delete(kind);}
  cancel(taskId){const controller=this.controllers.get(taskId);if(!controller)return false;controller.abort();return true;}
  async execute(task,{onProgress=()=>{}}={}){
    assertKernelMessage(task);if(task.type!=='task')throw new Error('KernelRuntime.execute requires a task message');const handler=this.handlers.get(task.kind);if(!handler)return createKernelError(task.id,new Error(`No kernel handler for ${task.kind}`),{code:'NO_HANDLER'});
    const controller=new AbortController();this.controllers.set(task.id,controller);
    const progress=(value,detail)=>{if(controller.signal.aborted)return;onProgress({protocol:'media.kernel.v1',type:'progress',id:task.id,progress:Math.max(0,Math.min(1,Number(value)||0)),detail});};
    const started=performance.now();
    try{const result=await handler(task.payload,{signal:controller.signal,progress,task});if(controller.signal.aborted)return createKernelError(task.id,new DOMException('Task aborted','AbortError'),{retryable:true,code:'ABORTED'});return createKernelResult(task.id,result,{durationMs:performance.now()-started});}
    catch(error){return createKernelError(task.id,error,{retryable:error?.name==='AbortError',code:error?.name==='AbortError'?'ABORTED':'HANDLER_ERROR'});}finally{this.controllers.delete(task.id);}
  }
}
