// InputState reducer (business-logic-model §5.1). Pure: plain values in, intent out.
import type { PlayerInputIntent, SwitchRequest } from '@sz/player';
import type { InputAction, KeyBindings } from './bindings';

/** Per-event spike limit: a larger move is a pointer-lock acquire artefact (BR-P-74). */
export const MAX_EVENT_DELTA = 1000;
/** Per-frame accumulator limit, matching LOOK_TUNING.maxDeltaPerFrame (BR-P-13). */
export const MAX_FRAME_DELTA = 4000;

const EDGE_SWITCH: ReadonlyMap<InputAction, SwitchRequest> = new Map<InputAction, SwitchRequest>([
  ['weapon1', 'rifle'],
  ['weapon2', 'pistol'],
  ['weapon3', 'sniper'],
]);

export interface InputState {
  /** Gate: presses apply only while enabled and locked (BR-P-71). */
  setActive(active: boolean): void;
  keyDown(code: string, repeat: boolean): void;
  keyUp(code: string): void;
  mouseMove(dx: number, dy: number): void;
  mouseDown(button: number): void;
  mouseUp(button: number): void;
  wheel(deltaY: number): void;
  /** Drop the next mouse move (called on lock-gained). */
  dropNextMove(): void;
  /** Clears held keys, buttons, edges and deltas (BR-P-73). */
  clear(): void;
  /** Builds the frame intent, then resets deltas and edges. Held states persist. */
  poll(): PlayerInputIntent;
}

function clampDelta(v: number): number {
  return v > MAX_FRAME_DELTA ? MAX_FRAME_DELTA : v < -MAX_FRAME_DELTA ? -MAX_FRAME_DELTA : v;
}

function finiteDelta(v: number): number | null {
  if (!Number.isFinite(v)) return 0;
  return Math.abs(v) > MAX_EVENT_DELTA ? null : v;
}

/**
 * Creates the reducer. onScoreboard fires on hold start (true) and end (false).
 * Holds a set of actions, four edge latches and two numbers; never a key history (SEC-P-14).
 */
export function createInputState(
  bindings: KeyBindings,
  onScoreboard: (shown: boolean) => void,
): InputState {
  const held = new Set<InputAction>();
  let active = false;
  let fire = false;
  let aim = false;
  let jump = false;
  let reload = false;
  let firePressed = false;
  let switchTo: SwitchRequest = null;
  let dx = 0;
  let dy = 0;
  let dropMove = false;

  const has = (a: InputAction): number => (held.has(a) ? 1 : 0);
  const axisOf = (pos: InputAction, neg: InputAction): -1 | 0 | 1 =>
    (has(pos) - has(neg)) as -1 | 0 | 1;

  function release(action: InputAction): void {
    if (!held.delete(action)) return;
    if (action === 'scoreboard') onScoreboard(false);
  }

  function clear(): void {
    const scoreboardShown = held.has('scoreboard');
    held.clear();
    fire = false;
    aim = false;
    jump = false;
    reload = false;
    firePressed = false;
    switchTo = null;
    dx = 0;
    dy = 0;
    if (scoreboardShown) onScoreboard(false);
  }

  return {
    setActive(next) {
      active = next;
    },
    keyDown(code, repeat) {
      if (!active || typeof code !== 'string') return;
      const action = bindings.get(code);
      if (action === undefined) return;
      const wasHeld = held.has(action);
      held.add(action);
      if (action === 'scoreboard' && !wasHeld) onScoreboard(true);
      if (repeat) return; // BR-P-72: repeat never latches an edge
      if (action === 'jump') jump = true;
      else if (action === 'reload') reload = true;
      else switchTo = EDGE_SWITCH.get(action) ?? switchTo;
    },
    keyUp(code) {
      if (typeof code !== 'string') return;
      const action = bindings.get(code);
      if (action !== undefined) release(action);
    },
    mouseMove(mx, my) {
      if (!active) return;
      if (dropMove) {
        dropMove = false;
        return;
      }
      const x = finiteDelta(mx);
      const y = finiteDelta(my);
      if (x === null || y === null) return;
      dx = clampDelta(dx + x);
      dy = clampDelta(dy + y);
    },
    mouseDown(button) {
      if (!active) return;
      if (button === 0) {
        fire = true;
        firePressed = true;
      } else if (button === 2) aim = true;
    },
    mouseUp(button) {
      if (button === 0) fire = false;
      else if (button === 2) aim = false;
    },
    wheel(deltaY) {
      if (!active || !Number.isFinite(deltaY) || deltaY === 0) return;
      switchTo = deltaY > 0 ? 'next' : 'prev';
    },
    dropNextMove() {
      dropMove = true;
    },
    clear,
    poll() {
      const intent: PlayerInputIntent = {
        look: { dx, dy },
        move: { forward: axisOf('forward', 'back'), right: axisOf('right', 'left') },
        sprint: held.has('sprint'),
        crouch: held.has('crouch'),
        fire,
        aim,
        jump,
        firePressed,
        reload,
        switchTo,
      };
      dx = 0;
      dy = 0;
      jump = false;
      reload = false;
      firePressed = false;
      switchTo = null;
      return intent;
    },
  };
}
