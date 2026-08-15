const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function statusCopy(state, embeddingAvailable) {
  if (state?.status === 'searching') return 'Lexical results ready · refining with derived embeddings…';
  if (state?.mode === 'hybrid') return state.cache?.cached ? 'Hybrid ranking · cached derived embeddings' : 'Hybrid ranking · fresh derived embeddings';
  if (state?.mode === 'lexical-fallback') return 'Local lexical ranking · embedding refinement unavailable';
  return embeddingAvailable ? 'Local lexical ranking · hybrid ranking available' : 'Local lexical ranking · no embedding backend registered';
}

function resultMarkup(result) {
  return `<button type="button" class="semantic-result" data-semantic-result-id="${escapeHtml(result.id)}"><span><strong>${escapeHtml(result.name || result.id)}</strong><small>${escapeHtml(result.kind || 'node')}</small></span><code>${escapeHtml(result.id)}</code></button>`;
}

export function semanticSearchPanelMarkup(state = {}, { embeddingAvailable = false, useEmbeddings = true } = {}) {
  const query = String(state.query ?? '');
  const results = Array.isArray(state.results) ? state.results : [];
  const status = statusCopy(state, embeddingAvailable);
  const resultBody = !query
    ? '<div class="semantic-search-empty">Search names, tags, semantic attributes, relationships, assets, clips and layers in the current Creative Graph.</div>'
    : results.length
      ? `<div class="semantic-results">${results.map(resultMarkup).join('')}</div>`
      : '<div class="semantic-search-empty">No matching graph nodes.</div>';
  return `<section class="semantic-search-panel" data-semantic-search><div class="semantic-search-head"><div><span class="eyebrow">SEMANTIC SEARCH</span><strong>Search the same Creative Graph.</strong></div><span class="semantic-search-status">${escapeHtml(status)}</span></div><form class="semantic-search-form" data-semantic-search-form><input type="search" data-semantic-query value="${escapeHtml(query)}" placeholder="Find Maya, product shots, dialogue, blue logo…" autocomplete="off"/><button type="submit">Search graph</button></form><div class="semantic-search-options"><label><input type="checkbox" data-semantic-embeddings ${useEmbeddings ? 'checked' : ''} ${embeddingAvailable ? '' : 'disabled'}/> Refine with embeddings when available</label><span>Lexical search stays local and always available.</span></div><div class="semantic-search-body" data-semantic-search-body>${resultBody}</div></section>`;
}
