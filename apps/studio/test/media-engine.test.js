import assert from "node:assert/strict";
import test from "node:test";
import { downsampleChannels, fingerprintBlob } from "../media-engine.js";

test("downsamples multichannel audio into bounded peak bins", () => {
  const left = Float32Array.from([0, 0.5, -1, 0.25, 0, 0.2, -0.4, 0]);
  const right = Float32Array.from([0.1, 0.2, -0.3, 0.1, 0, 0.8, 0.1, 0]);
  const waveform = downsampleChannels([left, right], 4);
  assert.deepEqual(waveform, [0.5, 1, 0.8, 0.4]);
});

test("fingerprints blobs deterministically from sampled source bytes", async () => {
  const a = new Blob(["same-media"], { type: "video/mp4" });
  const b = new Blob(["same-media"], { type: "video/mp4" });
  const c = new Blob(["different-media"], { type: "video/mp4" });
  const [hashA, hashB, hashC] = await Promise.all([fingerprintBlob(a), fingerprintBlob(b), fingerprintBlob(c)]);
  if (hashA === null) return;
  assert.equal(hashA, hashB);
  assert.notEqual(hashA, hashC);
  assert.equal(hashA.length, 64);
});
