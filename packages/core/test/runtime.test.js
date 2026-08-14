import assert from "node:assert/strict";
import test from "node:test";
import {
  PlannerRegistry,
  createLocalPlannerProvider,
  createMediaProject,
  createPlannerProvider,
  createTransport,
  frameForTime,
  pauseTransport,
  planWithProvider,
  playTransport,
  seekTransport,
  stepTransport,
  tickTransport,
  timeForFrame,
} from "../src/index.js";

test("transport seeks, plays, ticks and stops at duration", () => {
  let transport = createTransport({ duration: 10, fps: 25 });
  transport = seekTransport(transport, 3);
  transport = playTransport(transport);
  transport = tickTransport(transport, 2);
  assert.equal(transport.time, 5);
  assert.equal(transport.playing, true);
  transport = tickTransport(transport, 20);
  assert.equal(transport.time, 10);
  assert.equal(transport.playing, false);
  assert.equal(pauseTransport(transport).playing, false);
});

test("transport stepping is frame-accurate", () => {
  let transport = createTransport({ duration: 3, fps: 24, time: 1 });
  transport = stepTransport(transport, 1);
  assert.equal(transport.time, 1 + 1 / 24);
  assert.equal(frameForTime(2, 24), 48);
  assert.equal(timeForFrame(48, 24), 2);
});

test("local planner provider exposes the deterministic planner asynchronously", async () => {
  const graph = createMediaProject("Provider");
  const result = await planWithProvider(createLocalPlannerProvider(), graph, "rename project to Provider result");
  assert.equal(result.operations[0].type, "node.update");
  assert.match(result.summary, /Provider result/);
});

test("provider result validation rejects arbitrary model output", async () => {
  const provider = createPlannerProvider({ id: "bad", plan: async () => ({ summary: "bad", operations: [{ type: "shell.exec", command: "rm" }] }) });
  await assert.rejects(() => planWithProvider(provider, createMediaProject(), "do something"), /Unsupported operation/);
});

test("planner registry keeps providers replaceable and discoverable", () => {
  const registry = new PlannerRegistry();
  registry.register(createLocalPlannerProvider());
  registry.register(createPlannerProvider({ id: "mock", label: "Mock model", plan: async () => ({ summary: "noop", operations: [] }) }));
  assert.equal(registry.list().length, 2);
  assert.equal(registry.get("mock").label, "Mock model");
  assert.equal(registry.unregister("mock"), true);
  assert.equal(registry.get("mock"), null);
});
