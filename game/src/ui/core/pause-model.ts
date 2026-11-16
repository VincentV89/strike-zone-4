/**
 * Pause dialog, abandon confirmation and capture prompt (business-logic-model-ui-hud §10.1,
 * BR-UI-40, req-abandon-round). The confirm view appears before any state changes; a pre-start
 * restart or quit is silent and uncounted (RD-7).
 */
import type { MapId } from '@sz/kernel';
import type { GraphicsPreset } from '@sz/persistence';
import type { RoundView } from '@sz/round';
import type { SessionTotals } from '@sz/stats';
import { formatClock, mapName } from './format';

export type PauseVariant = 'combat' | 'pre-start';
export type AbandonAction = 'restart' | 'quit-to-menu';

export interface ConfirmModel {
  readonly action: AbandonAction;
  readonly question: string;
  readonly consequence: string;
  readonly confirmLabel: string;
}

export interface PauseModel {
  readonly id: 'pause';
  readonly variant: PauseVariant;
  readonly summaryLine: string;
  /** Shown while a performance advisory is set and graphics is still High. */
  readonly advisoryLine: string;
  readonly confirm: ConfirmModel | undefined;
}

export interface PauseInput {
  readonly view: RoundView;
  readonly roundIndex: number;
  readonly aliveBots: number;
  readonly record: SessionTotals;
  readonly advisory: { readonly fps: number } | undefined;
  readonly graphics: GraphicsPreset;
  readonly confirm: AbandonAction | undefined;
}

export function pauseVariant(view: Pick<RoundView, 'started' | 'phase'>): PauseVariant {
  return view.started && view.phase === 'live' ? 'combat' : 'pre-start';
}

function confirmOf(action: AbandonAction, record: SessionTotals): ConfirmModel {
  const next = `Record becomes W ${String(record.roundsWon)} · L ${String(record.roundsLost + 1)}.`;
  return Object.freeze({
    action,
    question: action === 'restart' ? 'Restart round?' : 'Leave this round?',
    consequence: `Counts as a loss. ${next}`,
    confirmLabel: action === 'restart' ? 'Restart round' : 'Leave round',
  });
}

export function toPauseModel(i: PauseInput): PauseModel {
  const variant = pauseVariant(i.view);
  const round = `Round ${String(i.roundIndex)}`;
  const enemies = `${String(i.aliveBots)} ${i.aliveBots === 1 ? 'enemy' : 'enemies'} remaining`;
  return Object.freeze({
    id: 'pause',
    variant,
    summaryLine:
      variant === 'combat'
        ? `${round} · ${formatClock(i.view.timeLeftSec, 'ceil')} left · ${enemies}`
        : `${round} · not started`,
    advisoryLine:
      i.advisory && i.graphics === 'high'
        ? `Performance is low (${String(i.advisory.fps)} FPS). Medium graphics may help.`
        : '',
    confirm: variant === 'combat' && i.confirm ? confirmOf(i.confirm, i.record) : undefined,
  });
}

export type PauseIntent = 'resume' | 'restart' | 'quit-to-menu' | 'confirm' | 'cancel';

export interface PauseStep {
  /** The confirm view to show next (undefined closes it). */
  readonly confirm: AbandonAction | undefined;
  /** What app-shell must now do, if anything. */
  readonly execute: 'resume' | AbandonAction | undefined;
}

/**
 * app-shell's pure decision for a Pause intent. combat → restart/quit open the confirm view;
 * pre-start → they execute at once with no confirmation and no loss.
 */
export function onPauseIntent(
  variant: PauseVariant,
  confirm: AbandonAction | undefined,
  intent: PauseIntent,
): PauseStep {
  switch (intent) {
    case 'resume':
      return { confirm: undefined, execute: 'resume' };
    case 'restart':
    case 'quit-to-menu':
      return variant === 'combat'
        ? { confirm: intent, execute: undefined }
        : { confirm: undefined, execute: intent };
    case 'confirm':
      return { confirm: undefined, execute: confirm };
    case 'cancel':
      return { confirm: undefined, execute: undefined };
  }
}

export interface CapturePromptModel {
  readonly id: 'capture-prompt';
  /** "Round n · Map name" */
  readonly roundLabel: string;
  readonly refusalLine: string;
}

export function toCapturePrompt(
  roundIndex: number,
  map: MapId,
  refused: boolean,
  name: string = mapName(map),
): CapturePromptModel {
  return Object.freeze({
    id: 'capture-prompt',
    roundLabel: `Round ${String(roundIndex)} · ${name}`,
    refusalLine: refused
      ? "Your browser didn't capture the mouse. Press Enter or click to try again."
      : '',
  });
}
