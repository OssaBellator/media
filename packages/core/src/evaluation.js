import { childrenOf, nodesByKind } from './graph.js';
import { primaryComposition } from './project.js';
import { clipEnd } from './timeline.js';
import { evaluateAnimatedTransform } from './keyframes.js';
import { evaluatedEffects } from './effects.js';
import { compositingState } from './compositing.js';

function enabled(node) { return node?.props?.enabled !== false; }

export function sourceTimeForClip(clip, timelineTime) {
  const relative = Math.max(0, Number(timelineTime) - Number(clip.props.start ?? 0));
  return Number(clip.props.inPoint ?? 0) + relative * Number(clip.props.playbackRate ?? 1);
}

export function activeClipsAtTime(graph, time, { mediaKind } = {}) {
  const target = Number(time);
  return nodesByKind(graph, 'clip')
    .filter(enabled)
    .filter((clip) => target >= Number(clip.props.start ?? 0) && target < clipEnd(clip))
    .filter((clip) => {
      if (!mediaKind) return true;
      const track = graph.nodes[clip.props.trackId];
      return track?.props.mediaKind === mediaKind && track?.props.muted !== true;
    })
    .sort((a, b) => Number(graph.nodes[a.props.trackId]?.props.order ?? 0) - Number(graph.nodes[b.props.trackId]?.props.order ?? 0));
}

function compositing(node, time) {
  const state = compositingState(node, time);
  return { blendMode: state.blendMode, mask: state.mask, transition: state.transition };
}

export function evaluateComposition(graph, { compositionId, time = 0 } = {}) {
  const composition = compositionId ? graph.nodes[compositionId] : primaryComposition(graph);
  if (!composition || composition.kind !== 'composition') throw new Error('No composition found');
  const canvasLayers = childrenOf(graph, composition.id, 'layer')
    .filter((layer) => layer.props.role !== 'marker' && enabled(layer))
    .sort((a, b) => Number(a.props.order ?? 0) - Number(b.props.order ?? 0))
    .map((layer) => layer.props.role === 'shape' ? ({
      kind: 'shape',
      nodeId: layer.id,
      shape: {
        type: layer.props.shapeType ?? 'rectangle', width: Number(layer.props.width ?? 500), height: Number(layer.props.height ?? 300),
        fill: layer.props.fill ?? '#ffffff', stroke: layer.props.stroke ?? 'transparent', strokeWidth: Number(layer.props.strokeWidth ?? 0), cornerRadius: Number(layer.props.cornerRadius ?? 0),
      },
      transform: evaluateAnimatedTransform(layer, time),
      effects: evaluatedEffects(graph, layer.id),
      ...compositing(layer, time),
    }) : layer.props.role === 'text' ? ({
      kind: 'text',
      nodeId: layer.id,
      text: layer.props.text ?? '',
      style: {
        fontFamily: layer.props.fontFamily ?? 'sans-serif',
        fontSize: Number(layer.props.fontSize ?? 96),
        fontWeight: Number(layer.props.fontWeight ?? 700),
        color: layer.props.color ?? '#ffffff',
        align: layer.props.align ?? 'center',
        lineHeight: Number(layer.props.lineHeight ?? 1.1),
        letterSpacing: Number(layer.props.letterSpacing ?? 0),
      },
      transform: evaluateAnimatedTransform(layer, time),
      effects: evaluatedEffects(graph, layer.id),
      ...compositing(layer, time),
    }) : ({
      kind: 'layer',
      nodeId: layer.id,
      assetId: layer.props.assetId,
      transform: evaluateAnimatedTransform(layer, time),
      effects: evaluatedEffects(graph, layer.id),
      ...compositing(layer, time),
    }));
  const timelineVisuals = activeClipsAtTime(graph, time, { mediaKind: 'visual' }).map((clip) => ({
    kind: 'clip',
    nodeId: clip.id,
    assetId: clip.props.assetId,
    sourceTime: sourceTimeForClip(clip, time),
    transform: evaluateAnimatedTransform(clip, time),
    effects: evaluatedEffects(graph, clip.id),
    ...compositing(clip, time),
  }));
  const audio = activeClipsAtTime(graph, time, { mediaKind: 'audio' }).map((clip) => ({
    kind: 'audio',
    nodeId: clip.id,
    assetId: clip.props.assetId,
    sourceTime: sourceTimeForClip(clip, time),
    gain: Number(clip.props.gain ?? 1),
    pan: Number(clip.props.pan ?? 0),
    effects: evaluatedEffects(graph, clip.id),
  }));
  return {
    compositionId: composition.id,
    time: Number(time),
    frame: Math.max(0, Math.round(Number(time) * Number(composition.props.fps ?? 30))),
    width: Number(composition.props.width),
    height: Number(composition.props.height),
    background: composition.props.background ?? '#000000',
    visual: [...canvasLayers, ...timelineVisuals],
    audio,
  };
}
