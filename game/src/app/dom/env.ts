/**
 * Environment probe (business-logic-model boot step 1). Gathers raw facts for the pure
 * checkCapabilities. The WebGL 2 probe uses a throwaway canvas whose context is released at once.
 */
import type { EnvProbe } from '@sz/app/core/capabilities';

export function probeEnvironment(win: Window): EnvProbe {
  const probe = win.document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  const media = typeof win.matchMedia === 'function' ? win.matchMedia('(any-pointer: fine)') : null;
  return {
    webgl2: gl !== null,
    pointerLock:
      'pointerLockElement' in win.document && typeof probe.requestPointerLock === 'function',
    finePointer: media?.matches === true,
    maxTouchPoints: win.navigator.maxTouchPoints,
    innerWidth: win.innerWidth,
  };
}
