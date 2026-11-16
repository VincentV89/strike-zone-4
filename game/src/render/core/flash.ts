/**
 * Photosensitivity cap for muzzle flashes (SD-R-6, CMP-R-03, BR-R-20): every flash covers less
 * than 2% of the viewport, and nothing in render flashes full-screen.
 */
export const MAX_FLASH_AREA = 0.02;
export const FLASH_SAFETY = 0.8;

/** Viewmodel camera: fixed 55° vertical FOV, near 0.01 (business-logic-model). */
export const VIEWMODEL_FOV_DEG = 55;
/** Viewmodel flash quad: 0.079 m square about 0.6 m in front of the viewmodel camera. */
export const VM_FLASH_SIZE = 0.079;
export const VM_FLASH_DIST = 0.6;

/** Fraction of the viewport covered by a camera-facing square of side `size` at distance `dist`. */
export function projectedAreaFraction(
  size: number,
  dist: number,
  vFovRad: number,
  aspect: number,
): number {
  if (!(dist > 0) || !(vFovRad > 0) || !(aspect > 0)) return 1;
  const viewH = 2 * dist * Math.tan(vFovRad / 2);
  return (size * size) / (viewH * viewH * aspect);
}

/** World flash size: the base size, shrunk when needed so its projected area stays < 2%. */
export function flashWorldSize(
  baseM: number,
  distM: number,
  vFovRad: number,
  aspect: number,
): number {
  const d = Number.isFinite(distM) && distM > 0.05 ? distM : 0.05;
  const v = Number.isFinite(vFovRad) && vFovRad > 0 ? vFovRad : Math.PI / 3;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const cap = 2 * d * Math.tan(v / 2) * Math.sqrt(MAX_FLASH_AREA * a) * FLASH_SAFETY;
  const base = Number.isFinite(baseM) && baseM > 0 ? baseM : 0;
  return Math.min(base, cap);
}
