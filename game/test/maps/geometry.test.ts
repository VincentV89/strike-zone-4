// Rotation convention and authoring helpers (business-logic-model-world-maps).
import { describe, expect, it } from 'vitest';
import { createRng, dirFromYawPitch, distance, vec3, type Vec3 } from '@sz/kernel';
import {
  RAMP_THICKNESS,
  box,
  boundaryRing,
  chain,
  coverBeside,
  crate,
  crateStack,
  footprint2d,
  linkChain,
  quatFromYawPitch,
  ramp,
  rotateYawPitch,
  solidCorners,
  solidTop,
  wall,
  type Quat,
} from '@sz/maps';
import { RAPIER_SKIP_REASON, rapierAvailable } from '../support/rapier-probe';

function rotateByQuat(q: Quat, v: Vec3): Vec3 {
  // v' = q v q*, expanded.
  const { x, y, z, w } = q;
  const ix = w * v.x + y * v.z - z * v.y;
  const iy = w * v.y + z * v.x - x * v.z;
  const iz = w * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return vec3(
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  );
}

const close = (a: Vec3, b: Vec3, eps = 1e-9) => {
  expect(distance(a, b)).toBeLessThan(eps);
};

describe('rotation convention', () => {
  it('forward (-Z) rotated by yaw and pitch equals the kernel dirFromYawPitch', () => {
    const rng = createRng(7);
    for (let i = 0; i < 50; i++) {
      const yaw = rng.range(-Math.PI, Math.PI);
      const pitch = rng.range(-1.2, 1.2);
      close(rotateYawPitch(vec3(0, 0, -1), yaw, pitch), dirFromYawPitch(yaw, pitch));
    }
  });

  it('quatFromYawPitch rotates exactly like rotateYawPitch (q = qYaw × qPitch)', () => {
    const rng = createRng(11);
    for (let i = 0; i < 50; i++) {
      const yaw = rng.range(-3, 3);
      const pitch = rng.range(-1, 1);
      const v = vec3(rng.range(-2, 2), rng.range(-2, 2), rng.range(-2, 2));
      close(rotateByQuat(quatFromYawPitch(yaw, pitch), v), rotateYawPitch(v, yaw, pitch));
    }
  });
});

