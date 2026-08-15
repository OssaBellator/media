import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PLANNER_INTENT_CHARS,
  MAX_PLANNER_PROVIDER_CAPABILITIES,
  MAX_PLANNER_PROVIDER_CAPABILITY_CHARS,
  MAX_PLANNER_PROVIDER_ID_CHARS,
  MAX_PLANNER_PROVIDER_LABEL_CHARS,
  MAX_PLANNER_PROVIDERS,
  PlannerRegistry,
  createHttpPlannerProvider,
  createLocalPlannerProvider,
  createMediaProject,
  createPlannerProvider,
  createPlannerSnapshot,
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

test("planner intent is normalized and bounded before provider invocation", async () => {
  let calls = 0;
  let receivedIntent = null;
  const provider = createPlannerProvider({ id: "intent-bound", plan: async ({ intent }) => { calls += 1; receivedIntent = intent; return { summary: "noop", operations: [] }; } });
  await planWithProvider(provider, createMediaProject(), "  bounded intent  ");
  assert.equal(receivedIntent, "bounded intent");
  await assert.rejects(() => planWithProvider(provider, createMediaProject(), "x".repeat(MAX_PLANNER_INTENT_CHARS + 1)), /exceeds 16384 characters/);
  assert.equal(calls, 1);
});

test("planner context is canonical JSON-safe and bounded before provider invocation", async () => {
  let calls = 0;
  let receivedContext = null;
  const provider = createPlannerProvider({ id: "context-bound", plan: async ({ context }) => { calls += 1; receivedContext = context; return { summary: "noop", operations: [] }; } });
  const context = { nested: { value: "safe" }, list: [1, 2, 3] };
  await planWithProvider(provider, createMediaProject(), "inspect", context);
  assert.deepEqual(receivedContext, context);
  assert.notEqual(receivedContext, context);
  assert.notEqual(receivedContext.nested, context.nested);
  await assert.rejects(() => planWithProvider(provider, createMediaProject(), "inspect", { huge: "x".repeat(400) }, { maxContextBytes: 256 }), /context exceeds 256 bytes/);
  await assert.rejects(() => planWithProvider(provider, createMediaProject(), "inspect", { unsafe: 1n }), /context must be JSON-safe/i);
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "secret", { enumerable: true, get() { getterCalls += 1; return "leak"; } });
  await assert.rejects(() => planWithProvider(provider, createMediaProject(), "inspect", accessor), /context must be JSON-safe/i);
  assert.equal(getterCalls, 0);
  assert.equal(calls, 1);
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

test("planner snapshots omit local URIs and heavyweight waveform samples", () => {
  const graph = createMediaProject("Snapshot");
  graph.nodes.asset_demo = { id: "asset_demo", kind: "asset", name: "demo.wav", createdAt: "x", updatedAt: "x", props: { mediaKind: "audio", uri: "blob:secret", waveform: [0.1, 0.2], hash: "abc" } };
  const snapshot = createPlannerSnapshot(graph);
  assert.equal(snapshot.nodes.asset_demo.props.uri, undefined);
  assert.equal(snapshot.nodes.asset_demo.props.waveform, undefined);
  assert.equal(snapshot.nodes.asset_demo.props.hash, "abc");
});

test("HTTP planner posts a sanitized project snapshot and validates returned operations", async () => {
  let request;
  const provider = createHttpPlannerProvider({ endpoint: "https://planner.example/v1/plan", fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ summary: "rename", operations: [{ type: "node.update", nodeId: request.body.graph.projectId, patch: { name: "Remote" } }] }) };
  } });
  const graph = createMediaProject("Local");
  const result = await planWithProvider(provider, graph, "rename it", { workspace: "agent" });
  assert.equal(request.url, "https://planner.example/v1/plan");
  assert.equal(request.body.version, 1);
  assert.equal(request.body.context.workspace, "agent");
  assert.equal(result.operations[0].type, "node.update");
});

