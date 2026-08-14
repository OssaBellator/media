import { assertValidGraph } from "./graph.js";

export const MEDIA_PROJECT_FORMAT = "ossa.media-project";
export const PROJECT_FILE_VERSION = 1;

function isLegacyGraph(value) {
  return value && typeof value === "object" && typeof value.projectId === "string" && value.nodes && value.edges && !value.format;
}

export function createProjectFile(graph, metadata = {}) {
  assertValidGraph(graph);
  return {
    format: MEDIA_PROJECT_FORMAT,
    fileVersion: PROJECT_FILE_VERSION,
    metadata: { ...metadata },
    graph,
  };
}

export function parseProjectFile(serialized) {
  const parsed = typeof serialized === "string" ? JSON.parse(serialized) : structuredClone(serialized);
  if (isLegacyGraph(parsed)) {
    return { graph: assertValidGraph(parsed), migratedFrom: "legacy-bare-graph", fileVersion: 0, metadata: {} };
  }
  if (!parsed || parsed.format !== MEDIA_PROJECT_FORMAT) throw new Error("Not a Media project file");
  if (!Number.isInteger(parsed.fileVersion)) throw new Error("Media project file is missing a valid fileVersion");
  if (parsed.fileVersion > PROJECT_FILE_VERSION) throw new Error(`Project file version ${parsed.fileVersion} is newer than supported version ${PROJECT_FILE_VERSION}`);
  if (parsed.fileVersion < 1) throw new Error(`Unsupported project file version: ${parsed.fileVersion}`);
  return { graph: assertValidGraph(parsed.graph), migratedFrom: null, fileVersion: parsed.fileVersion, metadata: parsed.metadata ?? {} };
}

export function serializeProject(graph, metadata = {}) {
  return JSON.stringify(createProjectFile(graph, metadata), null, 2);
}

export function deserializeProject(serialized) {
  return parseProjectFile(serialized).graph;
}
