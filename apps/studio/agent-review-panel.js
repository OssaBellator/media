const escapeHtml = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function previewChangeValue(value) {
  if (value === undefined) return '—';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value ?? 'null');
  try { return JSON.stringify(value); } catch { return String(value); }
}

function operationMarkup(operation, atomic = false) {
  const changes = operation.changes?.length
    ? `<ul>${operation.changes.map((change) => `<li><code>${escapeHtml(change.path)}</code> ${escapeHtml(previewChangeValue(change.before))} → ${escapeHtml(previewChangeValue(change.after))}</li>`).join('')}</ul>`
    : '';
  return `<label class="activity-card agent-operation"><div><input type="checkbox" data-agent-operation="${operation.index}" checked ${atomic ? 'disabled' : ''}/><strong>${escapeHtml(operation.summary)}</strong></div><p>${escapeHtml(operation.type)}</p>${changes}</label>`;
}

function reviewMarkup(state) {
  if (state.status === 'idle') return '';
  if (state.status === 'stale') {
    return `<section class="activity-card agent-review" data-agent-review><div><span class="activity-dot"></span><strong>Proposal is stale</strong></div><p>The project changed after this proposal was created. Re-plan against the current graph or discard it.</p><div class="button-grid"><button type="button" data-agent-revise>Re-plan</button><button type="button" data-agent-discard>Discard</button></div></section>`;
  }
  const review = state.review;
  if (!review) return '';
  const workflow = state.workflow ? `<span>${state.workflow.taskCount} workflow tasks · ${state.workflow.assetWriteCount} staged asset writes</span>` : '';
  const operationCount = review.operations.length;
  const atomic = state.plan?.metadata?.review?.atomic === true || state.plan?.metadata?.creativeObjectRestyle?.atomic === true;
  const selectionHint = !operationCount ? 'This proposal has no graph operations.' : atomic ? 'This proposal is atomic: generated assets, provenance, and rewires apply together.' : 'Uncheck operations you do not want committed.';
  return `<section class="agent-review" data-agent-review><article class="activity-card"><div><span class="activity-dot"></span><strong>${escapeHtml(review.summary || review.intent)}</strong></div><p>${escapeHtml(review.provider?.label || review.provider?.id)} · revision ${review.revision} · ${operationCount} operation${operationCount === 1 ? '' : 's'}</p>${workflow}</article><div class="activity-list">${review.operations.map((operation) => operationMarkup(operation, atomic)).join('')}</div><div class="command-footer"><span>${selectionHint}</span><div class="button-grid"><button type="button" data-agent-discard>Discard</button><button type="button" data-agent-revise>Re-plan</button><button type="button" class="primary-button" data-agent-apply ${operationCount ? '' : 'disabled'}>${atomic ? 'Apply all' : 'Apply selected'}</button></div></div></section>`;
}

export function renderAgentReviewPanel(root, state) {
  if (!root) return null;
  root.querySelector('[data-agent-review]')?.remove();
  const submit = root.querySelector('#agent-form button[type="submit"]');
  if (submit) submit.textContent = state?.status === 'idle' ? 'Propose' : 'Proposal pending';
  const form = root.querySelector('#agent-form');
  if (!form) return null;
  const markup = reviewMarkup(state ?? { status: 'idle' });
  if (markup) form.insertAdjacentHTML('afterend', markup);
  return root.querySelector('[data-agent-review]');
}

export function selectedAgentOperationIndexes(root) {
  if (!root) return [];
  return [...root.querySelectorAll('[data-agent-operation]')]
    .filter((input) => input.checked)
    .map((input) => Number(input.dataset.agentOperation))
    .filter((index) => Number.isSafeInteger(index) && index >= 0);
}
