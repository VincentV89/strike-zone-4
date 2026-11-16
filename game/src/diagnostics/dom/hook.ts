/**
 * E2E test hook (dec-e2e-test-hook, SD-AS-10). Installed only with `?e2e` as a frozen,
 * non-writable, non-configurable, non-enumerable `__strikezone` property. It exposes narrow
 * closures that drive the local player's input and read frozen state; never the round, store,
 * bus, sim or input objects (SEC-AS-20 to SEC-AS-24).
 */
import {
  parseSeed,
  parseTicks,
  sanitizeInjectedIntent,
  type InjectedIntent,
} from '@sz/diagnostics/core/inject';
import type { FrameStats } from '@sz/diagnostics/core/probe';
import { err, ok, parseMatchSetup, type MatchSetup, type Result } from '@sz/kernel';
import type { RoundView } from '@sz/round';
import type { SimSnapshot } from '@sz/sim';

export const HOOK_PROPERTY = '__strikezone';

export interface HookDeps {
  readonly snapshot: () => SimSnapshot | undefined;
  readonly roundView: () => RoundView | undefined;
  /** The same path as the menu's Start, then beginCountdown() without pointer lock. */
  readonly startMatch: (setup: MatchSetup, seed: number) => Result<void, string>;
  readonly inject: (intent: InjectedIntent, ticks: number) => void;
  readonly errors: () => ReadonlyArray<string>;
  readonly frameStats: () => FrameStats;
  readonly ignoredIntents: () => number;
}

export type HookResult = Result<void, string>;

export interface TestHook {
  snapshot(): SimSnapshot | undefined;
  round(): RoundView | undefined;
  startMatch(setup: unknown, seed: unknown): HookResult;
  inject(intent: unknown, ticks: unknown): HookResult;
  errors(): ReadonlyArray<string>;
  frameStats(): FrameStats;
  ignoredIntents(): number;
}

const frozen = <T>(r: Result<T, string>): Result<T, string> => Object.freeze(r);

export function createTestHook(deps: HookDeps): TestHook {
  return Object.freeze({
    snapshot: () => deps.snapshot(),
    round: () => deps.roundView(),
    startMatch(setup: unknown, seed: unknown): HookResult {
      const s = parseMatchSetup(setup);
      if (!s.ok) return frozen(err('invalid-setup'));
      const n = parseSeed(seed);
      if (!n.ok) return frozen(err(n.error));
      return frozen(deps.startMatch(s.value, n.value));
    },
    inject(intent: unknown, ticks: unknown): HookResult {
      const t = parseTicks(ticks);
      if (!t.ok) return frozen(err(t.error));
      const i = sanitizeInjectedIntent(intent);
      if (!i.ok) return frozen(err(i.error));
      deps.inject(i.value, t.value);
      return frozen(ok(undefined));
    },
    errors: () => deps.errors(),
    frameStats: () => deps.frameStats(),
    ignoredIntents: () => deps.ignoredIntents(),
  });
}

/** A second install throws TypeError from defineProperty (a path only tests reach). */
export function installTestHook(target: object, deps: HookDeps): TestHook {
  const hook = createTestHook(deps);
  Object.defineProperty(target, HOOK_PROPERTY, {
    value: hook,
    writable: false,
    configurable: false,
    enumerable: false,
  });
  return hook;
}
