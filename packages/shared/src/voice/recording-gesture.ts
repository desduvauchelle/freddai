/** Logical pixels/points on every platform; dominant left motion takes precedence. */
export function recordingGesture(origin: { x: number; y: number }, point: { x: number; y: number }) {
  const left = Math.max(0, origin.x - point.x), up = Math.max(0, origin.y - point.y);
  const cancel = left > up ? Math.min(1, left / 96) : 0;
  const send = left > up ? 0 : Math.min(1, up / 64);
  return { cancel, send, shouldCancel: cancel >= 1, shouldSend: send >= 1 };
}
export function recordingCueOffset(rest: { x: number; y: number }, finger: { x: number; y: number } | null, progress: number, axis: 'horizontal' | 'vertical') {
  const t = Math.max(0, Math.min(1, progress)), amount = 1 - (1 - t) ** 2;
  return { x: finger && axis === 'horizontal' ? (finger.x - rest.x) * amount : 0,
    y: finger && axis === 'vertical' ? (finger.y - rest.y) * amount : 0 };
}
