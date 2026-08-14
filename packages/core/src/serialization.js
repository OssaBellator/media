import { assertValidGraph } from "./graph.js";

export function serializeProject(graph) {
  assertValidGraph(graph);
  return JSON.stringify(graph, null, 2);
}

export function deserializeProject(serialized) {
  const graph = JSON.parse(serialized);
  return assertValidGraph(graph);
}
