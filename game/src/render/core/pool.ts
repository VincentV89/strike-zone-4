/**
 * Fixed-capacity effect rings (PD-R-5, PD-R-12, BR-R-09). Allocated once at the High cap;
 * acquire never allocates and steals the oldest live slot when the active cap is reached.
 */
export interface EffectSlot {
  live: boolean;
  /** Acquisition order; the smallest live seq is the oldest. */
  seq: number;
  start: number;
  dur: number;
  x: number;
  y: number;
  z: number;
  /** Surface normal or travel direction (unit). */
  nx: number;
  ny: number;
  nz: number;
  size: number;
}

export interface EffectPool {
  readonly capacity: number;
  cap: number;
  readonly slots: ReadonlyArray<EffectSlot>;
  /** slots[0], kept typed as present (capacity ≥ 1). */
  readonly first: EffectSlot;
  nextSeq: number;
  live: number;
}

export function createPool(capacity: number): EffectPool {
  const n = Math.max(1, Math.floor(capacity));
  const make = (): EffectSlot => ({
    live: false,
    seq: 0,
    start: 0,
    dur: 0,
    x: 0,
    y: 0,
    z: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    size: 0,
  });
  const first = make();
  const slots: EffectSlot[] = [first];
  for (let i = 1; i < n; i++) slots.push(make());
  return { capacity: n, cap: n, slots, first, nextSeq: 1, live: 0 };
}

function oldestLive(pool: EffectPool): EffectSlot | undefined {
  let best: EffectSlot | undefined;
  for (const s of pool.slots) {
    if (s.live && (best === undefined || s.seq < best.seq)) best = s;
  }
  return best;
}

function retire(pool: EffectPool, s: EffectSlot): void {
  if (!s.live) return;
  s.live = false;
  pool.live -= 1;
}

/** A slot marked live at time t; the caller fills position and shape fields. */
export function acquire(pool: EffectPool, t: number, dur: number): EffectSlot {
  let slot: EffectSlot | undefined;
  if (pool.live >= pool.cap) {
    slot = oldestLive(pool);
    if (slot !== undefined) retire(pool, slot);
  }
  if (slot === undefined) {
    for (const candidate of pool.slots) {
      if (!candidate.live) {
        slot = candidate;
        break;
      }
    }
  }
  // capacity ≥ cap ≥ 1 and live < capacity here, so a free slot exists.
  const s = slot ?? pool.first;
  s.live = true;
  s.seq = pool.nextSeq++;
  s.start = t;
  s.dur = dur;
  pool.live += 1;
  return s;
}

/** Lowering the cap retires the oldest live effects; raising it allocates nothing. */
export function setCap(pool: EffectPool, cap: number): void {
  pool.cap = Math.min(
    pool.capacity,
    Math.max(1, Number.isFinite(cap) ? Math.floor(cap) : pool.capacity),
  );
  while (pool.live > pool.cap) {
    const s = oldestLive(pool);
    if (s === undefined) break;
    retire(pool, s);
  }
}

/** Expires effects whose time is up. Infinite-duration effects (decals) only leave by stealing. */
export function advance(pool: EffectPool, t: number): void {
  for (const s of pool.slots) {
    if (s.live && t - s.start >= s.dur) retire(pool, s);
  }
}

export function clearPool(pool: EffectPool): void {
  for (const s of pool.slots) s.live = false;
  pool.live = 0;
  pool.nextSeq = 1;
}
