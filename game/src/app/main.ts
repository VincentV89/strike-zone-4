// Placeholder entry (BR-K-58) so `vite build` and the infra synth hook work before
// app-shell exists. It proves the @sz alias resolves in the production build.
import { DEFAULT_MATCH_SETUP, STEP_HZ } from '@sz/kernel';

const status = document.querySelector('[data-testid="app-status"]');
if (status) {
  status.textContent = `Kernel ready: ${String(STEP_HZ)} Hz tick, default map ${DEFAULT_MATCH_SETUP.mapId}.`;
}
