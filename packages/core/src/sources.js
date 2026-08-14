import { nodesByKind } from "./graph.js";

function basename(value = "") {
  return String(value).split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
}

export function buildSourceManifest(graph) {
  return nodesByKind(graph, "asset").map((asset) => ({
    id: asset.id,
    name: asset.name,
    mediaKind: asset.props.mediaKind,
    mimeType: asset.props.mimeType ?? "",
    size: Number(asset.props.size ?? 0),
    duration: asset.props.duration === undefined ? null : Number(asset.props.duration),
    width: asset.props.width === undefined ? null : Number(asset.props.width),
    height: asset.props.height === undefined ? null : Number(asset.props.height),
    hash: asset.props.hash ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export function scoreSourceCandidate(asset, candidate) {
  if (!asset || !candidate) return -Infinity;
  const expectedKind = asset.props?.mediaKind ?? asset.mediaKind;
  const candidateKind = candidate.mediaKind ?? candidate.props?.mediaKind;
  if (expectedKind && candidateKind && expectedKind !== candidateKind && !(expectedKind === "music" && candidateKind === "audio")) return -Infinity;
  const expectedHash = asset.props?.hash ?? asset.hash;
  const candidateHash = candidate.hash ?? candidate.props?.hash;
  if (expectedHash && candidateHash) return expectedHash === candidateHash ? 1000 : -Infinity;
  let score = 0;
  const expectedSize = Number(asset.props?.size ?? asset.size ?? 0);
  const candidateSize = Number(candidate.size ?? candidate.props?.size ?? 0);
  if (expectedSize && candidateSize && expectedSize === candidateSize) score += 120;
  const expectedName = basename(asset.name);
  const candidateName = basename(candidate.name);
  if (expectedName && candidateName && expectedName === candidateName) score += 80;
  const expectedMime = asset.props?.mimeType ?? asset.mimeType;
  const candidateMime = candidate.mimeType ?? candidate.props?.mimeType;
  if (expectedMime && candidateMime && expectedMime === candidateMime) score += 20;
  const expectedDuration = Number(asset.props?.duration ?? asset.duration);
  const candidateDuration = Number(candidate.duration ?? candidate.props?.duration);
  if (Number.isFinite(expectedDuration) && Number.isFinite(candidateDuration) && Math.abs(expectedDuration - candidateDuration) < 0.05) score += 20;
  return score;
}

export function matchSourceCandidates(assets, candidates, { minimumScore = 100 } = {}) {
  const available = new Set(candidates.map((_, index) => index));
  const matches = [];
  for (const asset of assets) {
    let best = null;
    for (const index of available) {
      const candidate = candidates[index];
      const score = scoreSourceCandidate(asset, candidate);
      if (!best || score > best.score) best = { index, candidate, score };
    }
    if (best && best.score >= minimumScore) {
      available.delete(best.index);
      matches.push({ asset, candidate: best.candidate, score: best.score });
    }
  }
  return matches;
}
