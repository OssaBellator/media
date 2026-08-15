import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../advanced-runtime.js', import.meta.url), 'utf8');

test('advanced runtime no longer owns mutation observation or inline DOM injection', () => {
  assert.equal(/MutationObserver/.test(source), false);
  assert.equal(/function inject\(/.test(source), false);
  assert.match(source, /#advanced-runtime-panel/);
  assert.match(source, /document\.addEventListener\('click'/);
});

test('advanced runtime exposes an explicit graph-provider handoff seam', () => {
  assert.match(source, /export function setAdvancedRuntimeGraphProvider\(provider\)/);
  assert.match(source, /let graphProvider = \(\) => loadStoredGraph\(\)/);
  assert.match(source, /const graph = await graphProvider\(\)/);
});

test('advanced runtime keeps resumable render and proxy actions after observer removal', () => {
  for (const action of ['render-mp4', 'render-webm', 'resume-mp4', 'finalize-mp4', 'clear-mp4', 'loudness', 'build-proxy']) {
    assert.match(source, new RegExp(`['\"]${action}['\"]`));
  }
  assert.match(source, /cancelAdvancedRuntime/);
  assert.match(source, /closeAdvancedRuntime/);
});
