/**
 * Capability verdict (component-methods `checkCapabilities`, story-unsupported-notice). Pure: the
 * DOM probe in src/app/dom/env.ts gathers the raw facts and this module decides.
 */
import type { CapabilityVerdict } from '@sz/ui';

/** Narrowest supported viewport (req-unsupported-browser). */
export const MIN_WIDTH_PX = 1024;

/** Raw facts from the browser; every field may be missing or wrong, so each is checked. */
export interface EnvProbe {
  readonly webgl2: boolean;
  readonly pointerLock: boolean;
  /** matchMedia('(any-pointer: fine)').matches */
  readonly finePointer: boolean;
  readonly maxTouchPoints: number;
  readonly innerWidth: number;
}

export interface CapabilityResult extends CapabilityVerdict {
  /** True when SCR-E1 must be shown. */
  readonly blocked: boolean;
  /** Only when width is the only failed check (team rule: zoomed desktops). */
  readonly canContinue: boolean;
}

/**
 * A mouse is assumed when the browser reports a fine pointer, or reports no touch points at all
 * (some browsers answer any-pointer queries with false when no media list is supported).
 */
export function checkCapabilities(env: EnvProbe): CapabilityResult {
  const webgl2 = env.webgl2;
  const touchless = Number.isFinite(env.maxTouchPoints) && env.maxTouchPoints === 0;
  const pointer = env.pointerLock && (env.finePointer || touchless);
  const widthOk = Number.isFinite(env.innerWidth) && env.innerWidth >= MIN_WIDTH_PX;
  return Object.freeze({
    webgl2,
    pointer,
    widthOk,
    blocked: !(webgl2 && pointer && widthOk),
    canContinue: webgl2 && pointer && !widthOk,
  });
}
