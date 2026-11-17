// Public surface of diagnostics (`@sz/diagnostics`). Re-exports only; only app-shell imports it.
export { ADVISORY_RULES, createAdvisoryRule } from '@sz/diagnostics/core/advisory';
export type { AdvisoryInput, AdvisoryRule } from '@sz/diagnostics/core/advisory';
export { createFrameProbe } from '@sz/diagnostics/core/probe';
export type { FrameProbe, FrameStats } from '@sz/diagnostics/core/probe';
export {
  MAX_INJECT_TICKS,
  MAX_SEED,
  parseSeed,
  parseTicks,
  sanitizeInjectedIntent,
} from '@sz/diagnostics/core/inject';
export type { InjectedIntent } from '@sz/diagnostics/core/inject';
export { HOOK_PROPERTY, createTestHook, installTestHook } from './dom/hook';
export type { HookDeps, HookResult, TestHook } from './dom/hook';
