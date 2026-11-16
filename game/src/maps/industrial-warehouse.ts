/**
 * Industrial Warehouse (req-map-warehouse, story-industrial-warehouse-map). Registered only
 * by passing it to createMapCatalog in the composition root, after desertCompound
 * (BR-WH-01, BR-WH-02). Open-topped hall (ADR-WH-1): the darker hemisphere and indoor fog
 * give the interior look while the steep sun still reaches the floor past the 12 m walls.
 */
import { normalize, vec3 } from '@sz/kernel';
import type { MapDefinition } from './types';
import {
  WAREHOUSE_BOT_SPAWNS,
  WAREHOUSE_COVER_POINTS,
  WAREHOUSE_NAV_LINKS,
  WAREHOUSE_NAV_NODES,
  WAREHOUSE_PATROL_POINTS,
  WAREHOUSE_PLAYER_SPAWNS,
  WAREHOUSE_ROUTES,
} from './warehouse-nav';
import { WAREHOUSE_BOUNDS, WAREHOUSE_SOLIDS } from './warehouse-solids';

export const industrialWarehouse: MapDefinition = {
  id: 'industrial-warehouse',
  name: 'Industrial Warehouse',
  blurb:
    'An enclosed hall: double-stacked shipping containers to the west, an open main floor with pallet racks, and a raised steel gantry on the east wall.',
  bounds: WAREHOUSE_BOUNDS,
  solids: WAREHOUSE_SOLIDS,
  lights: {
    sun: { direction: normalize(vec3(-0.3, -0.9, -0.3)), color: '#F4F1EA', intensity: 2.0 },
    hemisphere: { sky: '#9AA6B2', ground: '#4A4640', intensity: 0.45 },
    fog: { color: '#2E3238', near: 35, far: 110 },
  },
  playerSpawns: WAREHOUSE_PLAYER_SPAWNS,
  botSpawns: WAREHOUSE_BOT_SPAWNS,
  patrolPoints: WAREHOUSE_PATROL_POINTS,
  coverPoints: WAREHOUSE_COVER_POINTS,
  navNodes: WAREHOUSE_NAV_NODES,
  navLinks: WAREHOUSE_NAV_LINKS,
  navAutoLinkRadius: 9,
  routes: WAREHOUSE_ROUTES,
};
