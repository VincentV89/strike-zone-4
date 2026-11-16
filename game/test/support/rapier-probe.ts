// Loads and initialises Rapier once per test file (NFR-WM-R6). Rapier suites use
// describe.skipIf(!rapierAvailable); rapier-available.test.ts fails unless the skip is
// explicitly allowed with SZ_ALLOW_RAPIER_SKIP=1.
import { initPhysics } from '@sz/physics';

let available = false;
let failure = '';
try {
  await initPhysics();
  available = true;
} catch (e) {
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : String(e);
  failure = `Rapier could not initialise in Node: ${cause}`;
}

export const rapierAvailable = available;
export const rapierFailure = failure;
export const RAPIER_SKIP_REASON = available ? '' : ` (SKIPPED: ${failure})`;
