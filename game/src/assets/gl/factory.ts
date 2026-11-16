/**
 * createAssetFactory (LC-G-1, business-logic-model "Boot workflow"). Three retryable steps:
 * textures, models, warmup. Every asset comes from code (req-procedural-assets); nothing is
 * fetched and no URL loader exists (BR-R-02). Finished steps keep their results, so a retry
 * reruns only the failed step (RD-R-2). Lookups are Map-based (SD-R-3).
 */
import { buildBoxes } from '@sz/assets/core/box-mesh';
import { PresentationBootFailure } from '@sz/assets/core/errors';
import { MATERIAL_PALETTE, type VisibleMaterialId } from '@sz/assets/core/palette';
import { RIG_PARTS, type RigPart } from '@sz/assets/core/rig-parts';
import {
  SPRITE_KINDS,
  SPRITE_SIZE,
  TEXTURE_SIZE,
  generateSpritePixels,
  generateTextureSet,
  type SpriteKind,
} from '@sz/assets/core/textures';
import { VIEWMODELS } from '@sz/assets/core/viewmodel-parts';
import { vec3, type WeaponId } from '@sz/kernel';
import {
  MeshLambertMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type DataTexture,
  type Material,
  type MeshBasicMaterial,
  type WebGLRenderer,
} from 'three';
import { runStep } from './boot-step';
import { effectMaterialFor, geometryFrom, spriteTexture, tileTexture } from './materials';
import type {
  AssetFactory,
  AssetFactoryDeps,
  AssetStep,
  AssetStepId,
  AssetStepProgress,
  AssetStepStatus,
} from './types';
import { warmupPrograms } from './warmup';

const LABELS: ReadonlyMap<AssetStepId, string> = new Map<AssetStepId, string>([
  ['textures', 'Generating textures'],
  ['models', 'Building models'],
  ['warmup', 'Preparing renderer'],
]);

