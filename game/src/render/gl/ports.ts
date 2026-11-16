/**
 * The only canvas members render may use (SD-R-1, LC-G-4). app-shell passes the real canvas;
 * tests pass test/support/fake-render-canvas.ts.
 */
import type { AssetFactory } from '@sz/assets';

export type ContextEventType = 'webglcontextlost' | 'webglcontextrestored';

export interface RenderCanvas {
  readonly clientWidth: number;
  readonly clientHeight: number;
  getContext(kind: 'webgl2', options: WebGLContextAttributes): WebGL2RenderingContext | null;
  addEventListener(type: ContextEventType, fn: (e: Event) => void): void;
  removeEventListener(type: ContextEventType, fn: (e: Event) => void): void;
}

export interface RendererOptions {
  readonly canvas: RenderCanvas;
  readonly assets: AssetFactory;
  /** app-shell passes () => window.devicePixelRatio. */
  readonly devicePixelRatio: () => number;
  readonly onContextLost: () => void;
  readonly onContextRestored: () => void;
}
