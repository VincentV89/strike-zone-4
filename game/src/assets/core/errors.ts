/**
 * Boot failure for presentation-3d (LC-A-3, RD-R-1, RD-R-2). Structurally an app-shell BootError
 * (step, cause, retryable), following the AudioBootFailure and physics BootError precedent.
 */
export type PresentationBootStep = 'webgl' | 'textures' | 'models' | 'warmup';

export class PresentationBootFailure extends Error {
  readonly step: PresentationBootStep;
  readonly retryable: boolean;
  override readonly cause: unknown;

  constructor(step: PresentationBootStep, cause: unknown, retryable: boolean) {
    super(`presentation boot step '${step}' failed`);
    this.name = 'PresentationBootFailure';
    this.step = step;
    this.retryable = retryable;
    this.cause = cause;
  }
}
