import { assertValidGraph } from "./graph.js";

export function createHistory(graph) {
  return { present: assertValidGraph(graph), past: [], future: [] };
}

export function commit(history, graph, label = "Edit") {
  assertValidGraph(graph);
  return {
    present: graph,
    past: [...history.past, { graph: history.present, label }],
    future: [],
  };
}

export function undo(history) {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    present: previous.graph,
    past: history.past.slice(0, -1),
    future: [{ graph: history.present, label: previous.label }, ...history.future],
  };
}

export function redo(history) {
  const next = history.future[0];
  if (!next) return history;
  return {
    present: next.graph,
    past: [...history.past, { graph: history.present, label: next.label }],
    future: history.future.slice(1),
  };
}
