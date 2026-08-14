import { assertValidGraph } from "./graph.js";
import { assertProjectInvariants } from "./invariants.js";
import { buildSourceManifest } from "./sources.js";

export const MEDIA_PROJECT_FORMAT = "ossa.media-project";
export const PROJECT_FILE_VERSION = 2;

function isLegacyGraph(value) {
  return value && typeof value === "object" && typeof value.projectId === "string" && value.nodes && value.edges && !value.format;
}

function validate(graph) {
  assertValidGraph(graph);
  assertProjectInvariants(graph);
  return graph;
}

function normalizeSources(sources, graph) {
  if (!Array.isArray(sources)) return buildSourceManifest(graph);
  return sources.map((source) => ({
    id: String(source.id ?? ""),
    name: String(source.name ?? ""),
    mediaKind: String(source.mediaKind ?? "unknown"),
    mimeType: String(source.mimeType ?? ""),
    size: Number(source.size ?? 0),
    duration: source.duration == null ? null : Number(source.duration),
    width: source.width == null ? null : Number(source.width),
    height: source.height == null ? null : Number(source.height),
    hash: source.hash ?? null,
  }));
}

export function createProjectFile(graph, metadata = {}) {
  validate(graph);
  return {
    format: MEDIA_PROJECT_FORMAT,
    fileVersion: PROJECT_FILE_VERSION,
    metadata: { ...metadata },
    sources: buildSourceManifest(graph),
    graph,
  };
}

export function parseProjectFile(serialized) {
  const parsed = typeof serialized === "string" ? JSON.parse(serialized) : structuredClone(serialized);
  if (isLegacyGraph(parsed)) {
    const graph = validate(parsed);
    return { graph, sources: buildSourceManifest(graph), migratedFrom: "legacy-bare-graph", fileVersion: 0, metadata: {} };
  }
  if (!parsed || parsed.format !== MEDIA_PROJECT_FORMAT) throw new Error("Not a Media project file");
  if (!Number.isInteger(parsed.fileVersion)) throw new Error("Media project file is missing a valid fileVersion");
  if (parsed.fileVersion > PROJECT_FILE_VERSION) throw new Error(`Project file version ${parsed.fileVersion} is newer than supported version ${PROJECT_FILE_VERSION}`);
  if (parsed.fileVersion < 1) throw new Error(`Unsupported project file version: ${parsed.fileVersion}`);
  const graph = validate(parsed.graph);
  if (parsed.fileVersion === 1) {
    return {
      graph,
      sources: normalizeSources(parsed.metadata?.assets, graph),
      migratedFrom: "project-file-v1",
      fileVersion: 1,
      metadata: parsed.metadata ?? {},
    };
  }
  return {
    graph,
    sources: normalizeSources(parsed.sources, graph),
    migratedFrom: null,
    fileVersion: parsed.fileVersion,
    metadata: parsed.metadata ?? {},
  };
}

export function serializeProject(graph, metadata = {}) { return JSON.stringify(createProjectFile(graph, metadata), null, 2); }
export function deserializeProject(serialized) { return parseProjectFile(serialized).graph; }
