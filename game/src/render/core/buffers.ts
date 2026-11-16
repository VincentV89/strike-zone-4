/**
 * Preallocated instance buffers shared with gl without copying (PD-R-4). Core writes live
 * instances contiguously from index 0 and sets `count` (PD-R-3, compacted instances); gl uploads
 * the dirty range and sets mesh.count, hiding the mesh when count is 0.
 */
export interface InstanceBuffer {
  readonly capacity: number;
  /** capacity × 16 floats, column-major matrices. */
  readonly matrices: Float32Array;
  /** capacity × 3 floats, linear RGB. */
  readonly colors: Float32Array;
  count: number;
  /** Count of the previous pack, so a shrink to 0 is still uploaded. */
  prevCount: number;
  dirty: boolean;
}

export function createInstanceBuffer(capacity: number): InstanceBuffer {
  const n = Math.max(1, Math.floor(capacity));
  return {
    capacity: n,
    matrices: new Float32Array(n * 16),
    colors: new Float32Array(n * 3),
    count: 0,
    prevCount: 0,
    dirty: true,
  };
}

/** Starts a new packing pass; remembers the old count so a shrink is still uploaded. */
export function beginPack(b: InstanceBuffer): void {
  b.prevCount = b.count;
  b.count = 0;
}

export function endPack(b: InstanceBuffer): void {
  if (b.count > 0 || b.prevCount > 0) b.dirty = true;
}

export function writeColor(
  b: InstanceBuffer,
  index: number,
  r: number,
  g: number,
  bl: number,
): void {
  b.colors[index * 3] = r;
  b.colors[index * 3 + 1] = g;
  b.colors[index * 3 + 2] = bl;
}
