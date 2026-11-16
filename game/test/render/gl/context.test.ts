// RD-R-1: WebGL2 only; a null context is a non-retryable PresentationBootFailure('webgl').
import { PresentationBootFailure } from '@sz/assets/core/errors';
import { CONTEXT_ATTRIBUTES, createWebGl2Context } from '@sz/render/gl/context';
import { describe, expect, it } from 'vitest';
import { createFakeRenderCanvas } from '../../support/fake-render-canvas';

describe('WebGL2 context', () => {
  it('throws PresentationBootFailure(webgl, null, false) when WebGL2 is missing', () => {
    const canvas = createFakeRenderCanvas(null);
    let caught: unknown;
    expect(() => {
      caught = undefined;
      createWebGl2Context(canvas);
    }).toThrow(PresentationBootFailure);
    expect(canvas.contextRequests).toBe(1);
    try {
      createWebGl2Context(canvas);
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ step: 'webgl', retryable: false, cause: null });
  });

  it('returns the context and asks only for webgl2 with the fixed attributes', () => {
    const fake = {} as WebGL2RenderingContext;
    expect(createWebGl2Context(createFakeRenderCanvas(fake))).toBe(fake);
    expect(CONTEXT_ATTRIBUTES).toMatchObject({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    expect(Object.isFrozen(CONTEXT_ATTRIBUTES)).toBe(true);
  });
});
