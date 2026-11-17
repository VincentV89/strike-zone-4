// Key bindings (BR-P-70, SD-P-6). Pure: no DOM types, no globals.
import { err, ok, type Result } from '@sz/kernel';

export type InputAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'crouch'
  | 'jump'
  | 'reload'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'scoreboard';

export type KeyBindings = ReadonlyMap<string, InputAction>;

export type BindingError = {
  readonly kind: 'forbidden-code' | 'duplicate-code' | 'unknown-action';
  readonly code: string;
};

const ACTIONS: ReadonlySet<string> = new Set<InputAction>([
  'forward',
  'back',
  'left',
  'right',
  'sprint',
  'crouch',
  'jump',
  'reload',
  'weapon1',
  'weapon2',
  'weapon3',
  'scoreboard',
]);

/**
 * Codes that can never be bound: Ctrl/Meta combos include Ctrl+W, which closes the tab
 * and cannot be blocked (FD-P-4), and Escape belongs to the browser's pointer-lock exit.
 */
export const FORBIDDEN_CODES: ReadonlySet<string> = new Set([
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'Escape',
]);

const MAX_CODE_LENGTH = 32;

/** KeyboardEvent.code → action, layout-independent. Shown on the Controls screen. */
export const DEFAULT_BINDINGS: ReadonlyArray<readonly [string, InputAction]> = Object.freeze([
  ['KeyW', 'forward'],
  ['KeyS', 'back'],
  ['KeyA', 'left'],
  ['KeyD', 'right'],
  ['ShiftLeft', 'sprint'],
  ['ShiftRight', 'sprint'],
  ['KeyC', 'crouch'],
  ['Space', 'jump'],
  ['KeyR', 'reload'],
  ['Digit1', 'weapon1'],
  ['Digit2', 'weapon2'],
  ['Digit3', 'weapon3'],
  ['Tab', 'scoreboard'],
] as const);

function isAction(v: unknown): v is InputAction {
  return typeof v === 'string' && ACTIONS.has(v);
}

/**
 * Validates a binding table once, at createInput (SD-P-6). Returns a ReadonlyMap so a
 * code such as '__proto__' is simply unbound during play (SEC-P-09).
 */
export function validateBindings(
  pairs: ReadonlyArray<readonly [unknown, unknown]>,
): Result<KeyBindings, BindingError> {
  const map = new Map<string, InputAction>();
  for (const [code, action] of pairs) {
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) {
      return err({
        kind: 'forbidden-code',
        code: typeof code === 'string' ? code.slice(0, 32) : '',
      });
    }
    if (FORBIDDEN_CODES.has(code)) return err({ kind: 'forbidden-code', code });
    if (map.has(code)) return err({ kind: 'duplicate-code', code });
    if (!isAction(action)) return err({ kind: 'unknown-action', code });
    map.set(code, action);
  }
  return ok(map);
}
