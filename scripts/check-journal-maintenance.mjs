import { readFile } from 'node:fs/promises';

const [historySession, storage, storageMaintenance] = await Promise.all([
  readFile(new URL('../apps/studio/history-journal-session.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/storage.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/storage-maintenance.js', import.meta.url), 'utf8'),
]);
const checks = [
  ['history session defaults to a 250-entry journal threshold', /DEFAULT_JOURNAL_COMPACT_ENTRIES=250/.test(historySession)],
  ['history session uses durable compare-and-swap compaction', /compactStoredOperationJournal/.test(historySession) && /expectedSequence:sequence/.test(historySession) && /expectedChecksum:checksum/.test(historySession)],
  ['automatic compaction is checked after durable history actions', /#compactIfNeeded\('edit'\)/.test(historySession) && /#compactIfNeeded\(action\)/.test(historySession)],
  ['history session applies 90 to 80 percent source cleanup policy', /DEFAULT_ASSET_GC_PRESSURE_RATIO=\.9/.test(historySession) && /DEFAULT_ASSET_GC_TARGET_RATIO=\.8/.test(historySession)],
  ['asset cleanup is triggered by durable Blob writes and project replacement', /persistContext\?\.assetWrites/.test(historySession) && /#collectAssetsIfNeeded\(true\)/.test(historySession)],
  ['history retention includes present past and future assets', /this\.history\.past\.map/.test(historySession) && /this\.history\.future\.map/.test(historySession) && /#retentionGraph/.test(historySession)],
  ['maintenance failure is isolated from edit failure', /maintenanceFailures\+\+/.test(historySession) && /return\{compacted:false,error\}/.test(historySession) && /deleteBytes:0,error/.test(historySession)],
  ['storage compaction rolls the current graph into the new base', /journalBaseGraph:current\.graph/.test(storage) && /journalSequence:0/.test(storage)],
  ['retention-aware cleanup unions persisted and history graphs', /mergeAssetRetentionGraph/.test(storageMaintenance) && /current\.graph,retentionGraph/.test(storageMaintenance)],
  ['retention-aware cleanup deletes inside one workspace assets transaction', /transaction\(\['workspace','assets'\],'readwrite'\)/.test(storageMaintenance)],
];
const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'ok' : 'not ok'} - ${label}`);
if (failed.length) throw new Error(`Journal maintenance check failed: ${failed.map(([label]) => label).join(', ')}`);
