/**
 * DIFFICULTY_TABLE (req-difficulty, Q6 values; burstShots and turnRateRad are design values,
 * FD-AI-A6). Health is not here: difficulty never changes vitals (BR-AI-32).
 */
import { degToRad, isDifficulty, type Difficulty } from '@sz/kernel';
import type { DifficultyParams } from './types';

const row = (p: DifficultyParams): DifficultyParams => {
  const burst: readonly [number, number] = Object.freeze([p.burstShots[0], p.burstShots[1]]);
  return Object.freeze({ ...p, burstShots: burst });
};

export const DIFFICULTY_TABLE: Readonly<Record<Difficulty, DifficultyParams>> = Object.freeze({
  easy: row({
    reactionMinSec: 0.7,
    reactionMaxSec: 0.9,
    aimErrorRad: degToRad(6),
    burstPauseSec: 1.2,
    coverChance: 0.25,
    flankChance: 0.05,
    visionRangeM: 35,
    burstShots: [2, 3],
    turnRateRad: degToRad(240),
  }),
  normal: row({
    reactionMinSec: 0.4,
    reactionMaxSec: 0.55,
    aimErrorRad: degToRad(3.5),
    burstPauseSec: 0.7,
    coverChance: 0.55,
    flankChance: 0.25,
    visionRangeM: 45,
    burstShots: [3, 4],
    turnRateRad: degToRad(360),
  }),
  hard: row({
    reactionMinSec: 0.2,
    reactionMaxSec: 0.3,
    aimErrorRad: degToRad(1.8),
    burstPauseSec: 0.4,
    coverChance: 0.85,
    flankChance: 0.5,
    visionRangeM: 55,
    burstShots: [3, 5],
    turnRateRad: degToRad(480),
  }),
});

/** Only 'easy' | 'normal' | 'hard' resolve; anything else is Normal (BR-AI-34). */
export function difficultyParams(d: unknown): DifficultyParams {
  return isDifficulty(d) && Object.hasOwn(DIFFICULTY_TABLE, d)
    ? DIFFICULTY_TABLE[d]
    : DIFFICULTY_TABLE.normal;
}
