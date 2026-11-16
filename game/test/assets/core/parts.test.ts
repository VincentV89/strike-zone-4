// LC-A-2, req-weapon-viewmodel AC1: part tables and the shared box writer.
import { BOX_TRIANGLES, BOX_VERTICES, buildBoxes } from '@sz/assets/core/box-mesh';
import { PresentationBootFailure } from '@sz/assets/core/errors';
import { PARTS_PER_BOT, RIG_PARTS } from '@sz/assets/core/rig-parts';
import { VIEWMODELS } from '@sz/assets/core/viewmodel-parts';
import { vec3 } from '@sz/kernel';
import { rotateYawPitch } from '@sz/maps/geometry';
import { describe, expect, it } from 'vitest';

describe('box mesh writer', () => {
  const box = { center: vec3(1, 2, 3), half: vec3(0.5, 1, 2), yaw: 0.7, pitch: 0.3 };

  it('writes 24 vertices and 12 triangles per box with unit normals', () => {
    const m = buildBoxes([box, box]);
    expect(m.triangles).toBe(2 * BOX_TRIANGLES);
    expect(m.positions.length).toBe(2 * BOX_VERTICES * 3);
    expect(m.indices.length).toBe(2 * BOX_TRIANGLES * 3);
    expect(m.colors).toBeNull();
    for (let i = 0; i < m.normals.length; i += 3) {
      const len = Math.hypot(m.normals[i] ?? 0, m.normals[i + 1] ?? 0, m.normals[i + 2] ?? 0);
      expect(len).toBeCloseTo(1, 6);
    }
  });

  it('matches the world-maps rotation convention (q = qYaw × qPitch)', () => {
    const m = buildBoxes([box]);
    // The first face is +X; its first corner is local (hx, -hy, +hz) for u=(0,0,-1), v=(0,1,0).
    const expected = rotateYawPitch(vec3(0.5, -1, 2), box.yaw, box.pitch);
    expect(m.positions[0]).toBeCloseTo(1 + expected.x, 5);
    expect(m.positions[1]).toBeCloseTo(2 + expected.y, 5);
    expect(m.positions[2]).toBeCloseTo(3 + expected.z, 5);
  });

  it('winds faces outward: each triangle normal agrees with its vertex normal', () => {
    const m = buildBoxes([box]);
    const p = (i: number) =>
      vec3(m.positions[i * 3] ?? 0, m.positions[i * 3 + 1] ?? 0, m.positions[i * 3 + 2] ?? 0);
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t] ?? 0, m.indices[t + 1] ?? 0, m.indices[t + 2] ?? 0];
      const pa = p(a);
      const pb = p(b);
      const pc = p(c);
      const ux = pb.x - pa.x,
        uy = pb.y - pa.y,
        uz = pb.z - pa.z;
      const vx = pc.x - pa.x,
        vy = pc.y - pa.y,
        vz = pc.z - pa.z;
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const dot =
        nx * (m.normals[a * 3] ?? 0) +
        ny * (m.normals[a * 3 + 1] ?? 0) +
        nz * (m.normals[a * 3 + 2] ?? 0);
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('tiles UVs once per uvTileM metres and writes colours on request', () => {
    const m = buildBoxes([{ ...box, yaw: 0, pitch: 0, color: [0.1, 0.2, 0.3] }], {
      uvTileM: 2,
      withColor: true,
    });
    // +X face spans z (4 m) by y (2 m): the far corner has uv (2, 1).
    expect(m.uvs[4]).toBeCloseTo(2, 6);
    expect(m.uvs[5]).toBeCloseTo(1, 6);
    expect(Array.from(m.colors?.slice(0, 3) ?? [])).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
  });

  it('treats non-finite numbers as 0 instead of writing NaN', () => {
    const m = buildBoxes([
      { center: vec3(Number.NaN, 0, 0), half: vec3(1, Infinity, 1), yaw: Number.NaN, pitch: 0 },
    ]);
    expect(m.positions.every(Number.isFinite)).toBe(true);
  });
});

describe('rig and viewmodel tables', () => {
  it('has 8 part types and 12 instances per bot', () => {
    expect(RIG_PARTS).toHaveLength(8);
    expect(PARTS_PER_BOT).toBe(12);
  });

  it('has three distinct viewmodels, each under 600 triangles', () => {
    const lengths = new Set<number>();
    for (const [, spec] of VIEWMODELS) {
      expect(spec.boxes.length * BOX_TRIANGLES).toBeLessThan(600);
      const zs = spec.boxes.flatMap((b) => [b.center.z - b.half.z, b.center.z + b.half.z]);
      lengths.add(Math.round((Math.max(...zs) - Math.min(...zs)) * 100));
    }
    expect([...VIEWMODELS.keys()]).toEqual(['rifle', 'pistol', 'sniper']);
    expect(lengths.size).toBe(3);
  });

  it('PresentationBootFailure is structurally an app-shell BootError', () => {
    const cause = new Error('x');
    const e = new PresentationBootFailure('models', cause, true);
    expect(e).toBeInstanceOf(Error);
    expect([e.name, e.step, e.retryable, e.cause]).toEqual([
      'PresentationBootFailure',
      'models',
      true,
      cause,
    ]);
  });
});
