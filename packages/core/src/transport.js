export function createTransport({ time = 0, duration = 0, fps = 30, playing = false, rate = 1 } = {}) {
  return normalizeTransport({ time, duration, fps, playing, rate });
}

export function normalizeTransport(state) {
  const duration = Math.max(0, Number(state.duration) || 0);
  const fps = Math.max(1, Number(state.fps) || 30);
  const rate = Number(state.rate) > 0 ? Number(state.rate) : 1;
  const time = Math.min(duration, Math.max(0, Number(state.time) || 0));
  return { time, duration, fps, playing: Boolean(state.playing) && time < duration, rate };
}

export function seekTransport(state, time) { return normalizeTransport({ ...state, time, playing: state.playing && Number(time) < state.duration }); }
export function playTransport(state) { return normalizeTransport({ ...state, playing: state.time < state.duration }); }
export function pauseTransport(state) { return { ...normalizeTransport(state), playing: false }; }
export function frameForTime(time, fps = 30) { return Math.max(0, Math.round(Number(time) * Number(fps))); }
export function timeForFrame(frame, fps = 30) { return Math.max(0, Number(frame)) / Math.max(1, Number(fps)); }
export function stepTransport(state, frames = 1) { return seekTransport({ ...state, playing: false }, state.time + Number(frames) / state.fps); }
export function tickTransport(state, elapsedSeconds) {
  if (!state.playing) return normalizeTransport(state);
  const next = seekTransport(state, state.time + Math.max(0, Number(elapsedSeconds) || 0) * state.rate);
  return next.time >= next.duration ? { ...next, playing: false } : next;
}
