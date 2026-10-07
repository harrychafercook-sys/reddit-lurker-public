export const ZOOM_KEY = 'displayZoom';
export const MIN_ZOOM = 75;
export const MAX_ZOOM = 150;
export const ZOOM_STEP = 5;

export function normalizeZoom(value) {
  const number = Number(value);
  if (!value || !Number.isFinite(number)) return 100;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(number / ZOOM_STEP) * ZOOM_STEP));
}

export function readZoom(storage) {
  try { return normalizeZoom(storage.getItem(ZOOM_KEY)); }
  catch { return 100; }
}

export function applyZoom(value, storage, root = document.documentElement) {
  const level = normalizeZoom(value);
  // Scale rem-based text, controls and spacing without magnifying the viewport
  // or the physical safe-area insets used by fixed navigation and dialogs.
  root.style.fontSize = level + '%';
  root.dataset.zoomLevel = String(level);
  try { storage.setItem(ZOOM_KEY, String(level)); return true; }
  catch { return false; } // The current view can still resize when storage is full.
}
