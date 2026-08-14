import assert from "node:assert/strict";
import test from "node:test";
import {
  addAsset, applyOperations, audioEnvelopeAtTime, constantPowerPan, createAsset, createAudioMixPlan, createMediaProject,
  audioScheduleForClip, dbToGain, evaluateAudioMix, gainToDb, nodesByKind, planIntent, sampleForTime, setClipAudioOperations, timeForSample,
} from "../src/index.js";

function audioProject() {
  let graph = createMediaProject("Audio");
  graph = addAsset(graph, createAsset({ name: "score.wav", mimeType: "audio/wav", duration: 10, uri: "memory://score" }));
  return applyOperations(graph, planIntent(graph, "add everything to timeline").operations);
}

test("converts gain and dB consistently", () => {
  assert.equal(dbToGain(0), 1);
  assert.ok(Math.abs(gainToDb(dbToGain(-6)) + 6) < 1e-9);
  assert.equal(dbToGain(-96), 0);
});

test("constant power pan preserves center energy", () => {
  const center = constantPowerPan(0);
  assert.ok(Math.abs(center.left - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(center.right - Math.SQRT1_2) < 1e-12);
  assert.ok(constantPowerPan(-1).left > 0.999);
  assert.ok(constantPowerPan(1).right > 0.999);
});

test("audio clips support gain, pan and fades through graph operations", () => {
  let graph = audioProject();
  const clip = nodesByKind(graph, "clip")[0];
  graph = applyOperations(graph, setClipAudioOperations(graph, clip.id, { gainDb: -6, pan: 0.5, fadeIn: 2, fadeOut: 2 }));
  const edited = graph.nodes[clip.id];
  assert.equal(edited.props.gainDb, -6);
  assert.equal(audioEnvelopeAtTime(edited, 1), 0.5);
  assert.equal(audioEnvelopeAtTime(edited, 9), 0.5);
  const mix = evaluateAudioMix(graph, 1)[0];
  assert.equal(mix.envelope, 0.5);
  assert.ok(mix.rightGain > mix.leftGain);
});

test("audio mix plans are sample accurate", () => {
  const graph = audioProject();
  const plan = createAudioMixPlan(graph, { sampleRate: 48000, blockSize: 128 });
  assert.equal(plan.sampleCount, 480000);
  assert.equal(plan.blockCount, 3750);
  assert.equal(plan.sources.length, 1);
  assert.equal(sampleForTime(1.5, 48000), 72000);
  assert.equal(timeForSample(72000, 48000), 1.5);
});


test("audio scheduling maps a timeline cursor into source offset and delay", () => {
  const clip = { id: "clip", props: { assetId: "asset", start: 5, duration: 10, inPoint: 2, playbackRate: 2, gainDb: -3, pan: 0.25 } };
  assert.deepEqual(audioScheduleForClip(clip, 3), { clipId: "clip", assetId: "asset", delay: 2, sourceOffset: 2, sourceDuration: 20, outputDuration: 10, playbackRate: 2, gainDb: -3, pan: 0.25, fadeIn: 0, fadeOut: 0, clipStart: 5, clipEnd: 15 });
  const inside = audioScheduleForClip(clip, 8);
  assert.equal(inside.delay, 0);
  assert.equal(inside.sourceOffset, 8);
  assert.equal(inside.outputDuration, 7);
  assert.equal(audioScheduleForClip(clip, 15), null);
});
