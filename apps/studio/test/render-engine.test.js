import assert from "node:assert/strict";
import test from "node:test";
import { canvasFilterFromEffects, sourceRectForTransform } from "../render-engine.js";

test("maps nondestructive effects to Canvas filters", () => {
  assert.equal(canvasFilterFromEffects([
    { type: "brightness", params: { amount: 1.2 } },
    { type: "blur", params: { radius: 4 } },
  ]), "brightness(1.2) blur(4px)");
});

test("computes cropped source rectangles", () => {
  assert.deepEqual(sourceRectForTransform(1000, 500, { cropLeft: 0.1, cropRight: 0.2, cropTop: 0.1, cropBottom: 0.1 }), {
    x: 100, y: 50, width: 700, height: 400,
  });
});
