/**
 * Saturating counter addition (SD-ML-6, SEC-ML-23). Every stats counter and sum goes through it,
 * so a non-finite, negative or fractional increment is ignored instead of turning a total into NaN.
 */
export function addSat(a: number, b: number): number {
  if (!Number.isSafeInteger(b) || b < 0) return a;
  return Math.min(a + b, Number.MAX_SAFE_INTEGER);
}
