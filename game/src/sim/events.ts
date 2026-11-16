/**
 * The logEvent choke point (SD-ML-4, SEC-ML-20). Every event sim produces passes through
 * logEvent: vectors are copied and the event is frozen before it reaches the tick log, the
 * stats feed and the bus. A subscriber therefore cannot move an actor by writing to a payload.
 */
import type { DomainEvent, Vec3 } from '@sz/kernel';

const v = (p: Vec3): Vec3 => Object.freeze({ x: p.x, y: p.y, z: p.z });

function assertNever(e: never): never {
  return e;
}

/** Copies an event and every vector inside it. Exhaustive: a new event type fails typecheck. */
export function copyEvent(e: DomainEvent): DomainEvent {
  switch (e.type) {
    case 'ShotFired':
      return { ...e, origin: v(e.origin), dir: v(e.dir) };
    case 'ShotImpact':
      return { ...e, point: v(e.point), normal: v(e.normal) };
    case 'DamageTaken':
      return { ...e, dir: v(e.dir) };
    case 'Footstep':
      return { ...e, pos: v(e.pos) };
    case 'NoiseEmitted':
      return { ...e, pos: v(e.pos) };
    case 'HitConfirmed':
    case 'ActorKilled':
    case 'WeaponSwitched':
    case 'ReloadStarted':
    case 'ReloadDone':
    case 'DryFire':
    case 'BotStateChanged':
    case 'RoundPhaseChanged':
    case 'RoundEnded':
    case 'PerformanceAdvisory':
      return { ...e };
    default:
      return assertNever(e);
  }
}

export interface TickLog {
  /** Copies, freezes and appends; returns the frozen copy. */
  log(e: DomainEvent): DomainEvent;
  /** The current tick's events, frozen. Memoised until the next log or clear. */
  events(): ReadonlyArray<DomainEvent>;
  clear(): void;
  readonly size: number;
}

const EMPTY: ReadonlyArray<DomainEvent> = Object.freeze([]);

export function createTickLog(): TickLog {
  const items: DomainEvent[] = [];
  let frozen: ReadonlyArray<DomainEvent> | null = EMPTY;
  return {
    log(e) {
      const c = Object.freeze(copyEvent(e));
      items.push(c);
      frozen = null;
      return c;
    },
    events() {
      frozen ??= Object.freeze(items.slice());
      return frozen;
    },
    clear() {
      items.length = 0;
      frozen = EMPTY;
    },
    get size() {
      return items.length;
    },
  };
}
