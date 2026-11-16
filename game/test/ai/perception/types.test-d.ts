// SEC-AI-01: type-level no-cheat fixtures. Checked by `tsc --noEmit` only (not a Vitest file).
// If a @ts-expect-error stops failing, the TargetSample brand or a brain input type was weakened.
import type { BotSelfView, BotWorldView } from '@sz/ai';
import { createTargetSample, type BotPercepts, type TargetSample } from '@sz/ai/perception';
import { PLAYER_ID, vec3 } from '@sz/kernel';

const sample = createTargetSample(PLAYER_ID, vec3(0, 0, 0), 1.62, true);

// @ts-expect-error a plain object is not a TargetSample (the brand is required)
export const forged: TargetSample = {
  id: PLAYER_ID,
  feet: vec3(0, 0, 0),
  eyeHeight: 1.62,
  alive: true,
};

// @ts-expect-error a TargetSample is not a BotSelfView
export const asSelf: BotSelfView = sample;

// @ts-expect-error BotPercepts has no player feet field at the top level
export const leak: BotPercepts = { feet: sample.feet };

// @ts-expect-error BotWorldView has no raycast on its sight port
export type Ray = BotWorldView['sight']['raycast'];

// @ts-expect-error BotWorldView has no budget reset
export type Reset = BotWorldView['budget']['resetTick'];

// @ts-expect-error BotWorldView has no reservation wipe
export type Wipe = BotWorldView['nav']['clearReservations'];

export const ok: TargetSample = sample;
