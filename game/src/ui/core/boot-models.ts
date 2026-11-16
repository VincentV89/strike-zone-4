/**
 * Boot-time screen models (business-logic-model-ui-hud §10): loading (SCR-01 A/B), boot error
 * (SCR-E2), map loading and the unsupported-environment notice (SCR-E1).
 */

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface LoadStep {
  readonly label: string;
  readonly weight: number;
  readonly status: StepStatus;
}

/** Boot step weights (physics, assets, audio bank, maps/nav). */
export const BOOT_STEP_WEIGHTS: ReadonlyArray<number> = Object.freeze([10, 30, 40, 20]);

export interface LoadingModel {
  readonly id: 'loading';
  /** Integer 0..100. */
  readonly pct: number;
  readonly currentLabel: string;
  /** "Click to enter" stays aria-disabled until every step is done (req-loading-screen AC2). */
  readonly ready: boolean;
}

const weightOf = (s: LoadStep) => (Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 0);

export function loadingPct(steps: ReadonlyArray<LoadStep>): number {
  const total = steps.reduce((sum, s) => sum + weightOf(s), 0);
  if (total <= 0) return 0;
  const done = steps.reduce((sum, s) => sum + (s.status === 'done' ? weightOf(s) : 0), 0);
  return Math.floor((100 * done) / total);
}

export function toLoadingModel(steps: ReadonlyArray<LoadStep>): LoadingModel {
  const ready = steps.length > 0 && steps.every((s) => s.status === 'done');
  const current = steps.find((s) => s.status !== 'done');
  return Object.freeze({
    id: 'loading',
    pct: loadingPct(steps),
    currentLabel: ready ? 'Ready' : (current?.label ?? 'Loading'),
    ready,
  });
}

export interface BootErrorModel {
  readonly id: 'boot-error';
  readonly message: string;
  readonly retryable: boolean;
}

export function toBootErrorModel(stepLabel: string, retryable: boolean): BootErrorModel {
  return Object.freeze({
    id: 'boot-error',
    message: `${stepLabel} failed to load.${retryable ? ' Retry keeps the steps that finished.' : ' Reload the page to try again.'}`,
    retryable,
  });
}

export interface MapLoadingModel {
  readonly id: 'map-loading';
  readonly mapName: string;
  readonly pct: number;
}

export function toMapLoadingModel(name: string, steps: ReadonlyArray<LoadStep>): MapLoadingModel {
  return Object.freeze({ id: 'map-loading', mapName: name, pct: loadingPct(steps) });
}

export interface CapabilityVerdict {
  readonly webgl2: boolean;
  readonly pointer: boolean;
  readonly widthOk: boolean;
}

export interface UnsupportedModel {
  readonly id: 'unsupported';
  readonly reasons: ReadonlyArray<string>;
  /** Only when width is the only failed check (team rule: zoomed desktops). */
  readonly canContinue: boolean;
}

export function toUnsupportedModel(v: CapabilityVerdict): UnsupportedModel {
  const reasons: string[] = [];
  if (!v.webgl2) reasons.push('WebGL 2 is required.');
  if (!v.pointer) reasons.push('A mouse and keyboard are required.');
  if (!v.widthOk) reasons.push('The window must be at least 1024 px wide.');
  return Object.freeze({
    id: 'unsupported',
    reasons: Object.freeze(reasons),
    canContinue: v.webgl2 && v.pointer && !v.widthOk,
  });
}
