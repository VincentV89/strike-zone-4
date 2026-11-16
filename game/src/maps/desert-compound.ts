/**
 * Desert Compound (req-map-desert, story-desert-compound-map). Registered by passing it to
 * createMapCatalog in the composition root (BR-WM-01).
 */
import { normalize, vec3 } from '@sz/kernel';
import type { MapDefinition } from './types';
import {
  DESERT_BOT_SPAWNS,
  DESERT_COVER_POINTS,
  DESERT_NAV_LINKS,
  DESERT_NAV_NODES,
  DESERT_PATROL_POINTS,
  DESERT_PLAYER_SPAWNS,
  DESERT_ROUTES,
} from './desert-nav';
import { DESERT_BOUNDS, DESERT_SOLIDS } from './desert-solids';

export const desertCompound: MapDefinition = {
  id: 'desert-compound',
  name: 'Desert Compound',
  blurb:
    'A walled compound in the sand: a narrow west alley, two central squares, a watchtower roof and an east market street.',
  bounds: DESERT_BOUNDS,
  solids: DESERT_SOLIDS,
  lights: {
    sun: { direction: normalize(vec3(-0.35, -0.85, -0.4)), color: '#FFE2B0', intensity: 2.4 },
    hemisphere: { sky: '#BFD8F0', ground: '#C9A877', intensity: 0.6 },
    fog: { color: '#E9D7B8', near: 60, far: 160 },
  },
  playerSpawns: DESERT_PLAYER_SPAWNS,
  botSpawns: DESERT_BOT_SPAWNS,
  patrolPoints: DESERT_PATROL_POINTS,
  coverPoints: DESERT_COVER_POINTS,
  navNodes: DESERT_NAV_NODES,
  navLinks: DESERT_NAV_LINKS,
  navAutoLinkRadius: 9,
  routes: DESERT_ROUTES,
};
