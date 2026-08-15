import {
  COLLABORATION_RESOLUTION_CHOICES,
  collaborationResolutionDraftProgress,
  setCollaborationResolutionDecision,
} from '../../packages/core/src/collaboration-resolution-decisions.js';

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const choiceLabels = Object.freeze({
  'keep-local': ['Keep local', 'Leave the current local state unchanged for this remote edit.'],
  'reapply-remote': ['Reapply remote', 'Recreate this remote change against refreshed state, then sign a new batch.'],
  manual: ['Resolve manually', 'Return to the editor and make an explicit replacement edit.'],
});

function unique(values) { return [...new Set(values)]; }
function rowMap(model) { return new Map((model?.rows ?? []).map((row) => [row.id, row])); }

function renderLocalConflicts(group, rows) {
  const items = group.rowIds.map((id) => rows.get(id)).filter(Boolean);
  if (!items.length) return '<div class="collaboration-resolution-local-empty">Local conflict details are unavailable.</div>';
  return `<ul class="collaboration-resolution-local-list">${items.map((row) => `<li><strong>${escapeHtml(row.local.label)}</strong><span>${escapeHtml(row.local.operation.summary)}</span></li>`).join('')}</ul>`;
}

function renderResources(group) {
  const labels = unique((group.resources ?? []).flatMap((pair) => [pair?.local?.label, pair?.remote?.label]).filter(Boolean));
  if (!labels.length) return '';
  return `<div class="collaboration-resolution-resources"><span>Affected</span>${labels.map((label) => `<code>${escapeHtml(label)}</code>`).join('')}</div>`;
}

function renderDecisionButtons(group) {
  return `<div class="collaboration-resolution-choices" role="group" aria-label="Resolution for ${escapeHtml(group.remote.operation.summary)}">${COLLABORATION_RESOLUTION_CHOICES.map((choice) => {
    const [label, description] = choiceLabels[choice];
    const selected = group.decision === choice;
    return `<button type="button" class="quiet-button collaboration-resolution-choice${selected ? ' selected' : ''}" data-collaboration-decision="${choice}" data-resolution-group-id="${escapeHtml(group.id)}" aria-pressed="${selected ? 'true' : 'false'}"><strong>${label}</strong><small>${description}</small></button>`;
  }).join('')}</div>`;
}

export function renderCollaborationResolutionDecisionPanel({ model, draft }) {
  const progress = collaborationResolutionDraftProgress(draft);
  const rows = rowMap(model);
  const incomplete = !draft.sourceComplete || Number(draft.conflictsTruncated ?? 0) > 0;
  const warning = incomplete
    ? `<div class="collaboration-resolution-warning" role="alert"><strong>Conflict details are incomplete.</strong><span>Refresh before deciding; ${Math.max(0, Number(draft.conflictsTruncated ?? 0))} conflict${Number(draft.conflictsTruncated ?? 0) === 1 ? '' : 's'} were omitted by the bounded response.</span></div>`
    : '';
  const groups = draft.groups.map((group, index) => `<article class="collaboration-resolution-group" data-resolution-group="${escapeHtml(group.id)}"><header><span class="eyebrow">REMOTE EDIT ${index + 1}</span><strong>${escapeHtml(group.remote.label)}</strong><p>${escapeHtml(group.remote.operation.summary)}</p></header><div class="collaboration-resolution-local"><span>Conflicts with local edits</span>${renderLocalConflicts(group, rows)}</div>${renderResources(group)}${renderDecisionButtons(group)}</article>`).join('');
  const readiness = progress.ready && !incomplete;
  return `<section class="collaboration-resolution-panel" data-collaboration-resolution><div class="panel-heading"><span>COLLABORATION CONFLICT</span><small>${progress.decided}/${progress.total} decided</small></div><div class="collaboration-resolution-context"><span>Actor ${escapeHtml(draft.actor?.id ?? 'unknown')}</span><span>Key ${escapeHtml(draft.actor?.keyId ?? 'unknown')}</span><span>Head ${escapeHtml(draft.head?.sequence ?? 0)}</span></div>${warning}<div class="collaboration-resolution-groups">${groups}</div><footer class="collaboration-resolution-footer"><p>${readiness ? 'All conflict groups have explicit decisions. A separate refresh/edit/sign step is still required.' : 'Choose one explicit action for every remote edit. No merge will run automatically.'}</p><button type="button" class="primary-button" data-collaboration-resolution-finalize ${readiness ? '' : 'disabled'}>Review resolution intent</button></footer></section>`;
}

export function applyCollaborationResolutionDecision(draft, { groupId, choice } = {}) {
  return setCollaborationResolutionDecision(draft, String(groupId ?? ''), String(choice ?? ''));
}

export function decisionFromCollaborationControl(draft, control) {
  const groupId = control?.dataset?.resolutionGroupId;
  const choice = control?.dataset?.collaborationDecision;
  return applyCollaborationResolutionDecision(draft, { groupId, choice });
}
