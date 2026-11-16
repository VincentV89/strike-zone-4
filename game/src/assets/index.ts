// Public surface of asset-factory (`@sz/assets`). Re-exports only.
export { createAssetFactory } from './gl/factory';
export type {
  AssetFactory,
  AssetFactoryDeps,
  AssetStep,
  AssetStepId,
  AssetStepProgress,
  AssetStepStatus,
} from './gl/types';
export { PresentationBootFailure } from './core/errors';
export type { PresentationBootStep } from './core/errors';
export type { VisibleMaterialId } from './core/palette';
export type { RigPart } from './core/rig-parts';
export type { SpriteKind } from './core/textures';
