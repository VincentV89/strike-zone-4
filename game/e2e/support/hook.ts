/**
 * The only way specs call window.__strikezone (security-design-verification-suite SD-VS-2,
 * SD-VS-9). startMatch, inject, snapshot and round add a `used-hook` annotation on first use, so
 * the summariser labels the row `injected`. Game types are imported type-only.
 */
import type { Page, TestInfo } from '@playwright/test';
import type { FrameStats, InjectedIntent, TestHook } from '@sz/diagnostics';
import type { Difficulty, MapId } from '@sz/kernel';
import type { RoundView } from '@sz/round';
import type { SimSnapshot } from '@sz/sim';

declare global {
  interface Window {
    readonly __strikezone?: TestHook;
  }
}

export interface E2eSetup {
  readonly mapId: MapId;
  readonly botCount: 1 | 2 | 3 | 5 | 8 | 10 | 15 | 20;
  readonly difficulty: Difficulty;
}

export type PartialIntent = Partial<Omit<InjectedIntent, 'look' | 'move'>> & {
  readonly look?: { readonly dx: number; readonly dy: number };
  readonly move?: { readonly forward: -1 | 0 | 1; readonly right: -1 | 0 | 1 };
};

export interface HookResultJson {
  readonly ok: boolean;
  readonly error?: string;
}

export class HookClient {
  private marked = false;

  constructor(
    private readonly page: Page,
    private readonly info: TestInfo,
  ) {}

  private mark(): void {
    if (this.marked) return;
    this.marked = true;
    this.info.annotations.push({ type: 'used-hook', description: 'window.__strikezone' });
  }

  /** Waits until boot has attached the world (Click to enter is enabled). */
  async waitForBoot(timeoutMs = 90_000): Promise<void> {
    await this.page
      .getByTestId('loading-enter-button')
      .and(this.page.locator(':enabled'))
      .waitFor({ timeout: timeoutMs });
  }

  async startMatch(setup: E2eSetup, seed: number): Promise<HookResultJson> {
    this.mark();
    return this.page.evaluate(
      ([s, n]) => {
        const r = window.__strikezone?.startMatch(s, n);
        return r === undefined
          ? { ok: false, error: 'no-hook' }
          : r.ok
            ? { ok: true }
            : { ok: false, error: r.error };
      },
      [setup, seed] as const,
    );
  }

  async inject(intent: PartialIntent, ticks: number): Promise<HookResultJson> {
    this.mark();
    return this.page.evaluate(
      ([i, t]) => {
        const r = window.__strikezone?.inject(i, t);
        return r === undefined
          ? { ok: false, error: 'no-hook' }
          : r.ok
            ? { ok: true }
            : { ok: false, error: r.error };
      },
      [intent, ticks] as const,
    );
  }

  async snapshot(): Promise<SimSnapshot | undefined> {
    this.mark();
    return this.page.evaluate(() => window.__strikezone?.snapshot());
  }

  async round(): Promise<RoundView | undefined> {
    this.mark();
    return this.page.evaluate(() => window.__strikezone?.round());
  }

  async errors(): Promise<ReadonlyArray<string>> {
    return this.page.evaluate(() => [...(window.__strikezone?.errors() ?? [])]);
  }

  async frameStats(): Promise<FrameStats | undefined> {
    return this.page.evaluate(() => window.__strikezone?.frameStats());
  }

  /** Polls round().phase until it matches; fails with the last phase seen. */
  async waitForPhase(
    phase: RoundView['phase'],
    timeoutMs = 30_000,
  ): Promise<RoundView | undefined> {
    const until = Date.now() + timeoutMs;
    let view = await this.round();
    while (view?.phase !== phase && Date.now() < until) {
      await this.page.waitForTimeout(100);
      view = await this.round();
    }
    if (view?.phase !== phase) {
      throw new Error(
        `round phase ${String(view?.phase)} after ${String(timeoutMs)} ms, wanted ${phase}`,
      );
    }
    return view;
  }
}
