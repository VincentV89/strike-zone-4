// Sound bank synthesis and validation (BR-A-60 to BR-A-65, business-logic-model W1).
import { describe, expect, it } from 'vitest';
import {
  BANK_SAMPLE_RATE,
  BankValidationError,
  MAX_BANK_SAMPLES,
  clipSeed,
  synthesizeBank,
  validateBank,
  validateClip,
} from '@sz/audio/core/bank';
import { CUE_DEFINITIONS, CUE_TABLE } from '@sz/audio/core/cues';
import { RECIPES } from '@sz/audio/core/recipes';
import type { SoundBankPcm, SoundCue } from '@sz/audio/core/types';
import { fnv1a } from '../support/digest';

const noYield = () => Promise.resolve();

/** BR-A-61: literal per-clip digests (FNV-1a of the Float32 bytes). V8 only (Math.sin/exp). */
const DIGESTS: Record<SoundCue, string[]> = {
  'fire-rifle': ['fe9fb848', '341093ad', 'fd04f3d8'],
  'fire-pistol': ['0fd437f8', 'dcd9a31e', 'fc1d91f2'],
  'fire-sniper': ['dec18d14', 'b0dd22dd'],
  'dry-fire': ['6aa30be7'],
  'reload-start': ['6fafecbf'],
  'reload-end': ['d3709861'],
  'hit-body': ['8d8c78b0'],
  'hit-head': ['fd5a7914'],
  'enemy-death': ['70c39f5b'],
  'player-hurt': ['00ba8732', 'e8759bb0'],
  footstep: ['34636f71', 'f5151b2e', '98a8250c', 'adb42a69'],
  victory: ['88465fc2'],
  defeat: ['e396835c'],
  'ui-click': ['21c8fce2'],
};

let cached: SoundBankPcm | undefined;
async function bank(): Promise<SoundBankPcm> {
  cached ??= await synthesizeBank({ yieldFn: noYield });
  return cached;
}

describe('synthesizeBank', () => {
  it('BR-A-61: is bit-identical to the pinned digests', async () => {
    const b = await bank();
    const actual: Record<string, string[]> = {};
    for (const [cue, clips] of b.clips) actual[cue] = clips.map((c) => fnv1a(c.samples));
    expect(actual).toEqual(DIGESTS);
  });

  it('BR-A-61: a second run produces the same PCM', async () => {
    const again = await synthesizeBank({ yieldFn: noYield });
    const first = await bank();
    expect(fnv1a(again.clips.get('fire-rifle')?.[0]?.samples ?? new Float32Array())).toBe(
      fnv1a(first.clips.get('fire-rifle')?.[0]?.samples ?? new Float32Array(1)),
    );
  });

  it('holds 23 clips and 438 720 samples at 48 kHz, under the 12 s budget (BR-A-62, BR-A-64)', async () => {
    const b = await bank();
    const clips = [...b.clips.values()].flat();
    expect(clips).toHaveLength(23);
    expect(b.totalSamples).toBe(438_720);
    expect(b.totalSamples).toBeLessThanOrEqual(MAX_BANK_SAMPLES);
    expect(clips.every((c) => c.sampleRate === BANK_SAMPLE_RATE)).toBe(true);
  });

  it('BR-A-63: every clip passes validation', async () => {
    expect(validateBank(await bank())).toEqual([]);
  });

  it('BR-A-65: yields once per clip', async () => {
    let yields = 0;
    await synthesizeBank({
      yieldFn: () => {
        yields++;
        return Promise.resolve();
      },
    });
    expect(yields).toBe(23);
  });

  it('variants of the same cue differ', async () => {
    const rifles = (await bank()).clips.get('fire-rifle') ?? [];
    expect(new Set(rifles.map((c) => fnv1a(c.samples))).size).toBe(3);
  });

  it('BR-A-61: seeds follow BANK_SEED + 101 × cueIndex + variant', () => {
    expect(clipSeed(0, 0)).toBe(20261115);
    expect(clipSeed(2, 1)).toBe(20261115 + 203);
  });

  it('S9: a recipe producing NaN fails validation with BankValidationError', async () => {
    const broken = new Map(RECIPES);
    broken.set('hit-body', ({ n }) => new Float32Array(n).fill(Number.NaN));
    const run = synthesizeBank({ yieldFn: noYield, recipes: broken });
    await expect(run).rejects.toBeInstanceOf(BankValidationError);
    await expect(run).rejects.toMatchObject({ problems: ['hit-body#0: non-finite sample'] });
  });

  it('a missing recipe fails', async () => {
    const missing = new Map(RECIPES);
    missing.delete('defeat');
    await expect(synthesizeBank({ yieldFn: noYield, recipes: missing })).rejects.toThrow(
      'defeat: no recipe',
    );
  });
});

describe('validateClip / validateBank (BR-A-63, BR-A-64)', () => {
  const def = CUE_TABLE.get('ui-click');
  if (!def) throw new Error('ui-click missing');
  const n = Math.round(def.durationSec * BANK_SAMPLE_RATE);
  const good = (): Float32Array<ArrayBuffer> => {
    const x = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) x[i] = 0.5 * Math.sin(i / 3);
    return x;
  };

  it('accepts a well-formed clip', () => {
    expect(validateClip(def, { samples: good(), sampleRate: BANK_SAMPLE_RATE }, 'c')).toEqual([]);
  });

  it.each([
    ['wrong length', () => new Float32Array(n + 1), 'length'],
    ['silent', () => new Float32Array(n), 'peak'],
    [
      'too loud',
      () => {
        const x = good();
        x[5] = 0.99;
        return x;
      },
      'peak',
    ],
    [
      'unfaded edge',
      () => {
        const x = good();
        x[0] = 0.2;
        return x;
      },
      'edges',
    ],
    [
      'DC offset',
      () => {
        const x = good();
        for (let i = 1; i < n - 1; i++) x[i] = (x[i] ?? 0) * 0.1 + 0.05;
        return x;
      },
      'DC',
    ],
  ] as const)('rejects %s', (_label, make, word) => {
    const problems = validateClip(def, { samples: make(), sampleRate: BANK_SAMPLE_RATE }, 'c');
    expect(problems.join(' ')).toContain(word);
  });

  it('rejects a wrong sample rate', () => {
    expect(validateClip(def, { samples: good(), sampleRate: 44100 }, 'c')).toEqual([
      'c: sample rate',
    ]);
  });

  it('rejects missing variants, a wrong total and an over-budget bank', () => {
    const empty: SoundBankPcm = { sampleRate: BANK_SAMPLE_RATE, clips: new Map(), totalSamples: 1 };
    const problems = validateBank(empty);
    expect(problems).toHaveLength(CUE_DEFINITIONS.length + 1);
    expect(problems).toContain('totalSamples mismatch');

    const huge = new Float32Array(MAX_BANK_SAMPLES + 1);
    const over: SoundBankPcm = {
      sampleRate: BANK_SAMPLE_RATE,
      clips: new Map([['ui-click', [{ samples: huge, sampleRate: BANK_SAMPLE_RATE }]]]),
      totalSamples: huge.length,
    };
    expect(validateBank(over).some((p) => p.startsWith('bank too long'))).toBe(true);
  });
});
