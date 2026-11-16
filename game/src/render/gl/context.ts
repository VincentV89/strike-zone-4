/**
 * WebGL2 context creation (RD-R-1, ADR-R-11). WebGL2 only: a null context throws a
 * non-retryable PresentationBootFailure('webgl'), which app-shell maps to SCR-E1. The context is
 * handed to WebGLRenderer, so Three never probes WebGL1. Antialias is fixed at creation.
 */
import { PresentationBootFailure } from '@sz/assets/core/errors';
import type { RenderCanvas } from './ports';

export const CONTEXT_ATTRIBUTES: WebGLContextAttributes = Object.freeze({
  alpha: false,
  antialias: true,
  depth: true,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
});

export function createWebGl2Context(canvas: RenderCanvas): WebGL2RenderingContext {
  const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
  if (gl === null) throw new PresentationBootFailure('webgl', null, false);
  return gl;
}
