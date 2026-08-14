import { createEdge, createNode, nodesByKind } from "./graph.js";
import { createClipForAsset } from "./project.js";

function normalizeIntent(intent) {
  return intent.trim().replace(/\s+/g, " ");
}

export function planIntent(graph, rawIntent) {
  const intent = normalizeIntent(rawIntent);
  const lower = intent.toLowerCase();

  const renameMatch = intent.match(/rename (?:the )?project to ["']?(.+?)["']?$/i);
  if (renameMatch?.[1]) {
    return {
      summary: `Rename project to “${renameMatch[1]}”`,
      operations: [
        { type: "node.update", nodeId: graph.projectId, patch: { name: renameMatch[1] } },
      ],
    };
  }

  if (lower.includes("vertical") || lower.includes("9:16")) {
    const composition = nodesByKind(graph, "composition")[0];
    if (!composition) return { summary: "No composition found", operations: [] };
    return {
      summary: "Set the main composition to vertical 9:16",
      operations: [
        {
          type: "node.update",
          nodeId: composition.id,
          patch: { props: { width: 1080, height: 1920 } },
        },
      ],
    };
  }

  if (lower.includes("clear") && lower.includes("timeline")) {
    const clips = nodesByKind(graph, "clip");
    return {
      summary: `Remove ${clips.length} clip${clips.length === 1 ? "" : "s"} from the timeline`,
      operations: clips.map((clip) => ({ type: "node.remove", nodeId: clip.id })),
    };
  }

  if ((lower.includes("add") || lower.includes("put")) && lower.includes("timeline")) {
    const assets = nodesByKind(graph, "asset");
    const referencedAssetIds = new Set(nodesByKind(graph, "clip").map((clip) => clip.props.assetId));
    let preview = graph;
    const operations = [];
    for (const asset of assets) {
      if (referencedAssetIds.has(asset.id)) continue;
      const { clip, edges } = createClipForAsset(preview, asset);
      const addNodeOp = { type: "node.add", node: clip };
      operations.push(addNodeOp, ...edges.map((edge) => ({ type: "edge.add", edge })));
      preview = {
        ...preview,
        nodes: { ...preview.nodes, [clip.id]: clip },
        edges: Object.fromEntries([
          ...Object.entries(preview.edges),
          ...edges.map((edge) => [edge.id, edge]),
        ]),
      };
    }
    return {
      summary: operations.length ? "Add unplaced media to the timeline" : "All assets are already on the timeline",
      operations,
    };
  }

  if (lower.startsWith("add marker")) {
    const composition = nodesByKind(graph, "composition")[0];
    if (!composition) return { summary: "No composition found", operations: [] };
    const marker = createNode({
      kind: "layer",
      name: intent.replace(/^add marker\s*/i, "") || "Marker",
      props: { role: "marker", time: 0 },
    });
    return {
      summary: `Add marker “${marker.name}”`,
      operations: [
        { type: "node.add", node: marker },
        { type: "edge.add", edge: createEdge({ from: composition.id, to: marker.id }) },
      ],
    };
  }

  return {
    summary: "No local planner rule matched. A model-backed planner can plug into this operation layer later.",
    operations: [],
  };
}
