/**
 * Boot plan (PD-AS-11, BR-AS-01 to BR-AS-05). A pure, immutable description of the loading steps.
 * The DOM runner in src/app/dom/boot.ts executes the step `nextStep` names and reports back.
 */
import { BOOT_STEP_WEIGHTS, type LoadStep, type StepStatus } from '@sz/ui';

export type BootStepId = 'physics' | 'graphics' | 'sound' | 'maps';

export interface BootStepDef {
  readonly id: BootStepId;
  readonly label: string;
  readonly weight: number;
  /** A step whose prerequisite is not done is never started (BR-AS-01). */
  readonly requires?: BootStepId;
  /** Sub-steps reported inside the step (Graphics: textures, models, warmup). */
  readonly subSteps: number;
}

const weight = (i: number): number => BOOT_STEP_WEIGHTS[i] ?? 0;

/** Weights match BOOT_STEP_WEIGHTS in @sz/ui (10, 30, 40, 20). */
export const BOOT_STEPS: ReadonlyArray<BootStepDef> = Object.freeze([
  Object.freeze({ id: 'physics', label: 'Physics', weight: weight(0), subSteps: 1 }),
  Object.freeze({ id: 'graphics', label: 'Graphics', weight: weight(1), subSteps: 3 }),
  Object.freeze({ id: 'sound', label: 'Sound', weight: weight(2), subSteps: 1 }),
  Object.freeze({
    id: 'maps',
    label: 'Maps',
    weight: weight(3),
    requires: 'physics',
    subSteps: 1,
  }),
]);

export interface PlanStep extends LoadStep {
  readonly id: BootStepId;
  readonly requires: BootStepId | undefined;
  readonly subDone: number;
  readonly subTotal: number;
}

export interface BootPlan {
  readonly steps: ReadonlyArray<PlanStep>;
  /** Highest progress shown so far; the bar never goes backwards (BR-AS-05). */
  readonly maxPct: number;
}

export function createBootPlan(defs: ReadonlyArray<BootStepDef> = BOOT_STEPS): BootPlan {
  return freezePlan(
    defs.map((d) => ({
      id: d.id,
      label: d.label,
      weight: d.weight,
      status: 'pending',
      requires: d.requires,
      subDone: 0,
      subTotal: Math.max(1, Math.floor(d.subSteps)),
    })),
    0,
  );
}

function freezePlan(steps: PlanStep[], prevMax: number): BootPlan {
  const frozen = Object.freeze(steps.map((s) => Object.freeze(s)));
  return Object.freeze({ steps: frozen, maxPct: Math.max(prevMax, rawPct(frozen)) });
}

/** Weighted progress including finished sub-steps of the running step, floored to an integer. */
function rawPct(steps: ReadonlyArray<PlanStep>): number {
  let total = 0;
  let done = 0;
  for (const s of steps) {
    const w = Number.isFinite(s.weight) && s.weight > 0 ? s.weight : 0;
    total += w;
    if (s.status === 'done') done += w;
    else done += (w * Math.min(s.subDone, s.subTotal)) / s.subTotal;
  }
  return total > 0 ? Math.floor((100 * done) / total) : 0;
}

function update(plan: BootPlan, id: BootStepId, patch: Partial<PlanStep>): BootPlan {
  return freezePlan(
    plan.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    plan.maxPct,
  );
}

const statusOf = (plan: BootPlan, id: BootStepId): StepStatus | undefined =>
  plan.steps.find((s) => s.id === id)?.status;

/**
 * The step to run now: the first one not done. Undefined when every step is done, when a step
 * has failed (the player must press Retry), or when the next step's prerequisite is not done.
 */
export function nextStep(plan: BootPlan): PlanStep | undefined {
  if (failedStep(plan) !== undefined) return undefined;
  const step = plan.steps.find((s) => s.status !== 'done');
  if (step === undefined) return undefined;
  if (step.requires !== undefined && statusOf(plan, step.requires) !== 'done') return undefined;
  return step;
}

export const markRunning = (plan: BootPlan, id: BootStepId): BootPlan =>
  update(plan, id, { status: 'running' });

export function markSubDone(plan: BootPlan, id: BootStepId): BootPlan {
  const s = plan.steps.find((x) => x.id === id);
  if (s === undefined) return plan;
  return update(plan, id, { subDone: Math.min(s.subTotal, s.subDone + 1) });
}

export const markDone = (plan: BootPlan, id: BootStepId): BootPlan =>
  update(plan, id, { status: 'done' });

export const markFailed = (plan: BootPlan, id: BootStepId): BootPlan =>
  update(plan, id, { status: 'failed' });

export function failedStep(plan: BootPlan): PlanStep | undefined {
  return plan.steps.find((s) => s.status === 'failed');
}

/** Retry (BR-AS-02): only the failed step goes back to pending; done steps are never rerun. */
export function retryPlan(plan: BootPlan): BootPlan {
  const failed = failedStep(plan);
  return failed === undefined ? plan : update(plan, failed.id, { status: 'pending' });
}

export function isComplete(plan: BootPlan): boolean {
  return plan.steps.length > 0 && plan.steps.every((s) => s.status === 'done');
}

/** The rows ui renders (LoadStep is structurally a subset of PlanStep). */
export function loadSteps(plan: BootPlan): ReadonlyArray<LoadStep> {
  return plan.steps;
}
