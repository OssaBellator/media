import { assertValidGraph } from './graph.js';
import { applyTransaction } from './operations.js';
import { canonicalOperationLogJson, operationLogHead, validateOperationLog } from './operation-log.js';
import { createOperationBatch, signOperationBatch } from './operation-batch.js';
import {
  COLLABORATION_RESOLUTION_CHOICES,
  COLLABORATION_RESOLUTION_INTENT_SCHEMA,
} from './collaboration-resolution-decisions.js';

const CHOICES = new Set(COLLABORATION_RESOLUTION_CHOICES);
export class CollaborationResolutionBatchError extends Error {
  constructor(message, { code = 'ERR_COLLABORATION_RESOLUTION_BATCH', groupId = null, transactionId = null } = {}) {
    super(message);
    this.name = 'CollaborationResolutionBatchError';
    this.code = code;
    this.groupId = groupId;
    this.transactionId = transactionId;
  }
}
function clone(value) { return JSON.parse(canonicalOperationLogJson(value)); }
function token(value, label, details = {}) {
  if (typeof value !== 'string' || !value) throw new CollaborationResolutionBatchError(`${label} is required`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_FORMAT', ...details });
  return value;
}
function sameHead(a, b) {
  return a?.sequence === b?.sequence && (a?.checksum ?? null) === (b?.checksum ?? null) && (a?.transactionId ?? null) === (b?.transactionId ?? null);
}
function validateIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent) || intent.schema !== COLLABORATION_RESOLUTION_INTENT_SCHEMA || intent.status !== 'final') {
    throw new CollaborationResolutionBatchError('Final collaboration resolution intent is required', { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_INTENT' });
  }
  token(intent.modelFingerprint, 'Resolution intent modelFingerprint');
  if (!intent.head || typeof intent.head !== 'object' || Array.isArray(intent.head) || !Number.isSafeInteger(intent.head.sequence) || intent.head.sequence < 0) {
    throw new CollaborationResolutionBatchError('Resolution intent head is invalid', { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_INTENT' });
  }
  if (!Array.isArray(intent.decisions)) throw new CollaborationResolutionBatchError('Resolution intent decisions are required', { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_INTENT' });
  const groups = new Set();
  for (const decision of intent.decisions) {
    const groupId = token(decision?.groupId, 'Resolution decision groupId');
    if (groups.has(groupId)) throw new CollaborationResolutionBatchError(`Duplicate resolution group: ${groupId}`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_GROUP', groupId });
    groups.add(groupId);
    if (!CHOICES.has(decision.choice)) throw new CollaborationResolutionBatchError(`Unsupported resolution choice: ${decision.choice}`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_CHOICE', groupId });
    if (!decision.remote || !Number.isSafeInteger(decision.remote.sequence) || decision.remote.sequence < 1 || !Number.isSafeInteger(decision.remote.operationIndex) || decision.remote.operationIndex < 0) {
      throw new CollaborationResolutionBatchError(`Resolution decision remote coordinate is invalid: ${groupId}`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_INTENT', groupId });
    }
    token(decision.remote.transactionId, 'Resolution decision remote transactionId', { groupId });
  }
  canonicalOperationLogJson(intent);
  return intent;
}
function validateReplacements(replacements) {
  if (!replacements || typeof replacements !== 'object' || Array.isArray(replacements)) throw new CollaborationResolutionBatchError('Resolution replacements must be an object keyed by group ID', { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_REPLACEMENTS' });
  return replacements;
}
function validateTransaction(transaction, { groupId, existingIds, seenIds }) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) throw new CollaborationResolutionBatchError(`Resolution group ${groupId} transaction must be an object`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_TRANSACTION', groupId });
  const transactionId = token(transaction.id, 'Resolution transaction id', { groupId });
  token(transaction.label, 'Resolution transaction label', { groupId, transactionId });
  if (!Array.isArray(transaction.operations) || !transaction.operations.length) throw new CollaborationResolutionBatchError(`Resolution transaction ${transactionId} must contain operations`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_TRANSACTION', groupId, transactionId });
  if (existingIds.has(transactionId)) throw new CollaborationResolutionBatchError(`Resolution transaction reuses journal transaction ID: ${transactionId}`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_REUSED_TRANSACTION', groupId, transactionId });
  if (seenIds.has(transactionId)) throw new CollaborationResolutionBatchError(`Resolution transaction is reused across groups: ${transactionId}`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_REUSED_TRANSACTION', groupId, transactionId });
  const clean = clone(transaction);
  if (clean.metadata?.collaborationResolution != null) throw new CollaborationResolutionBatchError(`Resolution transaction ${transactionId} already contains collaboration resolution provenance`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_PROVENANCE', groupId, transactionId });
  seenIds.add(transactionId);
  return clean;
}
function withProvenance(transaction, intent, decision) {
  return {
    ...transaction,
    metadata: {
      ...(transaction.metadata ?? {}),
      collaborationResolution: {
        schema: COLLABORATION_RESOLUTION_INTENT_SCHEMA,
        requestId: intent.requestId ?? null,
        modelFingerprint: intent.modelFingerprint,
        head: clone(intent.head),
        groupId: decision.groupId,
        choice: decision.choice,
        remote: clone(decision.remote),
      },
    },
  };
}
export async function buildSignedCollaborationResolutionBatch({
  intent,
  graph,
  log,
  replacements = {},
  actorId = null,
  keyId = null,
  issuedAt = null,
  nonce = null,
  sign = null,
} = {}) {
  validateIntent(intent);
  validateOperationLog(log);
  assertValidGraph(graph);
  if (graph.projectId !== log.projectId) throw new CollaborationResolutionBatchError('Resolution graph/log project mismatch', { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_PROJECT' });
  const head = operationLogHead(log);
  if (!sameHead(intent.head, head)) throw new CollaborationResolutionBatchError('Resolution intent head is stale; refresh and decide again', { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_HEAD' });
  validateReplacements(replacements);
  const decisions = new Map(intent.decisions.map((decision) => [decision.groupId, decision]));
  for (const groupId of Object.keys(replacements)) if (!decisions.has(groupId)) throw new CollaborationResolutionBatchError(`Replacement supplied for unknown resolution group: ${groupId}`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_GROUP', groupId });
  const existingIds = new Set(log.entries.map((entry) => entry.transaction.id));
  const seenIds = new Set();
  const transactions = [];
  const provenance = [];
  let nextGraph = clone(graph);
  for (const decision of intent.decisions) {
    const supplied = replacements[decision.groupId] ?? [];
    if (!Array.isArray(supplied)) throw new CollaborationResolutionBatchError(`Resolution replacements for ${decision.groupId} must be an array`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_REPLACEMENTS', groupId: decision.groupId });
    if (decision.choice === 'keep-local') {
      if (supplied.length) throw new CollaborationResolutionBatchError(`Keep-local group ${decision.groupId} must not supply replacement transactions`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_CHOICE', groupId: decision.groupId });
      provenance.push({ groupId: decision.groupId, choice: decision.choice, transactionIds: [] });
      continue;
    }
    if (!supplied.length) throw new CollaborationResolutionBatchError(`Resolution group ${decision.groupId} requires fresh editor transactions`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_MISSING_REPLACEMENT', groupId: decision.groupId });
    const ids = [];
    for (const value of supplied) {
      const clean = validateTransaction(value, { groupId: decision.groupId, existingIds, seenIds });
      const tagged = withProvenance(clean, intent, decision);
      try { nextGraph = applyTransaction(nextGraph, tagged); }
      catch (cause) { throw new CollaborationResolutionBatchError(`Resolution transaction ${tagged.id} is invalid: ${cause.message}`, { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_APPLY', groupId: decision.groupId, transactionId: tagged.id }); }
      transactions.push(tagged);
      ids.push(tagged.id);
    }
    provenance.push({ groupId: decision.groupId, choice: decision.choice, transactionIds: ids });
  }
  const resolution = { requestId: intent.requestId ?? null, modelFingerprint: intent.modelFingerprint, head: clone(head), decisions: provenance };
  if (!transactions.length) return { status: 'no-op', batch: null, nextGraph: clone(graph), transactions: [], resolution };
  token(actorId, 'Resolution batch actorId');
  token(keyId, 'Resolution batch keyId');
  token(nonce, 'Resolution batch nonce');
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) throw new CollaborationResolutionBatchError('Resolution batch issuedAt must be a non-negative safe integer', { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_FRESHNESS' });
  if (typeof sign !== 'function') throw new CollaborationResolutionBatchError('Resolution batch signer is required', { code: 'ERR_COLLABORATION_RESOLUTION_BATCH_SIGNATURE' });
  const unsigned = createOperationBatch(log, transactions, { actorId, keyId, issuedAt, nonce });
  const batch = await signOperationBatch(unsigned, { sign });
  return { status: 'signed', batch, nextGraph: clone(nextGraph), transactions: clone(transactions), resolution };
}
