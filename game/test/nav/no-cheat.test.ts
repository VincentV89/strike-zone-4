// SEC-WM-06 / SD-WM-8: navigation only ever asks WORLD questions. During the build every
// raycast uses MASK_WORLD; afterwards the graph only calls lineOfSight.
import { describe, expect, it } from 'vitest';
import { MASK_WORLD, createRng, vec3, type CollisionMask, type PhysicsQuery } from '@sz/kernel';
import { desertCompound } from '@sz/maps';
import { buildNavGraph } from '@sz/nav';
import { createBoxWorldQuery } from '../support/box-world-query';

describe('navigation no-cheat boundary', () => {
  it('uses WORLD-only queries, and no raycast after the build', () => {
    const inner = createBoxWorldQuery(desertCompound);
    const masks = new Set<CollisionMask>();
    let raycastsAfterBuild = 0;
    let built = false;
    const spy: PhysicsQuery = {
      raycast(origin, dir, maxDist, mask, exclude) {
        masks.add(mask);
        if (built) raycastsAfterBuild++;
        return inner.raycast(origin, dir, maxDist, mask, exclude);
      },
      lineOfSight: (a, b) => inner.lineOfSight(a, b),
    };
    const g = buildNavGraph(desertCompound, spy);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    built = true;
    const sightBefore = inner.calls.lineOfSight;
    const rng = createRng(1000);
    const point = () => vec3(rng.range(-46, 46), 0, rng.range(-46, 46));
    for (let i = 0; i < 1000; i++) {
      if (i % 2 === 0) g.value.findPath(point(), point());
      else g.value.findFlankPath(point(), point());
    }
    expect([...masks]).toEqual([MASK_WORLD]);
    expect(raycastsAfterBuild).toBe(0);
    expect(inner.calls.lineOfSight).toBeGreaterThan(sightBefore);
  });

  it('the built graph exposes no physics handle', () => {
    const g = buildNavGraph(desertCompound, createBoxWorldQuery(desertCompound));
    if (!g.ok) throw new Error('build failed');
    const keys = Object.keys(g.value);
    expect(keys.some((k) => /raycast|physics|query/i.test(k))).toBe(false);
  });
});
