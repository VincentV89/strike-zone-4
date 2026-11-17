// BR-WM-50, BR-WM-51, NFR-WM-R2. Deliberately does not import the Rapier probe, so the shared
// initialiser has not run when createPhysicsWorld is first called in this file.
import { describe, expect, it } from 'vitest';
import { BootError, createPhysicsWorld } from '@sz/physics';
import { createPhysicsInitializer, type Rapier } from '@sz/physics/rapier';
import { sceneMap } from '../support/physics-scenes';

describe('initPhysics', () => {
  it('BR-WM-51: createPhysicsWorld before init resolves throws', () => {
    expect(() => createPhysicsWorld(sceneMap([]))).toThrow(/before initPhysics/);
  });

  it('BR-WM-50: concurrent calls share one promise; the loader runs once', async () => {
    let calls = 0;
    const init = createPhysicsInitializer(() => {
      calls++;
      return Promise.resolve({} as Rapier);
    });
    const a = init.init();
    const b = init.init();
    expect(a).toBe(b);
    await a;
    await init.init();
    expect(calls).toBe(1);
    expect(init.get()).toBeDefined();
  });

  it('NFR-WM-R2: a failed init rejects with a retryable BootError and clears the promise', async () => {
    let calls = 0;
    const cause = new Error('wasm compile failed');
    const init = createPhysicsInitializer(() => {
      calls++;
      return calls === 1 ? Promise.reject(cause) : Promise.resolve({} as Rapier);
    });
    const first = await init.init().then(
      () => null,
      (e: unknown) => e,
    );
    expect(first).toBeInstanceOf(BootError);
    expect(first).toMatchObject({ step: 'physics', retryable: true, cause });
    expect(init.get()).toBeUndefined();
    await init.init();
    expect(calls).toBe(2);
    expect(init.get()).toBeDefined();
  });
});
