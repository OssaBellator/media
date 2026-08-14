import assert from "node:assert/strict";
import test from "node:test";
import { DecodeScheduler, WeightedLruCache, frameCacheKey, sourceCacheKey } from "../src/index.js";

test("weighted LRU cache evicts least recently used entries by budget", () => {
  const cache = new WeightedLruCache({ maxWeight: 5 });
  cache.set("a", 1, 2);
  cache.set("b", 2, 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3, 2);
  assert.equal(cache.has("a"), true);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.has("c"), true);
  assert.equal(cache.stats().evictions, 1);
});

test("cache keys are deterministic and frame quantized", () => {
  const asset = { id: "asset_1", props: { hash: "abc", size: 100, mimeType: "video/mp4" } };
  assert.equal(sourceCacheKey(asset), "source:abc:100:video/mp4");
  assert.equal(frameCacheKey({ assetId: asset.id, time: 1.01, fps: 30, width: 640, height: 360 }), frameCacheKey({ assetId: asset.id, time: 1.009, fps: 30, width: 640, height: 360 }));
});

test("decode scheduler deduplicates identical work", async () => {
  const scheduler = new DecodeScheduler({ concurrency: 1 });
  let calls = 0;
  const task = () => { calls += 1; return Promise.resolve("frame"); };
  const [a, b] = await Promise.all([scheduler.schedule("same", task), scheduler.schedule("same", task)]);
  assert.equal(a, "frame");
  assert.equal(b, "frame");
  assert.equal(calls, 1);
});

test("decode scheduler prioritizes queued work", async () => {
  const scheduler = new DecodeScheduler({ concurrency: 1 });
  const order = [];
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const first = scheduler.schedule("first", async () => { order.push("first"); await blocker; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const low = scheduler.schedule("low", () => order.push("low"), { priority: 1 });
  const high = scheduler.schedule("high", () => order.push("high"), { priority: 10 });
  release();
  await Promise.all([first, low, high]);
  assert.deepEqual(order, ["first", "high", "low"]);
});
