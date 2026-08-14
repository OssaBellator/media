import { createProductionKernelRuntime } from './production-kernel-runtime.js';
import { collectTransferables } from './kernel-transfer.js';
const runtime = createProductionKernelRuntime();
self.addEventListener('message', async (event) => {
  const message = event.data;
  if (message?.type === 'cancel') { runtime.cancel(message.id); return; }
  if (message?.type !== 'task') return;
  const result = await runtime.execute(message, { onProgress: (progress) => self.postMessage(progress, collectTransferables(progress)) });
  self.postMessage(result, collectTransferables(result));
});
