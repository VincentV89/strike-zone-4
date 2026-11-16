/**
 * Map schema (domain-entities-world-maps). Metres and radians, +Y up, yaw 0 faces -Z.
 * Every field is readonly; createMapCatalog deep-freezes accepted maps (SD-WM-9).
 */
import type { MapId, Vec3 } from '@sz/kernel';

export type MaterialId =
  | 'sand'
  | 'packed-earth'
  | 'plaster'
  | 'concrete'
  | 'metal'
  | 'crate-wood'
  | 'container-paint'
  | 'invisible';

export type SolidRole = 'ground' | 'wall' | 'prop' | 'roof' | 'ramp' | 'boundary';

/** Oriented box: centre, half extents, yaw about +Y, then pitch about the box's local X axis. */
export interface Solid {
  readonly id: string;
  readonly role: SolidRole;
  readonly center: Vec3;
  readonly half: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly material: MaterialId;
  readonly castShadow: boolean;
}

export interface SpawnPoint {
  readonly id: string;
  readonly area: string;
  /** Feet position on the ground surface. */
  readonly pos: Vec3;
  readonly yaw: number;
}

export interface PatrolPoint {
  readonly id: string;
  readonly pos: Vec3;
}

export interface CoverPoint {
  readonly id: string;
  /** Feet position where a bot stands or crouches. */
  readonly pos: Vec3;
  /** Horizontal unit vector pointing from the cover point toward the protecting solid. */
  readonly facing: Vec3;
  readonly crouchOnly: boolean;
}

export type NavNodeTag =
  'spawn-player' | 'spawn-bot' | 'patrol' | 'cover' | 'elevated' | 'corridor';

export interface NavNodeDef {
  readonly id: string;
  readonly pos: Vec3;
  readonly tags: ReadonlyArray<NavNodeTag>;
}

export type NavLinkKind = 'walk' | 'ramp';

export interface NavLinkDef {
  readonly a: string;
  readonly b: string;
  readonly kind: NavLinkKind;
}

export interface RouteDef {
  /** Stable kebab-case id, e.g. 'west-alley'. Used for flank reservations. */
  readonly id: string;
  readonly name: string;
  /** Ordered nav node ids from the player spawn side to the bot spawn side. */
  readonly nodes: ReadonlyArray<string>;
}

export interface SunLight {
  /** Direction the light travels (unit vector, pointing down into the scene). */
  readonly direction: Vec3;
  readonly color: string;
  readonly intensity: number;
}

export interface MapLights {
  readonly sun: SunLight;
  readonly hemisphere: {
    readonly sky: string;
    readonly ground: string;
    readonly intensity: number;
  };
  readonly fog: { readonly color: string; readonly near: number; readonly far: number };
}

export interface MapBounds {
  readonly min: Vec3;
  readonly max: Vec3;
  /** Any actor below this height is out of the world (simulation respawns it). */
  readonly killY: number;
}

export interface MapDefinition {
  readonly id: MapId;
  readonly name: string;
  readonly blurb: string;
  readonly bounds: MapBounds;
  readonly solids: ReadonlyArray<Solid>;
  readonly lights: MapLights;
  readonly playerSpawns: ReadonlyArray<SpawnPoint>;
  readonly botSpawns: ReadonlyArray<SpawnPoint>;
  readonly patrolPoints: ReadonlyArray<PatrolPoint>;
  readonly coverPoints: ReadonlyArray<CoverPoint>;
  readonly navNodes: ReadonlyArray<NavNodeDef>;
  readonly navLinks: ReadonlyArray<NavLinkDef>;
  /** Same-level nodes closer than this are linked automatically when the link passes validation. */
  readonly navAutoLinkRadius: number;
  readonly routes: ReadonlyArray<RouteDef>;
}

export interface MapSummary {
  readonly id: MapId;
  readonly name: string;
  readonly blurb: string;
}

export type MapValidationCode =
  | 'duplicate-map'
  | 'duplicate-id'
  | 'unknown-node'
  | 'missing-tagged-node'
  | 'too-few-spawns'
  | 'too-few-routes'
  | 'too-many'
  | 'out-of-bounds'
  | 'bad-solid'
  | 'bad-ramp'
  | 'bad-light'
  | 'bad-bounds'
  | 'invisible-not-boundary';

export interface MapValidationError {
  readonly mapId: string;
  readonly code: MapValidationCode;
  /** JSON-path-like location, e.g. 'solids[12].half.y'. */
  readonly path: string;
}

export interface MapCatalog {
  listMaps(): ReadonlyArray<MapSummary>;
  /** Undefined when the id is valid but its map is not registered (BR-WM-07). */
  getMap(id: MapId): MapDefinition | undefined;
  has(id: MapId): boolean;
}

export interface SpawnPlan {
  readonly player: SpawnPoint;
  /** Exactly botCount entries, in the order bot-1 … bot-N receive them. */
  readonly bots: ReadonlyArray<SpawnPoint>;
}

export type SpawnError = 'invalid-bot-count' | 'insufficient-spawns';

export interface RadarSegment {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
}
