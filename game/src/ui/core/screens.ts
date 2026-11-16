/**
 * ScreenModel union (business-logic-model-ui-hud §4.3). app-shell's ScreenMachine picks the
 * screen and builds the model with the pure builders; ui only renders it.
 */
import type { StorageStatus } from '@sz/persistence';
import type {
  BootErrorModel,
  LoadingModel,
  MapLoadingModel,
  UnsupportedModel,
} from './boot-models';
import type { ControlRow } from './controls-table';
import type { EndScreenModel } from './end-model';
import type { HistoryModel } from './history-model';
import type { CapturePromptModel, PauseModel } from './pause-model';
import type { SettingsModel } from './settings-model';
import type { SetupPanelModel } from './setup-model';

export interface MainMenuModel {
  readonly id: 'main-menu';
  readonly panel: SetupPanelModel;
  readonly storageStatus: StorageStatus;
}

export interface ControlsModel {
  readonly id: 'controls';
  readonly rows: ReadonlyArray<ControlRow>;
}

export interface AboutModel {
  readonly id: 'about';
  readonly version: string;
  readonly lines: ReadonlyArray<string>;
}

export interface HudScreenModel {
  readonly id: 'hud';
}

export type ScreenModel =
  | LoadingModel
  | BootErrorModel
  | UnsupportedModel
  | MainMenuModel
  | SettingsModel
  | ControlsModel
  | AboutModel
  | HistoryModel
  | MapLoadingModel
  | CapturePromptModel
  | HudScreenModel
  | PauseModel
  | EndScreenModel;

export type ScreenId = ScreenModel['id'];

/** Dialogs open over the current screen with <dialog>.showModal(); one at a time (BR-UI-41). */
export const DIALOG_IDS: ReadonlySet<ScreenId> = new Set<ScreenId>([
  'settings',
  'controls',
  'about',
  'history',
  'pause',
]);

export function isDialog(id: ScreenId): boolean {
  return DIALOG_IDS.has(id);
}

export const ABOUT_LINES: ReadonlyArray<string> = Object.freeze([
  'StrikeZone is a browser tactical shooter against autonomous bots.',
  'All models, textures and sounds are original or procedurally generated in the browser.',
  'Built with TypeScript, Three.js and Rapier. No accounts, no tracking: settings and match history stay in this browser.',
]);

export function toAboutModel(version: string): AboutModel {
  return Object.freeze({ id: 'about', version, lines: ABOUT_LINES });
}

export function toMainMenuModel(
  panel: SetupPanelModel,
  storageStatus: StorageStatus,
): MainMenuModel {
  return Object.freeze({ id: 'main-menu', panel, storageStatus });
}

/** Footer note for a session-only store. */
export function storageNote(s: StorageStatus): string {
  return s === 'session-only' ? 'Saved for this tab only' : '';
}
