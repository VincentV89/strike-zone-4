/**
 * PhysicsHost (SD-WM-5): owns the single live world. Nav graphs query through the stable
 * `query` facade, so they always hit the world of the map being played and never a freed one.
 */
import type { MapDefinition } from '@sz/maps';
import type { PhysicsHost, PhysicsWorld } from './types';
import { createPhysicsWorld } from './world';

export function createPhysicsHost(
  factory: (map: MapDefinition) => PhysicsWorld = createPhysicsWorld,
): PhysicsHost {
  let world: PhysicsWorld | undefined;
  return {
    load(map) {
      world?.dispose();
      world = undefined;
      world = factory(map);
      return world;
    },
    current: () => world,
    query: {
      raycast: (origin, dir, maxDist, mask, exclude) =>
        world ? world.raycast(origin, dir, maxDist, mask, exclude) : null,
      lineOfSight: (a, b) => (world ? world.lineOfSight(a, b) : false),
    },
    liveWorlds: () => (world && !world.disposed ? 1 : 0),
    dispose() {
      world?.dispose();
      world = undefined;
    },
  };
}
