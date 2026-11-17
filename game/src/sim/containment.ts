/**
 * Narrow per-bot containment (SD-ML-5, BR-ML-34). Only a bot's own bot-ai calls and its weapon
 * tick run inside `guard`. A throw freezes that bot for the rest of the tick (zero intent, no
 * fire) and calls the injected reporter at most once per bot per round. sim never uses console.
 */
import type { ActorId } from '@sz/kernel';

export type BotErrorReporter = (bot: ActorId, err: unknown) => void;

export interface Containment {
  /** Runs fn for a bot that is not frozen this tick; returns undefined if frozen or if it threw. */
  guard<T>(bot: ActorId, fn: () => T): T | undefined;
  isFrozen(bot: ActorId): boolean;
  /** Step 0: clears the frozen set. */
  beginTick(): void;
  /** Spawn: clears the reported set, so a new round reports again. */
  resetRound(): void;
  readonly reportedCount: number;
}

export function createContainment(report: BotErrorReporter): Containment {
  const frozen = new Set<ActorId>();
  const reported = new Set<ActorId>();
  return {
    guard(bot, fn) {
      if (frozen.has(bot)) return undefined;
      try {
        return fn();
      } catch (err) {
        frozen.add(bot);
        if (!reported.has(bot)) {
          reported.add(bot);
          report(bot, err); // a throwing reporter propagates on purpose (SEC-ML-30)
        }
        return undefined;
      }
    },
    isFrozen: (bot) => frozen.has(bot),
    beginTick() {
      frozen.clear();
    },
    resetRound() {
      frozen.clear();
      reported.clear();
    },
    get reportedCount() {
      return reported.size;
    },
  };
}
