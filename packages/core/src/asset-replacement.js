export const ASSET_REPLACEMENT_CONSUMER_KINDS = Object.freeze(['clip', 'layer']);
const CONSUMER_KIND_SET = new Set(ASSET_REPLACEMENT_CONSUMER_KINDS);

function requireAsset(graph, assetId, label) {
  const asset = graph?.nodes?.[assetId];
  if (!asset || asset.kind !== 'asset') throw new Error(`${label}: ${assetId}`);
  return asset;
}
function mediaFamily(kind) {
  return kind === 'music' ? 'audio' : String(kind ?? 'unknown');
}
function assertCompatibleAssets(source, replacement) {
  const sourceKind = mediaFamily(source.props?.mediaKind);
  const replacementKind = mediaFamily(replacement.props?.mediaKind);
  if (sourceKind !== replacementKind) throw new Error(`Replacement asset media kind ${replacementKind} does not match source ${sourceKind}`);
}

export function assetReplacementConsumers(graph, assetId) {
  requireAsset(graph, assetId, 'Unknown replacement source asset');
  return Object.values(graph.nodes ?? {})
    .filter((node) => CONSUMER_KIND_SET.has(node.kind) && node.props?.assetId === assetId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveAssetReplacement(graph, {
  sourceAssetId,
  replacementAssetId,
  consumerNodeIds = null,
} = {}) {
  const sourceAsset = requireAsset(graph, sourceAssetId, 'Unknown replacement source asset');
  const replacementAsset = requireAsset(graph, replacementAssetId, 'Unknown replacement asset');
  if (sourceAsset.id === replacementAsset.id) throw new Error('Replacement asset must differ from source asset');
  assertCompatibleAssets(sourceAsset, replacementAsset);
  const available = assetReplacementConsumers(graph, sourceAsset.id);
  let consumers = available;
  if (consumerNodeIds != null) {
    if (!Array.isArray(consumerNodeIds)) throw new Error('Replacement consumerNodeIds must be an array');
    const requested = [...new Set(consumerNodeIds.map((value) => String(value)))].sort();
    const byId = new Map(available.map((node) => [node.id, node]));
    consumers = requested.map((id) => {
      const node = byId.get(id);
      if (!node) throw new Error(`Replacement consumer ${id} does not reference source asset ${sourceAsset.id}`);
      return node;
    });
  }
  return { sourceAsset, replacementAsset, consumers };
}

export function createAssetReplacementOperations(graph, options = {}) {
  const resolved = resolveAssetReplacement(graph, options);
  return resolved.consumers.map((node) => ({
    type: 'node.update',
    nodeId: node.id,
    patch: { props: { assetId: resolved.replacementAsset.id } },
  }));
}
