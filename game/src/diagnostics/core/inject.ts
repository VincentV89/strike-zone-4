/**
 * Injected-intent sanitiser for the e2e hook (SD-AS-10, SEC-AS-23). Builds a fresh intent from
 * known fields only, so a test can drive the local player's input and nothing else. The shape is
 * structural: diagnostics core imports only the kernel, and app-shell checks assignability to
 * PlayerInputIntent where it uses the value.
 */
import { WEAPON_IDS, err, isWeaponId, ok, type Result, type WeaponId } from '@sz/kernel';

export const MAX_INJECT_TICKS = 3600;

export interface InjectedIntent {
  readonly look: { readonly dx: number; readonly dy: number };
  readonly move: { readonly forward: -1 | 0 | 1; readonly right: -1 | 0 | 1 };
  readonly sprint: boolean;
  readonly crouch: boolean;
  readonly fire: boolean;
  readonly aim: boolean;
  readonly jump: boolean;
  readonly firePressed: boolean;
  readonly reload: boolean;
  readonly switchTo: WeaponId | 'next' | 'prev' | null;
}

const own = (o: object, k: string): unknown =>
  Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined;

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Sign of a finite number as an axis value. */
function axis(v: unknown): -1 | 0 | 1 {
  const n = finite(v);
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

const flag = (o: object, k: string): boolean => own(o, k) === true;

function switchOf(v: unknown): InjectedIntent['switchTo'] {
  if (v === 'next' || v === 'prev' || isWeaponId(v)) return v;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= WEAPON_IDS.length) {
    return WEAPON_IDS[v - 1] ?? null;
  }
  return null;
}

const record = (v: unknown): object | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined;

export function sanitizeInjectedIntent(raw: unknown): Result<InjectedIntent, 'invalid-intent'> {
  const o = record(raw);
  if (o === undefined) return err('invalid-intent');
  const look = record(own(o, 'look')) ?? {};
  const move = record(own(o, 'move')) ?? {};
  return ok(
    Object.freeze({
      look: Object.freeze({ dx: finite(own(look, 'dx')), dy: finite(own(look, 'dy')) }),
      move: Object.freeze({ forward: axis(own(move, 'forward')), right: axis(own(move, 'right')) }),
      sprint: flag(o, 'sprint'),
      crouch: flag(o, 'crouch'),
      fire: flag(o, 'fire'),
      aim: flag(o, 'aim'),
      jump: flag(o, 'jump'),
      firePressed: flag(o, 'firePressed'),
      reload: flag(o, 'reload'),
      switchTo: switchOf(own(o, 'switchTo')),
    }),
  );
}

export function parseTicks(raw: unknown): Result<number, 'invalid-ticks'> {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= MAX_INJECT_TICKS
    ? ok(raw)
    : err('invalid-ticks');
}

export const MAX_SEED = 0xffff_ffff;

/** SD-AS-5 / SEC-AS-16: a hook seed must be a uint32. */
export function parseSeed(raw: unknown): Result<number, 'invalid-seed'> {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_SEED
    ? ok(raw)
    : err('invalid-seed');
}
