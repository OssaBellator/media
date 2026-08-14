import assert from "node:assert/strict";
import test from "node:test";
import { addAsset, buildSourceManifest, createAsset, createMediaProject, matchSourceCandidates, scoreSourceCandidate } from "../src/index.js";

test("builds a portable source manifest from project assets", () => {
  let graph = createMediaProject("Sources");
  graph = addAsset(graph, createAsset({ name: "Hero.MOV", mimeType: "video/quicktime", size: 100, duration: 5, hash: "abc" }));
  const manifest = buildSourceManifest(graph);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].hash, "abc");
  assert.equal(manifest[0].duration, 5);
});

test("source relinking strongly prefers exact fingerprints", () => {
  const asset = { name: "old.mov", props: { mediaKind: "video", mimeType: "video/mp4", size: 100, hash: "hash-a" } };
  assert.equal(scoreSourceCandidate(asset, { name: "anything.mov", mediaKind: "video", size: 999, hash: "hash-a" }), 1000);
  assert.equal(scoreSourceCandidate(asset, { name: "old.mov", mediaKind: "video", size: 100, hash: "wrong" }), -Infinity);
});

test("source matching avoids reusing the same candidate", () => {
  const assets = [
    { id: "a", name: "a.wav", props: { mediaKind: "audio", size: 10 } },
    { id: "b", name: "b.wav", props: { mediaKind: "audio", size: 10 } },
  ];
  const candidates = [{ id: "candidate", name: "a.wav", mediaKind: "audio", size: 10 }];
  const matches = matchSourceCandidates(assets, candidates);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].asset.id, "a");
});
