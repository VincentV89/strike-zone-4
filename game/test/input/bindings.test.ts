import { DEFAULT_BINDINGS, FORBIDDEN_CODES, validateBindings } from '@sz/input';
import { describe, expect, it } from 'vitest';

describe('validateBindings (BR-P-70, SD-P-6)', () => {
  it('accepts the defaults and returns a ReadonlyMap keyed by KeyboardEvent.code', () => {
    const r = validateBindings(DEFAULT_BINDINGS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.get('KeyW')).toBe('forward');
    expect(r.value.get('KeyC')).toBe('crouch');
    expect(r.value.get('Space')).toBe('jump');
    expect(r.value.get('Tab')).toBe('scoreboard');
    expect(r.value.size).toBe(DEFAULT_BINDINGS.length);
  });

  it('defaults bind crouch to C and nothing to Ctrl, Meta or Escape (FD-P-4)', () => {
    const codes = DEFAULT_BINDINGS.map(([c]) => c);
    expect(codes.filter((c) => /Control|Meta|OS|Escape/.test(c))).toEqual([]);
    expect(Object.isFrozen(DEFAULT_BINDINGS)).toBe(true);
  });

  it.each([...FORBIDDEN_CODES])('rejects the forbidden code %s', (code) => {
    expect(validateBindings([[code, 'crouch']])).toEqual({
      ok: false,
      error: { kind: 'forbidden-code', code },
    });
  });

  it('rejects a duplicate code', () => {
    expect(
      validateBindings([
        ['KeyW', 'forward'],
        ['KeyW', 'back'],
      ]),
    ).toEqual({ ok: false, error: { kind: 'duplicate-code', code: 'KeyW' } });
  });

  it('rejects an unknown action, including prototype names', () => {
    for (const action of ['fly', '__proto__', 'constructor', 7, null]) {
      const r = validateBindings([['KeyF', action]]);
      expect(r).toEqual({ ok: false, error: { kind: 'unknown-action', code: 'KeyF' } });
    }
  });

  it.each([['x'.repeat(33)], [''], [42], [undefined]])('rejects the code %s', (code) => {
    const r = validateBindings([[code, 'jump']]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('forbidden-code');
  });

  it('a "__proto__" code is just another unbound string at lookup', () => {
    const r = validateBindings([['__proto__', 'jump']]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.get('constructor')).toBeUndefined();
  });
});
