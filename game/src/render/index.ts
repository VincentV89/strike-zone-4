// Public surface of renderer (`@sz/render`). Re-exports only.
export { createRenderer } from './gl/renderer';
export type { Renderer, RendererStats } from './gl/renderer';
export type { RenderCanvas, RendererOptions } from './gl/ports';
export type { PresetId, RenderFrame, RenderSettings } from './core/types';
export { DEFAULT_SETTINGS } from './core/types';
export { PRESET_IDS } from './core/presets';
