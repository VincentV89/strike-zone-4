/**
 * Performance advisory rule (FD-AS-1, PD-AS-6). Fires at most once per round while the preset is
 * High, after at least 300 live unpaused sampled frames (5 s), when the rolling median FPS is
 * below 30. Bot count is not an input. The median is read at most once per 60 live frames.
 */
import type { RoundPhase } from '@sz/kernel';

export const ADVISORY_RULES = Object.freeze({
  minLiveFrames: 300,
  fpsThreshold: 30,
  checkEvery: 60,
});

export interface AdvisoryInput {
  readonly phase: RoundPhase;
  readonly paused: boolean;
  readonly preset: string;
  /** Called only when a check is due. */
  readonly medianFps: () => number;
}

export interface AdvisoryRule {
  /** Call once per sampled frame. Returns the median FPS when the advisory fires, else null. */
  evaluate(input: AdvisoryInput): number | null;
  /** On every new round (RoundPhaseChanged loading → ready). */
  rearm(): void;
  readonly liveFrames: number;
  readonly fired: boolean;
}

export function createAdvisoryRule(): AdvisoryRule {
  let liveFrames = 0;
  let fired = false;
  return {
    evaluate(i) {
      if (fired || i.phase !== 'live' || i.paused) return null;
      liveFrames++;
      if (i.preset !== 'high' || liveFrames < ADVISORY_RULES.minLiveFrames) return null;
      if ((liveFrames - ADVISORY_RULES.minLiveFrames) % ADVISORY_RULES.checkEvery !== 0) {
        return null;
      }
      const fps = i.medianFps();
      if (!Number.isFinite(fps) || fps <= 0 || fps >= ADVISORY_RULES.fpsThreshold) return null;
      fired = true;
      return Math.round(fps);
    },
    rearm() {
      liveFrames = 0;
      fired = false;
    },
    get liveFrames() {
      return liveFrames;
    },
    get fired() {
      return fired;
    },
  };
}
