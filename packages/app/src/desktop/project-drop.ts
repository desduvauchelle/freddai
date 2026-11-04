// Native drop coordinates are physical pixels; DOM bounds use CSS pixels.
export function projectDropTarget(
  position: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number } | undefined,
  scale: number,
  blocked: boolean,
) {
  if (blocked || !bounds || scale <= 0) return false;
  const x = position.x / scale, y = position.y / scale;
  return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
}
