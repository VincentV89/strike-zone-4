/**
 * InstancedMesh wrappers around core instance buffers (PD-R-3, PD-R-4, LC-G-6). The core
 * Float32Arrays become the attributes' arrays (no copy). Only dirty ranges are uploaded; the
 * mesh draws `count` instances and hides itself at 0.
 */
import type { InstanceBuffer } from '@sz/render/core/buffers';
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  type BufferGeometry,
  type Material,
} from 'three';

export interface WrappedMesh {
  readonly mesh: InstancedMesh;
  readonly buffer: InstanceBuffer;
}

export function wrapInstances(
  geometry: BufferGeometry,
  material: Material,
  buffer: InstanceBuffer,
): WrappedMesh {
  const mesh = new InstancedMesh(geometry, material, buffer.capacity);
  const matrices = new InstancedBufferAttribute(buffer.matrices, 16);
  matrices.setUsage(DynamicDrawUsage);
  const colors = new InstancedBufferAttribute(buffer.colors, 3);
  colors.setUsage(DynamicDrawUsage);
  mesh.instanceMatrix = matrices;
  mesh.instanceColor = colors;
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return { mesh, buffer };
}

/** Uploads the dirty range of one buffer and syncs count/visibility. */
export function syncInstances(w: WrappedMesh): void {
  const b = w.buffer;
  if (!b.dirty) return;
  b.dirty = false;
  w.mesh.count = b.count;
  w.mesh.visible = b.count > 0;
  if (b.count === 0) return;
  const m = w.mesh.instanceMatrix;
  m.clearUpdateRanges();
  m.addUpdateRange(0, b.count * 16);
  m.needsUpdate = true;
  const c = w.mesh.instanceColor;
  if (c !== null) {
    c.clearUpdateRanges();
    c.addUpdateRange(0, b.count * 3);
    c.needsUpdate = true;
  }
}
