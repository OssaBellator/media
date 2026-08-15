import { readFile } from 'node:fs/promises';

const [app, index, view, advanced] = await Promise.all([
  readFile(new URL('../apps/studio/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/view.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/advanced-runtime.js', import.meta.url), 'utf8'),
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
];

const remaining = [
  ['advanced runtime still owns a DOM observer', /new MutationObserver/.test(advanced)],
  ['advanced runtime still reloads graph state from storage', /loadStoredGraph/.test(advanced)],
  ['brand badge still hardcodes the legacy 0.4 label', /<span class="alpha">0\.4<\/span>/.test(view)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'ok' : 'not ok'} - ${label}`);
for (const [label, present] of remaining) if (present) console.log(`todo - ${label}`);
if (failed.length) {
  throw new Error(`Runtime ownership check failed: ${failed.map(([label]) => label).join(', ')}`);
}
