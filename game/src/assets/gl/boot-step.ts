/**
 * The only error conversion in render and assets (RD-R-2, RD-R-5): a step's rejection or throw is
 * wrapped in a retryable PresentationBootFailure carrying the cause. Nothing is swallowed.
 */
import { PresentationBootFailure, type PresentationBootStep } from '@sz/assets/core/errors';

export function runStep(id: PresentationBootStep, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .catch((cause: unknown) => {
      throw new PresentationBootFailure(id, cause, true);
    });
}
