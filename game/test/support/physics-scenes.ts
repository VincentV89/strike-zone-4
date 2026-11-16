// Test helpers for Rapier-backed physics tests: tiny MapDefinitions made of boxes.
import { vec3, type Vec3 } from '@sz/kernel';
import { box, type MapDefinition, type Solid } from '@sz/maps';

/** A MapDefinition holding only `solids`; everything else is empty but well-formed. */
export function sceneMap(solids: ReadonlyArray<Solid>, id = 'desert-compound'): MapDefinition {
  return {
    id: id as MapDefinition['id'],
    name: 'test scene',
    blurb: '',
    bounds: { min: vec3(-100, -10, -100), max: vec3(100, 50, 100), killY: -20 },
    solids,
    lights: {
      sun: { direction: vec3(0, -1, 0), color: '#fff', intensity: 1 },
      hemisphere: { sky: '#fff', ground: '#000', intensity: 1 },
      fog: { color: '#fff', near: 1, far: 2 },
    },
    playerSpawns: [],
    botSpawns: [],
    patrolPoints: [],
    coverPoints: [],
    navNodes: [],
    navLinks: [],
    navAutoLinkRadius: 0,
    routes: [],
  };
}

export const floor = (half = 50): Solid =>
  box('floor', 'ground', vec3(-half, -1, -half), vec3(half, 0, half), 'sand');

export const wallBox = (id: string, min: Vec3, max: Vec3): Solid =>
  box(id, 'wall', min, max, 'plaster');
