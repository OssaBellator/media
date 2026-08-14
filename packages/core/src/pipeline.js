import { createRenderJobPlan } from './render-jobs.js';
import { planProjectDerivatives } from './proxy.js';
function task(id, kind, { dependsOn = [], payload = {}, optional = false } = {}) { return { id, kind, dependsOn: [...dependsOn], payload: structuredClone(payload), optional, status: 'pending' }; }
export function createProductionPipeline(renderManifest, sources = [], { chunkFrames = 120, includeProxies = true } = {}) {
  const renderJob = createRenderJobPlan(renderManifest, { chunkFrames }); const tasks = [];
  for (const source of sources) tasks.push(task(`source:${source.id}`, 'verify-source', { payload: { source } }));
  const derivativeTasks = includeProxies ? planProjectDerivatives(sources) : [];
  for (const derivative of derivativeTasks) tasks.push(task(derivative.key, derivative.type, { dependsOn: [`source:${derivative.assetId}`], payload: derivative, optional: true }));
  const sourceDeps = sources.map((source) => `source:${source.id}`); const renderIds = [];
  for (const chunk of renderJob.chunks) { const id = `frames:${chunk.id}`; renderIds.push(id); tasks.push(task(id, 'render-frames', { dependsOn: sourceDeps, payload: { chunk, settings: renderJob.settings } })); }
  const audioId = renderManifest.settings.includeAudio ? `audio:${renderJob.signature}` : null;
  if (audioId) tasks.push(task(audioId, 'render-audio', { dependsOn: sourceDeps, payload: { settings: renderJob.settings } }));
  const encodedIds = renderIds.map((renderId, index) => { const id = `encode:${renderJob.signature}:${String(index).padStart(5,'0')}`; tasks.push(task(id, 'encode-video', { dependsOn: [renderId], payload: { settings: renderJob.settings, chunkIndex: index } })); return id; });
  const muxId = `mux:${renderJob.signature}`; tasks.push(task(muxId, 'mux', { dependsOn: [...encodedIds, ...(audioId ? [audioId] : [])], payload: { settings: renderJob.settings } }));
  const plan = { version: 1, id: `pipeline:${renderJob.signature}`, signature: renderJob.signature, renderJob, tasks, finalTaskId: muxId }; assertPipelineAcyclic(plan); return plan;
}
export function assertPipelineAcyclic(plan) {
  const ids = new Set(plan.tasks.map((item) => item.id)); if (ids.size !== plan.tasks.length) throw new Error('Pipeline contains duplicate task ids');
  for (const item of plan.tasks) for (const dependency of item.dependsOn) if (!ids.has(dependency)) throw new Error(`Unknown pipeline dependency: ${dependency}`);
  const visiting = new Set(); const visited = new Set(); const map = new Map(plan.tasks.map((item) => [item.id, item]));
  const visit = (id) => { if (visited.has(id)) return; if (visiting.has(id)) throw new Error(`Pipeline cycle detected at ${id}`); visiting.add(id); for (const dep of map.get(id).dependsOn) visit(dep); visiting.delete(id); visited.add(id); };
  for (const item of plan.tasks) visit(item.id); return plan;
}
export function runnablePipelineTasks(plan) { const status = new Map(plan.tasks.map((item) => [item.id, item.status])); return plan.tasks.filter((item) => item.status === 'pending' && item.dependsOn.every((id) => status.get(id) === 'complete')); }
export function updatePipelineTask(plan, taskId, patch) { if (!plan.tasks.some((item) => item.id === taskId)) throw new Error(`Unknown pipeline task: ${taskId}`); return { ...plan, tasks: plan.tasks.map((item) => item.id === taskId ? { ...item, ...structuredClone(patch) } : item) }; }
export function pipelineProgress(plan) { const required = plan.tasks.filter((item) => !item.optional); const complete = required.filter((item) => item.status === 'complete').length; const failed = required.filter((item) => item.status === 'failed').length; const running = required.filter((item) => item.status === 'running').length; return { required: required.length, complete, failed, running, ratio: required.length ? complete / required.length : 1, done: complete === required.length, blocked: failed > 0 }; }
export function skipFailedOptionalTasks(plan) { return { ...plan, tasks: plan.tasks.map((item) => item.optional && item.status === 'failed' ? { ...item, status: 'complete', skipped: true } : item) }; }
