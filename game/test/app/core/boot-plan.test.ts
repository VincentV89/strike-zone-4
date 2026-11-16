import { describe, expect, it } from 'vitest';
import {
  BOOT_STEPS,
  createBootPlan,
  failedStep,
  isComplete,
  loadSteps,
  markDone,
  markFailed,
  markRunning,
  markSubDone,
  nextStep,
  retryPlan,
  type BootPlan,
} from '@sz/app/core/boot-plan';
import { BOOT_STEP_WEIGHTS } from '@sz/ui';

function finish(plan: BootPlan, id: Parameters<typeof markDone>[1]): BootPlan {
  return markDone(markRunning(plan, id), id);
}

describe('boot plan (PD-AS-11, BR-AS-01 to BR-AS-05)', () => {
  it('has the four steps in order with the ui weights', () => {
    expect(BOOT_STEPS.map((s) => s.id)).toEqual(['physics', 'graphics', 'sound', 'maps']);
    expect(BOOT_STEPS.map((s) => s.weight)).toEqual([...BOOT_STEP_WEIGHTS]);
    expect(createBootPlan().steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('runs steps one after another', () => {
    let p = createBootPlan();
    const order: string[] = [];
    for (let s = nextStep(p); s !== undefined; s = nextStep(p)) {
      order.push(s.id);
      p = finish(p, s.id);
    }
    expect(order).toEqual(['physics', 'graphics', 'sound', 'maps']);
    expect(isComplete(p)).toBe(true);
    expect(p.maxPct).toBe(100);
  });

  it('stops at a failed step and retries only that step (BR-AS-02)', () => {
    let p = finish(createBootPlan(), 'physics');
    p = markFailed(markRunning(p, 'graphics'), 'graphics');
    expect(nextStep(p)).toBeUndefined();
    expect(failedStep(p)?.id).toBe('graphics');
    p = retryPlan(p);
    expect(p.steps.find((s) => s.id === 'physics')?.status).toBe('done');
    expect(nextStep(p)?.id).toBe('graphics');
    expect(retryPlan(p)).toBe(p);
  });

  it('never starts a step whose prerequisite is not done (BR-AS-01)', () => {
    const plan = createBootPlan([
      { id: 'maps', label: 'Maps', weight: 1, requires: 'physics', subSteps: 1 },
      { id: 'physics', label: 'Physics', weight: 1, subSteps: 1 },
    ]);
    expect(nextStep(plan)).toBeUndefined();
  });

  it('counts finished sub-steps and never goes backwards (BR-AS-05)', () => {
    let p = finish(createBootPlan(), 'physics');
    expect(p.maxPct).toBe(10);
    p = markSubDone(markRunning(p, 'graphics'), 'graphics');
    expect(p.maxPct).toBe(20);
    p = markFailed(p, 'graphics');
    p = retryPlan(p);
    expect(p.maxPct).toBe(20);
    p = markSubDone(markSubDone(markSubDone(p, 'graphics'), 'graphics'), 'graphics');
    expect(p.steps.find((s) => s.id === 'graphics')?.subDone).toBe(3);
    expect(markSubDone(p, 'sound' as const).maxPct).toBeGreaterThanOrEqual(p.maxPct);
  });

  it('ignores unknown ids and non-positive weights', () => {
    const p = createBootPlan([{ id: 'sound', label: 'Sound', weight: -3, subSteps: 0 }]);
    expect(p.maxPct).toBe(0);
    expect(markSubDone(p, 'maps')).toBe(p);
    expect(isComplete(createBootPlan([]))).toBe(false);
  });

  it('exposes frozen rows for ui', () => {
    const rows = loadSteps(createBootPlan());
    expect(rows.map((r) => r.label)).toEqual(['Physics', 'Graphics', 'Sound', 'Maps']);
    expect(Object.isFrozen(rows)).toBe(true);
  });
});