test("HTTP planner rejects non-success responses", async () => {
  const provider = createHttpPlannerProvider({ endpoint: "https://planner.example/v1/plan", fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(() => planWithProvider(provider, createMediaProject(), "edit"), /HTTP 429/);
});


test("planner result normalization rejects accessors without executing them", async () => {
  let rootGetterCalls = 0;
  const root = { operations: [] };
  Object.defineProperty(root, "summary", { enumerable: true, get() { rootGetterCalls += 1; return "unsafe"; } });
  const rootProvider = createPlannerProvider({ id: "root-accessor", plan: async () => root });
  await assert.rejects(() => planWithProvider(rootProvider, createMediaProject(), "inspect"), /Planner result must be JSON-safe/i);
  assert.equal(rootGetterCalls, 0);

  let nestedGetterCalls = 0;
  const operation = { nodeId: "project" };
  Object.defineProperty(operation, "type", { enumerable: true, get() { nestedGetterCalls += 1; return "node.update"; } });
  const nestedProvider = createPlannerProvider({ id: "nested-accessor", plan: async () => ({ summary: "unsafe", operations: [operation] }) });
  await assert.rejects(() => planWithProvider(nestedProvider, createMediaProject(), "inspect"), /Planner result must be JSON-safe/i);
  assert.equal(nestedGetterCalls, 0);
});


test("planner provider descriptors reject accessors and coercive fields without executing them", async () => {
  let idGetterCalls = 0;
  const accessor = { plan: async () => ({ summary: "noop", operations: [] }) };
  Object.defineProperty(accessor, "id", { enumerable: true, get() { idGetterCalls += 1; return "unsafe"; } });
  assert.throws(() => createPlannerProvider(accessor), /enumerable data fields only/);
  assert.equal(idGetterCalls, 0);
  await assert.rejects(() => planWithProvider(accessor, createMediaProject(), "inspect"), /enumerable data fields only/);
  assert.equal(idGetterCalls, 0);

  assert.throws(() => createPlannerProvider({ id: "x".repeat(MAX_PLANNER_PROVIDER_ID_CHARS + 1), plan() {} }), /id exceeds 160 characters/);
  assert.throws(() => createPlannerProvider({ id: "x", label: "l".repeat(MAX_PLANNER_PROVIDER_LABEL_CHARS + 1), plan() {} }), /label exceeds 256 characters/);
  assert.throws(() => createPlannerProvider({ id: "x", capabilities: ["c".repeat(MAX_PLANNER_PROVIDER_CAPABILITY_CHARS + 1)], plan() {} }), /capability exceeds 64 characters/);
  assert.throws(() => createPlannerProvider({ id: "x", capabilities: Array.from({ length: MAX_PLANNER_PROVIDER_CAPABILITIES + 1 }, (_, index) => `c-${index}`), plan() {} }), /exceeds 32 entries/);
  assert.throws(() => createPlannerProvider({ id: "x", capabilities: ["plan"], metadata: {}, plan() {} }), /Unsupported planner provider field: metadata/);
});

test("planner provider normalization freezes bounded descriptors and registry cardinality", () => {
  const sourceCapabilities = ["plan", "offline", "plan"];
  const provider = createPlannerProvider({ id: "  safe  ", label: "  Safe planner  ", capabilities: sourceCapabilities, plan: async () => ({ summary: "noop", operations: [] }) });
  assert.equal(provider.id, "safe");
  assert.equal(provider.label, "Safe planner");
  assert.deepEqual(provider.capabilities, ["plan", "offline"]);
  assert.equal(Object.isFrozen(provider), true);
  assert.equal(Object.isFrozen(provider.capabilities), true);
  sourceCapabilities.push("changed");
  assert.deepEqual(provider.capabilities, ["plan", "offline"]);

  const registry = new PlannerRegistry();
  for (let index = 0; index < MAX_PLANNER_PROVIDERS; index += 1) registry.register({ id: `provider-${index}`, plan: async () => ({ summary: "noop", operations: [] }) });
  assert.equal(registry.list().length, MAX_PLANNER_PROVIDERS);
  assert.throws(() => registry.register({ id: "overflow", plan: async () => ({ summary: "noop", operations: [] }) }), /exceeds 256 providers/);
  assert.doesNotThrow(() => registry.register({ id: "provider-0", label: "Replacement", plan: async () => ({ summary: "noop", operations: [] }) }));
  assert.equal(registry.get("provider-0").label, "Replacement");
  assert.equal(registry.list().length, MAX_PLANNER_PROVIDERS);
});
