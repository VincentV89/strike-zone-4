/**
 * Frame probe (PD-AS-5, component-methods `createFrameProbe`). One Float64Array ring plus one
 * scratch array for the median, both allocated once. sample() never allocates; stats are
 * computed on demand only.
 */

export interface FrameStats {
  readonly samples: number;
  readonly medianFps: number;
  readonly worstMs: number;
  readonly p95Ms: number;
}

export interface FrameProbe {
  /** Records one frame time in ms; non-finite or non-positive values are dropped. */
  sample(frameMs: number): void;
  /** Median FPS over the ring (0 with no samples). */
  medianFps(): number;
  stats(): FrameStats;
  readonly count: number;
  readonly capacity: number;
  reset(): void;
}

const EMPTY: FrameStats = Object.freeze({ samples: 0, medianFps: 0, worstMs: 0, p95Ms: 0 });

export function createFrameProbe(capacity: number): FrameProbe {
  const cap = Number.isInteger(capacity) && capacity > 0 ? capacity : 60;
  const ring = new Float64Array(cap);
  const scratch = new Float64Array(cap);
  let next = 0;
  let count = 0;

  /** Copies the live samples into scratch and sorts them in place; returns the length. */
  function sorted(): number {
    scratch.set(ring);
    const view = scratch.subarray(0, count);
    view.sort();
    return count;
  }

  const at = (i: number): number => scratch[i] ?? 0;

  function medianMs(n: number): number {
    const mid = n >> 1;
    return n % 2 === 1 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
  }

  return {
    sample(frameMs) {
      if (!Number.isFinite(frameMs) || frameMs <= 0) return;
      ring[next] = frameMs;
      next = (next + 1) % cap;
      if (count < cap) count++;
    },
    medianFps() {
      if (count === 0) return 0;
      const ms = medianMs(sorted());
      return ms > 0 ? 1000 / ms : 0;
    },
    stats() {
      if (count === 0) return EMPTY;
      const n = sorted();
      const ms = medianMs(n);
      return Object.freeze({
        samples: n,
        medianFps: ms > 0 ? 1000 / ms : 0,
        worstMs: at(n - 1),
        p95Ms: at(Math.min(n - 1, Math.ceil(0.95 * n) - 1)),
      });
    },
    get count() {
      return count;
    },
    capacity: cap,
    reset() {
      next = 0;
      count = 0;
      ring.fill(0);
    },
  };
}
