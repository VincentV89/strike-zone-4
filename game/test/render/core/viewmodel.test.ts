// BR-R-13: kick, reload, draw, switch cancels reload, bob and reduced motion.
import {
  BOB_AMPLITUDE_M,
  DRAW_DROP_M,
  RELOAD_DIP_M,
  RELOAD_ROLL_RAD,
  createViewmodelPose,
  createViewmodelState,
  vmFire,
  vmPose,
  vmReload,
  vmStep,
  vmSwitch,
} from '@sz/render/core/viewmodel';
import { describe, expect, it } from 'vitest';

describe('viewmodel animation', () => {
  it('kick springs back toward rest (most of it gone by 150 ms, settled by 400 ms) and flashes for 50 ms', () => {
    const s = createViewmodelState();
    vmFire(s, 0, 0.01);
    const pose = createViewmodelPose();
    expect(vmPose(s, 0, 0, false, pose).flash).toBe(true);
    expect(vmPose(s, 0.06, 0, false, pose).flash).toBe(false);
    expect(s.kick).toBeCloseTo(0.04, 9);
    for (let i = 0; i < 9; i++) vmStep(s, 1 / 60, 0, false);
    expect(Math.abs(s.kick)).toBeLessThan(0.04 * 0.25);
    for (let i = 0; i < 15; i++) vmStep(s, 1 / 60, 0, false);
    expect(Math.abs(s.kick)).toBeLessThan(0.04 * 0.02);
    vmFire(s, 1, Number.NaN);
    expect(Number.isFinite(s.kick)).toBe(true);
  });

  it('reload dips and rolls over durationSec, then returns', () => {
    const s = createViewmodelState();
    vmReload(s, 0, 2);
    const pose = createViewmodelPose();
    vmPose(s, 1, 0, false, pose);
    expect(pose.y).toBeCloseTo(-RELOAD_DIP_M, 9);
    expect(pose.roll).toBeCloseTo(RELOAD_ROLL_RAD, 9);
    vmPose(s, 2.1, 0, false, pose);
    expect(pose.y).toBe(0);
    expect(s.reloadStart).toBe(-1);
    vmReload(s, 3, -1);
    expect(s.reloadStart).toBe(-1);
  });

  it('reduced motion keeps the dip but drops the roll and the bob', () => {
    const s = createViewmodelState();
    vmReload(s, 0, 2);
    const pose = vmPose(s, 1, 6, true, createViewmodelPose());
    expect(pose.y).toBeCloseTo(-RELOAD_DIP_M, 9);
    expect(pose.roll).toBe(0);
    vmStep(s, 0.5, 6, true);
    expect(s.bobPhase).toBe(0);
  });

  it('a switch swaps the model, cancels the reload and rises over drawSec', () => {
    const s = createViewmodelState('rifle');
    vmReload(s, 0, 2);
    vmSwitch(s, 'pistol', 0.5, 0.5);
    expect(s.weapon).toBe('pistol');
    expect(s.reloadStart).toBe(-1);
    const pose = vmPose(s, 0.5, 0, false, createViewmodelPose());
    expect(pose.y).toBeCloseTo(-DRAW_DROP_M, 9);
    expect(pose.weapon).toBe('pistol');
    vmPose(s, 1.01, 0, false, pose);
    expect(pose.y).toBe(0);
    vmSwitch(s, 'rifle', 2, Number.NaN);
    vmPose(s, 2, 0, false, pose);
    expect(s.drawStart).toBe(-1);
  });

  it('bob scales with speed up to 1.5× and does not move while paused (dt 0)', () => {
    const s = createViewmodelState();
    vmStep(s, 0, 5, false);
    expect(s.bobPhase).toBe(0);
    s.bobPhase = Math.PI / 2;
    const pose = vmPose(s, 0, 100, false, createViewmodelPose());
    expect(pose.y).toBeCloseTo(BOB_AMPLITUDE_M * 1.5, 9);
  });
});