describe('authoring helpers', () => {
  it('box builds an axis-aligned solid from corners in any order', () => {
    const s = box('b', 'wall', vec3(2, 3, 4), vec3(0, 0, 0), 'plaster');
    expect(s).toMatchObject({ center: vec3(1, 1.5, 2), half: vec3(1, 1.5, 2), yaw: 0, pitch: 0 });
    expect(s.castShadow).toBe(true);
    expect(box('g', 'ground', vec3(0, 0, 0), vec3(1, 1, 1), 'sand').castShadow).toBe(false);
  });

  it('wall follows its segment and stands on y = 0', () => {
    const s = wall('w', vec3(0, 0, 0), vec3(10, 0, 0), { height: 3, thickness: 0.5 }, 'plaster');
    expect(s.half.z).toBeCloseTo(5);
    expect(Math.min(...solidCorners(s).map((c) => c.y))).toBeCloseTo(0);
    const xs = solidCorners(s).map((c) => c.x);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(10);
  });

  it('ramp: the top surface passes through both endpoints and the pitch is the climb angle', () => {
    const from = vec3(18.5, 0, 20);
    const to = vec3(18.5, 6, 8);
    const s = ramp('r', from, to, 2.5, 'concrete');
    expect(s.role).toBe('ramp');
    expect((s.pitch * 180) / Math.PI).toBeCloseTo(26.565, 2);
    expect(s.half.y * 2).toBeCloseTo(RAMP_THICKNESS);
    const up = rotateYawPitch(vec3(0, 1, 0), s.yaw, s.pitch);
    const fwd = rotateYawPitch(vec3(0, 0, -1), s.yaw, s.pitch);
    const topMid = vec3(
      s.center.x + up.x * s.half.y,
      s.center.y + up.y * s.half.y,
      s.center.z + up.z * s.half.y,
    );
    const end = (sign: number) =>
      vec3(
        topMid.x + fwd.x * s.half.z * sign,
        topMid.y + fwd.y * s.half.z * sign,
        topMid.z + fwd.z * s.half.z * sign,
      );
    close(end(-1), from, 1e-9);
    close(end(1), to, 1e-9);
    expect(solidTop(s)).toBeCloseTo(6, 9);
  });

  it('crate sizes, stacks and boundary ring', () => {
    expect(crate('c', vec3(0, 0, 0), 1.2).center.y).toBeCloseTo(0.6);
    const stack = crateStack('s', vec3(0, 0, 0), [1.4, 1.0]);
    expect(stack.map((s) => s.center.y)).toEqual([0.7, 1.9]);
    const ring = boundaryRing(
      { min: vec3(-10, 0, -10), max: vec3(10, 5, 10), killY: -5 },
      6,
      'plaster',
    );
    expect(ring).toHaveLength(4);
    expect(ring.every((s) => s.role === 'boundary' && !s.castShadow)).toBe(true);
  });

  it('chain spaces nodes at most `spacing` apart, inclusive of both ends', () => {
    const nodes = chain('c', vec3(0, 0, 0), vec3(0, 0, -10), 3, 'corridor');
    expect(nodes.map((n) => n.id)).toEqual(['c-0', 'c-1', 'c-2', 'c-3', 'c-4']);
    expect(nodes[4]?.pos.z).toBeCloseTo(-10);
    expect(nodes.every((n) => n.tags.includes('corridor'))).toBe(true);
    expect(linkChain(['a', 'b', 'c'], 'ramp')).toEqual([
      { a: 'a', b: 'b', kind: 'ramp' },
      { a: 'b', b: 'c', kind: 'ramp' },
    ]);
  });

  it('coverBeside stands beyond the face and faces the solid', () => {
    const s = crate('c', vec3(0, 0, 0), 1.2);
    expect(coverBeside('n', s, 'n', { gap: 0.9, crouchOnly: true })).toMatchObject({
      pos: vec3(0, 0, -1.5),
      facing: vec3(0, 0, 1),
    });
    expect(coverBeside('e', s, 'e', { gap: 0.9, crouchOnly: false }).pos.x).toBeCloseTo(1.5);
    expect(coverBeside('w', s, 'w', { gap: 0.9, crouchOnly: false }).facing).toEqual(vec3(1, 0, 0));
    expect(coverBeside('s', s, 's', { gap: 0.9, crouchOnly: false }).pos.z).toBeCloseTo(1.5);
  });

  it('footprint2d gives the plan rectangle of an unrotated box', () => {
    const fp = footprint2d(box('b', 'wall', vec3(0, 0, 0), vec3(2, 1, 3), 'plaster'));
    expect(fp).toEqual([
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 3 },
      { x: 0, z: 3 },
    ]);
  });
});

describe.skipIf(!rapierAvailable)(
  `Rapier cross-check of solid corners${RAPIER_SKIP_REASON}`,
  () => {
    it('20 random oriented solids: Rapier agrees on which points are inside', async () => {
      const R = await import('@dimforge/rapier3d-compat');
      const world = new R.World({ x: 0, y: 0, z: 0 });
      const rng = createRng(20);
      for (let i = 0; i < 20; i++) {
        const s = {
          id: `s${String(i)}`,
          role: 'wall' as const,
          center: vec3(rng.range(-20, 20), rng.range(0, 5), rng.range(-20, 20)),
          half: vec3(rng.range(0.3, 3), rng.range(0.3, 3), rng.range(0.3, 3)),
          yaw: rng.range(-Math.PI, Math.PI),
          pitch: rng.range(-0.5, 0.5),
          material: 'plaster' as const,
          castShadow: true,
        };
        const body = world.createRigidBody(
          R.RigidBodyDesc.fixed()
            .setTranslation(s.center.x, s.center.y, s.center.z)
            .setRotation(quatFromYawPitch(s.yaw, s.pitch)),
        );
        const c = world.createCollider(R.ColliderDesc.cuboid(s.half.x, s.half.y, s.half.z), body);
        for (const corner of solidCorners(s)) {
          const towards = (t: number) =>
            vec3(
              s.center.x + (corner.x - s.center.x) * t,
              s.center.y + (corner.y - s.center.y) * t,
              s.center.z + (corner.z - s.center.z) * t,
            );
          expect(c.containsPoint(towards(0.98))).toBe(true);
          expect(c.containsPoint(towards(1.02))).toBe(false);
        }
      }
      world.free();
    });
  },
);
