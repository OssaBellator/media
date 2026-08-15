import { edgesFrom, edgesTo } from './graph.js';

export const SEMANTIC_INDEX_SCHEMA = 'media.semantic-index.v1';
const DEFAULT_MAX_TERMS_PER_NODE = 256;

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase();
}
function tokens(value) {
  return normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}
function addTerms(target, value, weight, source, maxTerms) {
  if (value == null || target.length >= maxTerms) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    for (const term of tokens(value)) {
      if (target.length >= maxTerms) break;
      target.push({ term, weight, source });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addTerms(target, item, weight, source, maxTerms);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (target.length >= maxTerms) break;
      addTerms(target, key, Math.max(1, weight - 1), `${source}:key`, maxTerms);
      addTerms(target, item, weight, `${source}:${key}`, maxTerms);
    }
  }
}
function relationTerms(graph, node) {
  const values = [];
  for (const edge of [...edgesFrom(graph, node.id), ...edgesTo(graph, node.id)]) {
    values.push(edge.type);
    if (edge.props?.role) values.push(edge.props.role);
    const otherId = edge.from === node.id ? edge.to : edge.from;
    const other = graph.nodes[otherId];
    if (other) values.push(other.name, other.kind);
  }
  return values;
}
function documentForNode(graph, node, maxTerms) {
  const weighted = [];
  addTerms(weighted, node.name, 10, 'name', maxTerms);
  addTerms(weighted, node.kind, 4, 'kind', maxTerms);
  if (node.kind === 'asset') {
    addTerms(weighted, node.props?.mediaKind, 6, 'asset:mediaKind', maxTerms);
    addTerms(weighted, node.props?.mimeType, 3, 'asset:mimeType', maxTerms);
  } else if (node.kind === 'object') {
    addTerms(weighted, node.props?.objectType, 8, 'object:type', maxTerms);
    addTerms(weighted, node.props?.semanticId, 6, 'object:semanticId', maxTerms);
    addTerms(weighted, node.props?.tags, 7, 'object:tags', maxTerms);
    addTerms(weighted, node.props?.semantics, 5, 'object:semantics', maxTerms);
    addTerms(weighted, node.props?.attributes, 3, 'object:attributes', maxTerms);
  } else {
    addTerms(weighted, node.props?.role, 5, 'props:role', maxTerms);
    addTerms(weighted, node.props?.mediaKind, 4, 'props:mediaKind', maxTerms);
    addTerms(weighted, node.props?.text, 4, 'props:text', maxTerms);
  }
  addTerms(weighted, relationTerms(graph, node), 3, 'relationships', maxTerms);
  const termWeights = new Map();
  const sources = new Map();
  for (const entry of weighted) {
    termWeights.set(entry.term, Math.max(termWeights.get(entry.term) ?? 0, entry.weight));
    if (!sources.has(entry.term)) sources.set(entry.term, new Set());
    sources.get(entry.term).add(entry.source);
  }
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    normalizedName: normalize(node.name),
    terms: Object.fromEntries([...termWeights.entries()].sort(([a], [b]) => a.localeCompare(b))),
    sources: Object.fromEntries([...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([term, values]) => [term, [...values].sort()])),
  };
}

export function createSemanticIndex(graph, { kinds = null, maxTermsPerNode = DEFAULT_MAX_TERMS_PER_NODE } = {}) {
  const allowed = kinds == null ? null : new Set(kinds.map(String));
  const maxTerms = Math.max(16, Math.min(2048, Math.round(Number(maxTermsPerNode) || DEFAULT_MAX_TERMS_PER_NODE)));
  const documents = Object.values(graph?.nodes ?? {})
    .filter((node) => !allowed || allowed.has(node.kind))
    .map((node) => documentForNode(graph, node, maxTerms))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { schema: SEMANTIC_INDEX_SCHEMA, projectId: graph.projectId, documents };
}

export function searchSemanticIndex(index, query, { limit = 20, kinds = null, minimumScore = 1 } = {}) {
  if (!index || index.schema !== SEMANTIC_INDEX_SCHEMA || !Array.isArray(index.documents)) throw new Error('A valid semantic index is required');
  const queryText = normalize(query).trim();
  const queryTerms = [...new Set(tokens(queryText))];
  if (!queryTerms.length) return [];
  const allowed = kinds == null ? null : new Set(kinds.map(String));
  const maxResults = Math.max(1, Math.min(200, Math.round(Number(limit) || 20)));
  const threshold = Math.max(0, Number(minimumScore) || 0);
  const results = [];
  for (const document of index.documents) {
    if (allowed && !allowed.has(document.kind)) continue;
    let score = 0;
    const matchedTerms = [];
    for (const term of queryTerms) {
      const weight = Number(document.terms?.[term] ?? 0);
      if (!weight) continue;
      score += weight;
      matchedTerms.push(term);
    }
    if (document.normalizedName === queryText) score += 20;
    else if (queryText.length >= 2 && document.normalizedName.includes(queryText)) score += 8;
    if (matchedTerms.length === queryTerms.length && queryTerms.length > 1) score += 4;
    if (score < threshold) continue;
    results.push({ id: document.id, kind: document.kind, name: document.name, score, matchedTerms, sources: Object.fromEntries(matchedTerms.map((term) => [term, document.sources?.[term] ?? []])) });
  }
  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, maxResults);
}

export function searchSemanticGraph(graph, query, options = {}) {
  return searchSemanticIndex(createSemanticIndex(graph, options), query, options);
}
