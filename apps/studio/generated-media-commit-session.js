import { runGeneratedMediaModel } from '../../packages/core/src/generation-runner.js';

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}

export function generatedPayloadBlob(payload, mimeType = '') {
  if (payload instanceof Blob) return payload.type === mimeType || !mimeType ? payload : new Blob([payload], { type: mimeType });
  if (payload instanceof ArrayBuffer) return new Blob([payload], { type: mimeType });
  if (ArrayBuffer.isView(payload)) return new Blob([payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)], { type: mimeType });
  throw new Error('Generated media payload must be Blob or binary data');
}

function persistedAssetMetadata(asset, size) {
  const props = asset.props ?? {};
  return {
    name: asset.name,
    mediaKind: props.mediaKind,
    mimeType: props.mimeType ?? '',
    size,
    ...(props.hash != null ? { hash: props.hash } : {}),
    ...(props.duration != null ? { duration: props.duration } : {}),
    ...(props.width != null ? { width: props.width } : {}),
    ...(props.height != null ? { height: props.height } : {}),
  };
}

function replaceGeneratedAssetOperation(operations, asset) {
  return operations.map((operation) => operation.type === 'node.add' && operation.node?.id === asset.id ? { ...operation, node: asset } : operation);
}

export function prepareGeneratedMediaPersistence(routed, { assetUri = (assetId) => `media://asset/${assetId}` } = {}) {
  if (!routed?.asset || !routed?.generation) throw new Error('Generated media persistence requires a routed generation result');
  if (typeof assetUri !== 'function') throw new Error('Generated media assetUri must be a function');
  const mimeType = routed.asset.props?.mimeType ?? routed.artifact?.mimeType ?? '';
  const blob = generatedPayloadBlob(routed.payload, mimeType);
  const declaredSize = Number(routed.asset.props?.size ?? 0);
  if (declaredSize > 0 && declaredSize !== blob.size) throw new Error(`Generated artifact size ${declaredSize} does not match payload size ${blob.size}`);
  const asset = { ...routed.asset, props: { ...routed.asset.props, uri: assetUri(routed.asset.id), size: blob.size } };
  const operations = replaceGeneratedAssetOperation(routed.operations, asset);
  const metadata = {
    source: 'model',
    generation: {
      id: routed.generation.id,
      operation: routed.generation.operation,
      backendId: routed.backendId,
      parentPlanId: routed.generation.parentPlanId,
    },
  };
  const persistContext = { assetWrites: [{ assetId: asset.id, blob, metadata: persistedAssetMetadata(asset, blob.size) }] };
  return { asset, operations, blob, metadata, persistContext };
}

export class GeneratedMediaCommitSession {
  constructor({ router, getGraph, commit, assetUri = (assetId) => `media://asset/${assetId}` } = {}) {
    if (!router || typeof router.execute !== 'function') throw new Error('Generated media commit session requires a model router');
    this.router = router;
    this.getGraph = requireFunction(getGraph, 'Generated media getGraph');
    this.commit = requireFunction(commit, 'Generated media commit');
    this.assetUri = requireFunction(assetUri, 'Generated media assetUri');
  }

  async generate(options = {}) {
    const graph = this.getGraph();
    const routed = await runGeneratedMediaModel(this.router, graph, options);
    const prepared = prepareGeneratedMediaPersistence(routed, { assetUri: this.assetUri });
    const label = options.label || `${routed.generation.operation} · ${prepared.asset.name}`;
    const result = await this.commit(label, prepared.operations, prepared.metadata, { persistContext: prepared.persistContext });
    return { ...routed, ...prepared, result };
  }
}
