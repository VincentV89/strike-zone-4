// Pure tests of the WASM-boundary guards, collision groups and fault reporter (SD-WM-1,
// SD-WM-3). No Rapier needed.
import { describe, expect, it, vi } from 'vitest';
import { Layer, vec3 } from '@sz/kernel';
import { createFaultReporter, defaultReport } from '@sz/physics/faults';
import { CHARACTER, GROUPS, LAYER_ALL, groups, queryGroups } from '@sz/physics/groups';
import {
  MAX_RAY_DIST,
  clampMask,
  okDt,
  okSize,
  okVec,
  rayDist,
  safeVelocity,
  unitDir,
} from '@sz/physics/guards';

const NAN = Number.NaN;

/** Rapier's rule: each side's membership must match the other's filter. */
function interacts(a: number, b: number): boolean {
  const mem = (g: number) => g >>> 16;
  const fil = (g: number) => g & 0xffff;
  return (mem(a) & fil(b)) !== 0 && (mem(b) & fil(a)) !== 0;
}

describe('guards', () => {
  it('okVec rejects non-finite and out-of-world coordinates', () => {
    expect(okVec(vec3(1, 2, 3))).toBe(true);
    expect(okVec(vec3(10_000, -10_000, 0))).toBe(true);
    for (const v of [
      vec3(NAN, 0, 0),
      vec3(0, Infinity, 0),
      vec3(0, 0, -Infinity),
      vec3(10_001, 0, 0),
    ]) {
      expect(okVec(v)).toBe(false);
    }
  });

  it('unitDir normalises and rejects zero or non-finite directions', () => {
    expect(unitDir(vec3(0, 0, -7))).toEqual(vec3(0, 0, -1));
    expect(unitDir(vec3(0, 0, 0))).toBeNull();
    expect(unitDir(vec3(1e-12, 0, 0))).toBeNull();
    expect(unitDir(vec3(NAN, 0, 1))).toBeNull();
    expect(unitDir(vec3(Infinity, 0, 0))).toBeNull();
  });

  it('rayDist clamps finite positive distances to 512 m', () => {
    expect(rayDist(10)).toBe(10);
    expect(rayDist(1e9)).toBe(MAX_RAY_DIST);
    for (const d of [0, -1, NAN, Infinity]) expect(rayDist(d)).toBeNull();
  });

  it('okDt accepts (0, 0.25] only', () => {
    expect(okDt(1 / 60)).toBe(true);
    expect(okDt(0.25)).toBe(true);
    for (const dt of [0, -0.1, 0.26, NAN, Infinity]) expect(okDt(dt)).toBe(false);
  });

  it('clampMask keeps kernel layers only, so CHARACTER can never be selected', () => {
    expect(clampMask(0xffff)).toBe(LAYER_ALL);
    expect(clampMask(CHARACTER)).toBe(0);
    expect(clampMask(1.5)).toBe(0);
    expect(clampMask(NAN)).toBe(0);
    expect(clampMask(Layer.WORLD)).toBe(Layer.WORLD);
  });

  it('safeVelocity zeroes hostile components', () => {
    expect(safeVelocity(vec3(NAN, 2, Infinity))).toEqual(vec3(0, 2, 0));
    expect(safeVelocity(vec3(1e9, 0, 0))).toEqual(vec3(0, 0, 0));
  });

  it('okSize', () => {
    expect(okSize(1, 2)).toBe(true);
    expect(okSize(0, 2)).toBe(false);
    expect(okSize(3, 2)).toBe(false);
    expect(okSize(NAN, 2)).toBe(false);
  });
});

describe('collision groups (BR-WM-53, BR-WM-54)', () => {
  const hitbox = groups(Layer.BOT_BODY, 0xffff);

  it('packs membership in the high half and filter in the low half as a u32', () => {
    expect(groups(0xffff, 0x0001)).toBe(0xffff0001);
    expect(groups(Layer.WORLD, 0xffff)).toBe(0x0001ffff);
  });

  it('capsules collide with the world only and are invisible to every kernel query', () => {
    expect(interacts(GROUPS.capsule, GROUPS.world)).toBe(true);
    expect(interacts(GROUPS.capsule, GROUPS.capsule)).toBe(false);
    expect(interacts(GROUPS.capsule, hitbox)).toBe(false);
    expect(interacts(queryGroups(clampMask(0xffff)), GROUPS.capsule)).toBe(false);
  });

  it('hitboxes answer shot queries but not WORLD queries', () => {
    expect(interacts(queryGroups(Layer.BOT_BODY), hitbox)).toBe(true);
    expect(interacts(GROUPS.worldQuery, hitbox)).toBe(false);
    expect(interacts(GROUPS.controllerQuery, hitbox)).toBe(false);
    expect(interacts(GROUPS.controllerQuery, GROUPS.world)).toBe(true);
  });
});

describe('fault reporter (SD-WM-3)', () => {
  it('returns the fallback and reports each kind once, truncated', () => {
    const lines: string[] = [];
    const guarded = createFaultReporter((l) => lines.push(l));
    const boom = (): number => {
      throw new Error('x'.repeat(500));
    };
    for (let i = 0; i < 100; i++) expect(guarded('raycast', -1, boom)).toBe(-1);
    expect(guarded('move', 7, () => 7)).toBe(7);
    expect(
      guarded('step', 'f', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- non-Error throw path
        throw 'not an error';
      }),
    ).toBe('f');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`physics: raycast failed: ${'x'.repeat(200)}`);
    expect(lines[1]).toBe('physics: step failed: non-Error thrown');
  });

  it('the default sink is console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defaultReport('physics: test');
    expect(spy).toHaveBeenCalledWith('physics: test');
    spy.mockRestore();
  });
});
