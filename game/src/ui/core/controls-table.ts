/**
 * Controls screen table (FD-UI-10). ui may not import @sz/input, so a test asserts that every
 * action in DEFAULT_BINDINGS appears here with its key.
 */

export interface ControlRow {
  /** The @sz/input action name, or a mouse/menu action that has no key binding. */
  readonly action: string;
  readonly label: string;
  readonly keys: string;
  /** KeyboardEvent.code values shown in `keys` (empty for mouse actions). */
  readonly codes: ReadonlyArray<string>;
}

const row = (action: string, label: string, keys: string, codes: string[] = []): ControlRow =>
  Object.freeze({ action, label, keys, codes: Object.freeze(codes) });

export const CONTROLS_TABLE: ReadonlyArray<ControlRow> = Object.freeze([
  row('forward', 'Move forward', 'W', ['KeyW']),
  row('back', 'Move back', 'S', ['KeyS']),
  row('left', 'Strafe left', 'A', ['KeyA']),
  row('right', 'Strafe right', 'D', ['KeyD']),
  row('sprint', 'Sprint (hold)', 'Shift', ['ShiftLeft', 'ShiftRight']),
  row('crouch', 'Crouch (hold)', 'C', ['KeyC']),
  row('jump', 'Jump', 'Space', ['Space']),
  row('look', 'Look', 'Mouse'),
  row('fire', 'Fire', 'Left mouse button'),
  row('scope', 'Scope (sniper)', 'Right mouse button'),
  row('reload', 'Reload', 'R', ['KeyR']),
  row('weapon1', 'Rifle', '1', ['Digit1']),
  row('weapon2', 'Pistol', '2', ['Digit2']),
  row('weapon3', 'Sniper', '3', ['Digit3']),
  row('scoreboard', 'Scoreboard (hold)', 'Tab', ['Tab']),
  row('pause', 'Pause / release mouse', 'Esc'),
]);
