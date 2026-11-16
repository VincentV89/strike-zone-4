/**
 * Public asset-factory types (LC-G-1). render/gl imports these through `import type` from
 * @sz/assets (SD-R-1).
 */
import type { RigPart } from '@sz/assets/core/rig-parts';
import type { VisibleMaterialId } from '@sz/assets/core/palette';
import type { SpriteKind } from '@sz/assets/core/textures';
import type { WeaponId } from '@sz/kernel';
import type {
  BufferGeometry,
  Material,
  MeshBasicMaterial,
  MeshLambertMaterial,
  WebGLRenderer,
} from 'three';

export type AssetStepId = 'textures' | 'models' | 'warmup';
export type AssetStepStatus = 'pending' | 'done' | 'failed';

export interface AssetStepProgress {
  readonly done: number;
  readonly total: number;
}

export interface AssetStep {
  readonly id: AssetStepId;
  readonly label: string;
  /** Rejects with a retryable PresentationBootFailure; calling again retries only this step. */
  run(onProgress?: (p: AssetStepProgress) => void): Promise<void>;
}

export interface AssetFactoryDeps {
  /** app-shell: the next animation frame; tests: a resolved promise (PD-R-8). */
  readonly yieldToHost: () => Promise<void>;
  /** Texture tile size; 512 in the game. Tests may pass a smaller tile. */
  readonly textureSize?: number;
  /** Test seam: called at the start of every step run. A throw fails that step. */
  readonly beforeStep?: (id: AssetStepId) => void;
}

export interface AssetFactory {
  loadSteps(): ReadonlyArray<AssetStep>;
  status(id: AssetStepId): AssetStepStatus;
  /** Map material for a visible MaterialId; undefined for unknown ids or before `textures`. */
  material(id: VisibleMaterialId): MeshLambertMaterial | undefined;
  /** Shared bot material (white; colour comes per instance). */
  botMaterial(): MeshLambertMaterial | undefined;
  /** Unit box (1 m) used for every rig part. */
  partGeometry(part: RigPart): BufferGeometry | undefined;
  viewmodel(w: WeaponId): BufferGeometry | undefined;
  viewmodelMaterial(): MeshLambertMaterial | undefined;
  effectMaterial(kind: SpriteKind): MeshBasicMaterial | undefined;
  /** 1 × 1 quad facing +Z, for effects. */
  quadGeometry(): BufferGeometry | undefined;
  /** Every material the factory owns (warmup, shadow toggles). */
  allMaterials(): ReadonlyArray<Material>;
  setAnisotropy(n: number): void;
  /** Internal: the renderer hands over its WebGLRenderer for warmup and context restore. */
  attachRenderer(renderer: WebGLRenderer): void;
  /** Context restore: re-upload every texture from the retained CPU pixels (PD-R-8). */
  rebuildGpu(): void;
  /** Recompiles every program without yields (context restore). */
  warmup(): Promise<void>;
  dispose(): void;
}
