import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBoundedModelInput,
  normalizeBoundedModelJsonObject,
} from '../src/model-input.js';

test('bounded model input clones structured binary data without sharing caller buffers', () => {
  const pixels = new Uint8Array([1, 2, 3, 4]);
  const samples = new Float32Array([0.25, -0.5]);
  const input = { pixels, nested: { samples }, list: ['tag', 3, true] };
  const clean = normalizeBoundedModelInput(input, 'Test model input', { maxBytes: 1024 });
  assert.deepEqual([...clean.pixels], [1, 2, 3, 4]);
  assert.deepEqual([...clean.nested.samples], [0.25, -0.5]);
  assert.ok(clean.pixels instanceof Uint8Array);
  assert.ok(clean.nested.samples instanceof Float32Array);
  assert.notEqual(clean, input);
  assert.notEqual(clean.pixels, pixels);
  assert.notEqual(clean.pixels.buffer, pixels.buffer);
  assert.notEqual(clean.nested.samples.buffer, samples.buffer);
  pixels[0] = 99;
  assert.equal(clean.pixels[0], 1);
});

test('bounded model input enforces total bytes, depth and entry count', () => {
  assert.throws(() => normalizeBoundedModelInput({ bytes: new Uint8Array(32) }, 'Input', { maxBytes: 16 }), /exceeds 16 bytes/);
  assert.throws(() => normalizeBoundedModelInput({ a: { b: { c: 1 } } }, 'Input', { maxDepth: 2 }), /exceeds depth 2/);
  assert.throws(() => normalizeBoundedModelInput([1, 2, 3], 'Input', { maxEntries: 2 }), /exceeds 2 entries/);
});

test('bounded model input rejects executable, prototype-bearing and cyclic data', () => {
  assert.throws(() => normalizeBoundedModelInput({ callback() {} }, 'Input'), /unsupported function data/);
  assert.throws(() => normalizeBoundedModelInput({ when: new Date() }, 'Input'), /plain data objects/);
  const accessor = {};
  Object.defineProperty(accessor, 'secret', { enumerable: true, get() { throw new Error('must not execute getter'); } });
  assert.throws(() => normalizeBoundedModelInput(accessor, 'Input'), /enumerable data properties only/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => normalizeBoundedModelInput(cyclic, 'Input'), /cannot contain cycles/);
});

test('bounded model input defines __proto__ as data instead of mutating clone prototype', () => {
  const input = {};
  Object.defineProperty(input, '__proto__', { enumerable: true, configurable: true, writable: true, value: { polluted: true } });
  const clean = normalizeBoundedModelInput(input, 'Input');
  assert.equal(Object.getPrototypeOf(clean), Object.prototype);
  assert.equal(Object.prototype.hasOwnProperty.call(clean, '__proto__'), true);
  assert.deepEqual(clean.__proto__, { polluted: true });
  assert.equal({}.polluted, undefined);
});

test('bounded model JSON options are canonical inert clones and reject unsafe or oversized values', () => {
  const value = { b: 2, a: { nested: true } };
  const clean = normalizeBoundedModelJsonObject(value, 'Options', { maxBytes: 1024 });
  assert.deepEqual(clean, value);
  assert.notEqual(clean, value);
  assert.notEqual(clean.a, value.a);
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'secret', { enumerable: true, get() { getterCalls += 1; return 'leak'; } });
  assert.throws(() => normalizeBoundedModelJsonObject(accessor, 'Options'), /JSON-safe.*enumerable data properties only/i);
  assert.equal(getterCalls, 0);
  assert.throws(() => normalizeBoundedModelJsonObject({ bytes: new Uint8Array([1]) }, 'Options'), /JSON-safe.*binary data/i);
  assert.throws(() => normalizeBoundedModelJsonObject({ unsafe: 1n }, 'Options'), /JSON-safe/);
  assert.throws(() => normalizeBoundedModelJsonObject({ huge: 'x'.repeat(100) }, 'Options', { maxBytes: 32 }), /exceeds 32 bytes/);
});

test('bounded model input supports immutable Blob payloads when available', { skip: typeof Blob !== 'function' }, () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' });
  const clean = normalizeBoundedModelInput({ blob }, 'Input', { maxBytes: 64 });
  assert.ok(clean.blob instanceof Blob);
  assert.equal(clean.blob.size, 3);
  assert.equal(clean.blob.type, 'application/octet-stream');
  assert.notEqual(clean.blob, blob);
});
