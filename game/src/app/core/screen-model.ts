/**
 * AppState → ScreenModel (FD-AS-5). The machine picks the screen; this module builds the model
 * with ui's pure builders so the whole mapping is testable in Node.
 */
import type { MatchSetup } from '@sz/kernel';
import type { MapSummary } from '@sz/maps';
import type { HistoryEntry, Settings, StorageStatus } from '@sz/persistence';
import type { RoundView } from '@sz/round';
import type { SessionTotals } from '@sz/stats';
import {
  CONTROLS_TABLE,
  toAboutModel,
  toBootErrorModel,
  toCapturePrompt,
  toEndModel,
  toHistoryModel,
  toLoadingModel,
  toMainMenuModel,
  toMapLoadingModel,
  toPauseModel,
  toSettingsModel,
  toSetupPanel,
  toUnsupportedModel,
  type BootErrorModel,
  type CapabilityVerdict,
  type KilledBy,
  type LoadStep,
  type ScreenModel,
} from '@sz/ui';
import type { AppState } from './machine';

export const CONTEXT_LOST_MESSAGE =
  'Graphics were reset. Restoring… If this stays, reload the page.';
export const FATAL_MESSAGE = 'Something went wrong. Reload the page.';
export const ROUND_SETUP_MESSAGE = 'Round setup failed. Retry starts the round again.';

export interface ScreenData {
  readonly steps: ReadonlyArray<LoadStep>;
  /** Monotonic boot progress (BR-AS-05). */
  readonly pct: number;
  readonly verdict: CapabilityVerdict;
  readonly settings: Settings;
  readonly setup: MatchSetup;
  readonly maps: ReadonlyArray<MapSummary>;
  readonly storage: StorageStatus;
  readonly view: RoundView;
  /** 1 for the first round of this page load. */
  readonly roundIndex: number;
  readonly aliveBots: number;
  readonly record: SessionTotals;
  readonly advisory: { readonly fps: number } | undefined;
  readonly history: ReadonlyArray<HistoryEntry>;
  readonly formatDate: (epochMs: number) => string;
  readonly version: string;
  readonly killedBy: KilledBy | undefined;
}

const message = (text: string, retryable: boolean): BootErrorModel =>
  Object.freeze({ id: 'boot-error', message: text, retryable });

function mapNameOf(d: ScreenData, setup: MatchSetup): string {
  return d.maps.find((m) => m.id === setup.mapId)?.name ?? setup.mapId;
}

function dialogModel(s: AppState, d: ScreenData): ScreenModel | undefined {
  switch (s.dialog) {
    case 'settings':
      return toSettingsModel(d.settings, s.settingsFrom, s.confirmReset);
    case 'controls':
      return Object.freeze({ id: 'controls', rows: CONTROLS_TABLE });
    case 'about':
      return toAboutModel(d.version);
    case 'history':
      return toHistoryModel(d.history, d.record, s.confirmClear, d.formatDate);
    case undefined:
      return undefined;
  }
}

function loadingModel(d: ScreenData): ScreenModel {
  const base = toLoadingModel(d.steps);
  return Object.freeze({ ...base, pct: base.ready ? 100 : Math.max(base.pct, d.pct) });
}

function errorModel(s: AppState): ScreenModel {
  const e = s.error;
  if (e === undefined) return message(FATAL_MESSAGE, false);
  return e.kind === 'boot'
    ? toBootErrorModel(e.label, e.retryable)
    : message(ROUND_SETUP_MESSAGE, e.retryable);
}

function roundModel(s: AppState, d: ScreenData): ScreenModel {
  const setup = d.view.setup ?? d.setup;
  switch (s.screen) {
    case 'map-loading':
      return toMapLoadingModel(mapNameOf(d, setup), [
        { label: 'Map', weight: 1, status: 'running' },
      ]);
    case 'capture':
      return toCapturePrompt(d.roundIndex, setup.mapId, s.captureRefused, mapNameOf(d, setup));
    case 'pause':
      return toPauseModel({
        view: d.view,
        roundIndex: d.roundIndex,
        aliveBots: d.aliveBots,
        record: d.record,
        advisory: d.advisory,
        graphics: d.settings.graphics,
        confirm: s.confirm,
      });
    case 'end':
      return d.view.summary
        ? toEndModel(d.view.summary, d.killedBy)
        : toMainMenuModel(toSetupPanel(d.setup, d.settings, d.maps), d.storage);
    default:
      return Object.freeze({ id: 'hud' });
  }
}

export function toScreenModel(s: AppState, d: ScreenData): ScreenModel {
  const dialog = s.screen === 'main-menu' || s.screen === 'pause' ? dialogModel(s, d) : undefined;
  if (dialog !== undefined) return dialog;
  switch (s.screen) {
    case 'loading':
      return loadingModel(d);
    case 'unsupported':
      return toUnsupportedModel(d.verdict);
    case 'boot-error':
      return errorModel(s);
    case 'main-menu':
      return toMainMenuModel(toSetupPanel(d.setup, d.settings, d.maps), d.storage);
    case 'context-lost':
      return message(CONTEXT_LOST_MESSAGE, false);
    case 'fatal':
      return message(FATAL_MESSAGE, false);
    default:
      return roundModel(s, d);
  }
}
