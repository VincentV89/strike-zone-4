// BR-R-04, NFR-R-T3: posed torso, head and helmet stay inside @sz/physics DEFAULT_HITBOXES.
import { RIG_PARTS } from '@sz/assets/core/rig-parts';
import { createActorSet } from '@sz/render/core/actors';
import { createInstanceBuffer } from '@sz/render/core/buffers';
import { PART_INDEX, poseBot } from '@sz/render/core/rig';
import { DEFAULT_HITBOXES } from '@sz/physics';
import { describe, expect, it } from 'vitest';

function buffers() {
  return RIG_PARTS.map((p) => createInstanceBuffer(20 * p.perBot));
}

function corners(buf: Float32Array, i: number): Array<{ x: number; y: number; z: number }> {
  const m = buf.subarray(i * 16, i * 16 + 16);
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        out.push({
          x: (m[0] ?? 0) * sx + (m[4] ?? 0) * sy + (m[8] ?? 0) * sz + (m[12] ?? 0),
          y: (m[1] ?? 0) * sx + (m[5] ?? 0) * sy + (m[9] ?? 0) * sz + (m[13] ?? 0),
          z: (m[2] ?? 0) * sx + (m[6] ?? 0) * sy + (m[10] ?? 0) * sz + (m[14] ?? 0),
        });
      }
    }
  }
  return out;
}

const EPS = 1e-6;

describe.each(['stand', 'crouch'] as const)('rig fits the hitboxes (%s)', (stance) => {
  const slot = createActorSet().slots[0];
  if (slot === undefined) throw new Error('no slot');
  slot.crouch = stance === 'crouch' ? 1 : 0;
  const bs = buffers();
  poseBot(slot, 0, bs);
  const box = (zone: 'head' | 'body') => {
    const h = DEFAULT_HITBOXES.find((b) => b.zone === zone && b.stance === stance);
    if (h === undefined) throw new Error('missing hitbox');
    return h;
  };

  it.each([
    ['torso', 'body'],
    ['head', 'head'],
    ['helmet', 'head'],
  ] as const)('%s inside the %s box', (part, zone) => {
    const idx = PART_INDEX.get(part) ?? -1;
    const b = bs[idx];
    expect(b?.count).toBe(1);
    const h = box(zone);
    for (const c of corners(b?.matrices ?? new Float32Array(16), 0)) {
      expect(Math.abs(c.x - h.offset.x)).toBeLessThanOrEqual(h.half.x + EPS);
      expect(Math.abs(c.y - h.offset.y)).toBeLessThanOrEqual(h.half.y + EPS);
      expect(Math.abs(c.z - h.offset.z)).toBeLessThanOrEqual(h.half.z + EPS);
    }
  });

  it('writes 12 finite instances with feet at the ground', () => {
    expect(bs.reduce((n, b) => n + b.count, 0)).toBe(12);
    let minY = Infinity;
    for (const b of bs) {
      expect(b.matrices.every(Number.isFinite)).toBe(true);
      for (let i = 0; i < b.count; i++)
        for (const c of corners(b.matrices, i)) minY = Math.min(minY, c.y);
    }
    expect(minY).toBeGreaterThan(-0.12);
    expect(minY).toBeLessThan(0.12);
  });
});

describe('rig reactions', () => {
  it('a dead bot lies flat after 600 ms: the head is near the ground', () => {
    const slot = createActorSet().slots[0];
    if (slot === undefined) throw new Error('no slot');
    slot.deathStart = 0;
    slot.deathDx = 0;
    slot.deathDz = 1;
    const bs = buffers();
    poseBot(slot, 1, bs);
    const head = bs[PART_INDEX.get('head') ?? -1];
    const ys = corners(head?.matrices ?? new Float32Array(16), 0).map((c) => c.y);
    expect(Math.max(...ys)).toBeLessThan(0.5);
  });

  it('hit flash tints every part toward red', () => {
    const slot = createActorSet().slots[0];
    if (slot === undefined) throw new Error('no slot');
    slot.hitFlash = true;
    const bs = buffers();
    poseBot(slot, 0, bs);
    const torso = bs[PART_INDEX.get('torso') ?? -1];
    const [r, g] = [torso?.colors[0] ?? 0, torso?.colors[1] ?? 0];
    expect(r).toBeGreaterThan(g * 2);
  });

  it('a full buffer drops extra instances instead of overflowing', () => {
    const slot = createActorSet().slots[0];
    if (slot === undefined) throw new Error('no slot');
    const bs = RIG_PARTS.map(() => createInstanceBuffer(1));
    poseBot(slot, 0, bs);
    poseBot(slot, 0, bs);
    expect(bs.every((b) => b.count === 1)).toBe(true);
  });
});
