import { createDefaultKernelRuntime } from './kernel-handlers.js';
const runtime = createDefaultKernelRuntime();
self.addEventListener('message', async (event) => {
  const message = event.data;
  if (message?.type === 'cancel') { runtime.cancel(message.id); return; }
  if (message?.type !== 'task') return;
  const result = await runtime.execute(message, { onProgress: (progress) => self.postMessage(progress) });
  const transfer = [];
  if (result.type === 'result' && Array.isArray(result.result?.channels)) transfer.push(...result.result.channels.filter((value) => value instanceof ArrayBuffer));
  self.postMessage(result, transfer);
});
