import { readFile } from 'node:fs/promises';

const [app, index, view, advanced, storage] = await Promise.all([
  readFile(new URL('../apps/studio/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/view.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/advanced-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/storage.js', import.meta.url), 'utf8'),
]);

const checks = [
  ['app instantiates Cut runtime', /createCutPlaybackRuntime\(\{/.test(app)],
  ['app instantiates delivery runtime', /createCompositionDeliveryRuntime\(\{/.test(app)],
  ['app presents Cut frames directly', /cutPlayback\.present\(graph\(\), transport\.time/.test(app)],
  ['app renders delivery from current graph', /deliveryRuntime\.render\(graph\(\), output\.id/.test(app)],
  ['app no longer owns a separate BrowserFrameProvider', !/new BrowserFrameProvider/.test(app)],
  ['app no longer drives HTML media source time', !/sourceTimeForClip/.test(app)],
  ['app runtime version constant matches 0.16', /const APP_VERSION = "0\.16\.0";/.test(app)],
  ['Cut compatibility bootstrap removed', !/cut-playback-bootstrap\.js/.test(index)],
  ['delivery compatibility bootstrap removed', !/composition-delivery-bootstrap\.js/.test(index)],
  ['advanced runtime no longer owns a DOM mutation observer', !/MutationObserver/.test(advanced)],
  ['advanced runtime exposes an explicit graph-provider seam', /setAdvancedRuntimeGraphProvider/.test(advanced) && /graphProvider/.test(advanced)],
  ['advanced runtime routes graph reads through its provider', /let graphProvider = \(\) => loadStoredGraph\(\)/.test(advanced) && /const graph = await graphProvider\(\)/.test(advanced)],
  ['storage graph reads are cache-first after bootstrap', /loadStoredGraph\(\) \{ return currentGraphCache\?\?/.test(storage)],
  ['storage publishes and advances the shared graph cache', /getCachedStoredGraph/.test(storage) && /currentGraphCache=graph/.test(storage) && /currentGraphCache=record\.graph/.test(storage)],
];

const remaining = [
  ['brand badge still hardcodes the legacy 0.4 label', /<span class="alpha">0\.4<\/span>/.test(view)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'ok' : 'not ok'} - ${label}`);
for (const [label, present] of remaining) if (present) console.log(`todo - ${label}`);
if (failed.length) {
  throw new Error(`Runtime ownership check failed: ${failed.map(([label]) => label).join(', ')}`);
}
