export const fitImage = () => ({ scale: 1, x: 0, y: 0 });
export function clampImage(transform, image, viewport) {
  const scale = Math.min(5, Math.max(1, transform.scale));
  const xLimit = Math.max(0, (image.width * scale - viewport.width) / 2);
  const yLimit = Math.max(0, (image.height * scale - viewport.height) / 2);
  return { scale, x: Math.min(xLimit, Math.max(-xLimit, transform.x)) || 0,
    y: Math.min(yLimit, Math.max(-yLimit, transform.y)) || 0 };
}
export function pinchImage(start, anchor, midpoint, ratio) {
  const scale = Math.min(5, Math.max(1, start.scale * ratio));
  const factor = scale / start.scale;
  return { scale, x: midpoint.x - (anchor.x - start.x) * factor,
    y: midpoint.y - (anchor.y - start.y) * factor };
}