export function createAssetFactory(deps: AssetFactoryDeps): AssetFactory {
  const size =
    deps.textureSize !== undefined && Number.isInteger(deps.textureSize) && deps.textureSize >= 4
      ? deps.textureSize
      : TEXTURE_SIZE;
  const status = new Map<AssetStepId, AssetStepStatus>([
    ['textures', 'pending'],
    ['models', 'pending'],
    ['warmup', 'pending'],
  ]);
  const textures = new Map<VisibleMaterialId, DataTexture>();
  const materials = new Map<VisibleMaterialId, MeshLambertMaterial>();
  const sprites = new Map<SpriteKind, DataTexture>();
  const effectMaterials = new Map<SpriteKind, MeshBasicMaterial>();
  const viewmodels = new Map<WeaponId, BufferGeometry>();
  let partBox: BufferGeometry | undefined;
  let quad: BufferGeometry | undefined;
  let botMat: MeshLambertMaterial | undefined;
  let vmMat: MeshLambertMaterial | undefined;
  let renderer: WebGLRenderer | undefined;
  let anisotropy = 1;

  async function texturesStep(onProgress?: (p: AssetStepProgress) => void): Promise<void> {
    const pixels = await generateTextureSet(deps.yieldToHost, (p) => onProgress?.(p), size);
    for (const row of MATERIAL_PALETTE) {
      const px = pixels.get(row.id);
      if (px === undefined) continue;
      const tex = tileTexture(px, size);
      tex.anisotropy = anisotropy;
      textures.set(row.id, tex);
      materials.set(row.id, new MeshLambertMaterial({ map: tex }));
    }
  }

  async function modelsStep(onProgress?: (p: AssetStepProgress) => void): Promise<void> {
    partBox = geometryFrom(
      buildBoxes([{ center: vec3(0, 0, 0), half: vec3(0.5, 0.5, 0.5), yaw: 0, pitch: 0 }]),
    );
    quad = new PlaneGeometry(1, 1);
    botMat = new MeshLambertMaterial({ color: 0xffffff });
    vmMat = new MeshLambertMaterial({ vertexColors: true });
    let done = 0;
    const total = VIEWMODELS.size + SPRITE_KINDS.length;
    for (const [weapon, spec] of VIEWMODELS) {
      viewmodels.set(weapon, geometryFrom(buildBoxes(spec.boxes, { withColor: true })));
      onProgress?.({ done: ++done, total });
    }
    for (const kind of SPRITE_KINDS) {
      await deps.yieldToHost();
      const tex = spriteTexture(generateSpritePixels(kind), SPRITE_SIZE);
      sprites.set(kind, tex);
      effectMaterials.set(kind, effectMaterialFor(kind, tex));
      onProgress?.({ done: ++done, total });
    }
  }

  function allMaterials(): Material[] {
    const out: Material[] = [...materials.values(), ...effectMaterials.values()];
    if (botMat !== undefined) out.push(botMat);
    if (vmMat !== undefined) out.push(vmMat);
    return out;
  }

  async function warmupStep(): Promise<void> {
    if (renderer === undefined || partBox === undefined || botMat === undefined) {
      throw new Error('warmup needs the renderer and the models step');
    }
    const world: Material[] = [...materials.values()];
    if (vmMat !== undefined) world.push(vmMat);
    await warmupPrograms(renderer, {
      worldMaterials: world,
      instancedMaterials: [botMat, ...effectMaterials.values()],
      geometry: partBox,
    });
  }

  const runners: ReadonlyMap<AssetStepId, (p?: (x: AssetStepProgress) => void) => Promise<void>> =
    new Map<AssetStepId, (p?: (x: AssetStepProgress) => void) => Promise<void>>([
      ['textures', texturesStep],
      ['models', modelsStep],
      ['warmup', warmupStep],
    ]);

  function makeStep(id: AssetStepId): AssetStep {
    return {
      id,
      label: LABELS.get(id) ?? id,
      run(onProgress) {
        if (status.get(id) === 'done') return Promise.resolve();
        return runStep(id, async () => {
          deps.beforeStep?.(id);
          const fn = runners.get(id);
          if (fn !== undefined) await fn(onProgress);
        }).then(
          () => {
            status.set(id, 'done');
          },
          (e: unknown) => {
            status.set(id, 'failed');
            throw e instanceof PresentationBootFailure
              ? e
              : new PresentationBootFailure(id, e, true);
          },
        );
      },
    };
  }

  const steps: ReadonlyArray<AssetStep> = Object.freeze([
    makeStep('textures'),
    makeStep('models'),
    makeStep('warmup'),
  ]);

  return {
    loadSteps: () => steps,
    status: (id) => status.get(id) ?? 'pending',
    material: (id) => materials.get(id),
    botMaterial: () => botMat,
    partGeometry: (part: RigPart) => (RIG_PARTS.some((p) => p.part === part) ? partBox : undefined),
    viewmodel: (w) => viewmodels.get(w),
    viewmodelMaterial: () => vmMat,
    effectMaterial: (kind) => effectMaterials.get(kind),
    quadGeometry: () => quad,
    allMaterials,
    setAnisotropy(n) {
      if (!Number.isFinite(n) || n < 1) return;
      anisotropy = Math.floor(n);
      for (const tex of textures.values()) {
        tex.anisotropy = anisotropy;
        tex.needsUpdate = true;
      }
    },
    attachRenderer(r) {
      renderer = r;
    },
    rebuildGpu() {
      for (const tex of textures.values()) tex.needsUpdate = true;
      for (const tex of sprites.values()) tex.needsUpdate = true;
    },
    warmup: () => warmupStep(),
    dispose() {
      for (const tex of textures.values()) tex.dispose();
      for (const tex of sprites.values()) tex.dispose();
      for (const m of allMaterials()) m.dispose();
      for (const g of viewmodels.values()) g.dispose();
      partBox?.dispose();
      quad?.dispose();
      textures.clear();
      materials.clear();
      sprites.clear();
      effectMaterials.clear();
      viewmodels.clear();
      renderer = undefined;
    },
  };
}
