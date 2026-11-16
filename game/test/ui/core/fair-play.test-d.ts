// SD-UI-13: fair-play surfaces carry no Vec3. Gated by `tsc --noEmit` (tsconfig includes
// test/**/*.ts); Vitest does not run *.test-d.ts files.
import type { Vec3 } from '@sz/kernel';
import type { EndScreenModel } from '@sz/ui/core/end-model';
import type { HistoryModel } from '@sz/ui/core/history-model';
import type { FeedRowModel, ScoreboardModel } from '@sz/ui/core/hud-model';
import type { PauseModel } from '@sz/ui/core/pause-model';

/** true when T contains a Vec3-shaped value anywhere. */
type HasVec3<T> = T extends Vec3
  ? true
  : T extends ReadonlyArray<infer U>
    ? HasVec3<U>
    : T extends object
      ? true extends { [K in keyof T]-?: HasVec3<T[K]> }[keyof T]
        ? true
        : false
      : false;

type AssertFalse<T extends false> = T;

export type ScoreboardIsPositionFree = AssertFalse<HasVec3<ScoreboardModel>>;
export type FeedIsPositionFree = AssertFalse<HasVec3<FeedRowModel>>;
export type EndIsPositionFree = AssertFalse<HasVec3<EndScreenModel>>;
export type PauseIsPositionFree = AssertFalse<HasVec3<PauseModel>>;
export type HistoryIsPositionFree = AssertFalse<HasVec3<HistoryModel>>;

// Fixtures proving the check bites.
interface Leaky {
  readonly rows: ReadonlyArray<{ readonly pos: Vec3 }>;
}
// @ts-expect-error a model with a nested Vec3 must fail the assertion
export type LeakyFails = AssertFalse<HasVec3<Leaky>>;
// @ts-expect-error a bare Vec3 must fail too
export type Vec3Fails = AssertFalse<HasVec3<Vec3>>;
