// NFR-WM-R6: Rapier must run in Node under Vitest. A skip is only allowed when it is an
// explicit, reported decision (SZ_ALLOW_RAPIER_SKIP=1).
import { expect, it } from 'vitest';
import { rapierAvailable, rapierFailure } from '../support/rapier-probe';

it('Rapier compat initialises in Node, or the skip is explicitly allowed', () => {
  const allowSkip = process.env.SZ_ALLOW_RAPIER_SKIP === '1';
  expect(rapierAvailable || allowSkip, rapierFailure).toBe(true);
});
