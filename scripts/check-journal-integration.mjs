import { readFile } from 'node:fs/promises';

const [app, storage, historySession, projectSession] = await Promise.all([
  readFile(new URL('../apps/studio/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/storage.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/history-journal-session.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/project-journal-session.js', import.meta.url), 'utf8'),
]);

const checks = [
  ['app imports history journal ownership', /HistoryJournalSession, recoverHistoryJournalSession/.test(app)],
  ['app restores validated operation recovery', /loadStoredOperationRecovery\(\)/.test(app)],
  ['app persists graph and journal entries atomically', /saveStoredGraphWithOperation\(nextGraph, entry\)/.test(app)],
  ['app selects atomic graph+journal+asset persistence when needed', /saveStoredGraphWithOperationAndAssets\(nextGraph, entry, assetWrites\)/.test(app)],
  ['normal Studio edits use the journal', /historyJournal\.edit\(label, operations/.test(app)],
  ['agent operations use the journal', /historyJournal\.edit\(plan\.summary, plan\.operations/.test(app)],
  ['media import uses serialized graph factory commit', /historyJournal\.commitGraphFactory\(label/.test(app)],
  ['media import forwards asset writes out of band', /persistContext: \{ assetWrites \}/.test(app)],
  ['relink forwards replacement Blob with the graph edit', /assetWrites: \[\{ assetId: asset\.id, blob: file/.test(app)],
  ['import no longer prewrites asset Blobs', !/Promise\.all\(saved\.map\(\(\[asset, file\]\) => saveAssetBlob/.test(app)],
  ['relink no longer prewrites replacement Blob', !/await saveAssetBlob\(asset\.id, file/.test(app)],
  ['project open uses journal replacement checkpoint', /historyJournal\.replace\("Open project"/.test(app)],
  ['undo and redo use journal history action', /executeHistoryAction\("undo"\)/.test(app) && /executeHistoryAction\("redo"\)/.test(app)],
  ['app has no direct snapshot commit assignment', !/history\s*=\s*commit\(/.test(app)],
  ['app has no direct undo assignment', !/history\s*=\s*undo\(/.test(app)],
  ['app has no direct redo assignment', !/history\s*=\s*redo\(/.test(app)],
  ['legacy persistGraph helper is removed', !/persistGraph\s*\(/.test(app)],
  ['storage schema includes journal v3', /const DB_VERSION = 3;/.test(storage) && /createObjectStore\("journal"/.test(storage)],
  ['storage validates checkpoint checksum continuity', /does not extend checkpoint checksum/.test(storage)],
  ['storage has atomic workspace journal asset transaction', /\["workspace","journal","assets"\]/.test(storage)],
  ['project journal keeps persistence context outside log payload', /this\.persist\(nextGraph,entry,persistContext\)/.test(projectSession)],
  ['history adapter forwards persistence options', /projectJournal\.commit\(label,operations,metadata,options\)/.test(historySession)],
  ['history adapter evaluates graph factories in serialized order', /commitGraphFactory\(label,createGraph,metadata=\{\},options=\{\}/.test(historySession)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'ok' : 'not ok'} - ${label}`);
if (failed.length) throw new Error(`Journal integration check failed: ${failed.map(([label]) => label).join(', ')}`);
