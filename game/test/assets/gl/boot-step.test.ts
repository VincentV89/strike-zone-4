// RD-R-2, story-loading-screen: a failed step rejects with a retryable PresentationBootFailure,
// and a retry reruns only that step.
import { createAssetFactory } from '@sz/assets';
import { PresentationBootFailure } from '@sz/assets/core/errors';
import { runStep } from '@sz/assets/gl/boot-step';
import type { AssetStepId } from '@sz/assets';
import { describe, expect, it } from 'vitest';

describe('runStep', () => {
  it('wraps a throw and a rejection, keeping the cause', async () => {
    const boom = new Error('boom');
    await expect(
      runStep('models', () => {
        throw boom;
      }),
    ).rejects.toMatchObject({ step: 'models', retryable: true, cause: boom });
    await expect(runStep('textures', () => Promise.reject(boom))).rejects.toBeInstanceOf(
      PresentationBootFailure,
    );
    await expect(runStep('warmup', () => undefined)).resolves.toBeUndefined();
  });
});

describe('asset factory steps', () => {
  it('has textures, models, warmup with loading-screen labels', () => {
    const f = createAssetFactory({ yieldToHost: () => Promise.resolve(), textureSize: 8 });
    expect(f.loadSteps().map((s) => [s.id, s.label])).toEqual([
      ['textures', 'Generating textures'],
      ['models', 'Building models'],
      ['warmup', 'Preparing renderer'],
    ]);
  });

  it('a failed models step retries alone; textures is not re-run', async () => {
    const calls: AssetStepId[] = [];
    let failModels = true;
    const f = createAssetFactory({
      yieldToHost: () => Promise.resolve(),
      textureSize: 8,
      beforeStep: (id) => {
        calls.push(id);
        if (id === 'models' && failModels) throw new Error('injected');
      },
    });
    const [textures, models] = f.loadSteps();
    if (textures === undefined || models === undefined) throw new Error('steps');
    const progress: number[] = [];
    await textures.run((p) => progress.push(p.done));
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7]);
    await expect(models.run()).rejects.toMatchObject({ step: 'models', retryable: true });
    expect(f.status('models')).toBe('failed');
    failModels = false;
    await textures.run();
    await models.run();
    expect(calls).toEqual(['textures', 'models', 'models']);
    expect(f.status('textures')).toBe('done');
    expect(f.status('models')).toBe('done');
    expect(f.material('sand')).toBeDefined();
    expect(f.material('__proto__' as never)).toBeUndefined();
    expect(f.viewmodel('sniper')).toBeDefined();
    expect(f.effectMaterial('muzzle')).toBeDefined();
    expect(f.partGeometry('torso')).toBeDefined();
    expect(f.allMaterials().length).toBe(7 + 4 + 2);
    f.setAnisotropy(4);
    f.setAnisotropy(Number.NaN);
    f.rebuildGpu();
    f.dispose();
    expect(f.material('sand')).toBeUndefined();
  });

  it('warmup without an attached renderer fails as a retryable step', async () => {
    const f = createAssetFactory({ yieldToHost: () => Promise.resolve(), textureSize: 8 });
    const warmup = f.loadSteps()[2];
    await expect(warmup?.run()).rejects.toMatchObject({ step: 'warmup', retryable: true });
    expect(f.status('warmup')).toBe('failed');
  });
});
