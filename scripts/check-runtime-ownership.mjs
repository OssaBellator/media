import { readFile } from 'node:fs/promises';

const [app, index] = await Promise.all([
  readFile(new URL('../apps/studio/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/studio/index.html', import.meta.url), 'utf8'),
]);

const checks = [
  ['app instantiates Cut runtime', /createCutPlaybackRuntime\(\{/.test(app)],
  ['app instantiates delivery runtime', /createCompositionDeliveryRuntime\(\{/.test(app)],
  ['app presents Cut frames directly', /cutPlayback\.present\(graph\(\), transport\.time/.test(app)],
  ['app renders delivery from current graph', /deliveryRuntime\.render\(graph\(\), output\.id/.test(app)],
  ['app no longer owns a separate BrowserFrameProvider', !/new BrowserFrameProvider/.test(app)],
  ['app no longer drives HTML media source time', !/sourceTimeForClip/.test(app)],
  ['visible app version matches 0.16', /const APP_VERSION = "0\.16\.0";/.test(app)],
  ['Cut compatibility bootstrap removed', !/cut-playback-bootstrap\.js/.test(index)],
  ['delivery compatibility bootstrap removed', !/composition-delivery-bootstrap\.js/.test(index)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'ok' : 'not ok'} - ${label}`);
if (failed.length) {
  throw new Error(`Runtime ownership check failed: ${failed.map(([label]) => label).join(', ')}`);
}
