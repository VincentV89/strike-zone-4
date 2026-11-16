import { DEFAULT_BINDINGS, createInput, type InputAdapter } from '@sz/input';
import { describe, expect, it } from 'vitest';
import { createFakeDom, fakeEvent, type FakeDom } from '../support/fake-input-dom';

function setup(): { dom: FakeDom; input: InputAdapter } {
  const dom = createFakeDom();
  const r = createInput(dom);
  if (!r.ok) throw new Error('createInput failed');
  r.value.setEnabled(true);
  return { dom, input: r.value };
}

const keydown = (dom: FakeDom, code: string, ctrlKey = false): boolean => {
  const ev = fakeEvent('keydown', { code, ctrlKey });
  dom.doc.dispatchEvent(ev);
  return ev.defaultPrevented;
};

describe('preventDefault list (BR-P-79, SEC-P-10)', () => {
  const codes = [...DEFAULT_BINDINGS.map(([c]) => c), 'Tab', 'F1', 'F5', 'Escape', 'KeyW'];
  const expected = new Set(['Tab', 'Space', 'F1', 'Digit1', 'Digit2', 'Digit3']);

  it.each(codes)('locked: %s is prevented exactly when listed', (code) => {
    const { dom, input } = setup();
    input.requestLock();
    expect(keydown(dom, code)).toBe(expected.has(code));
  });

  it('locked: Ctrl+S and Ctrl+D are prevented; Ctrl+W is not (it cannot be blocked)', () => {
    const { dom, input } = setup();
    input.requestLock();
    expect(keydown(dom, 'KeyS', true)).toBe(true);
    expect(keydown(dom, 'KeyD', true)).toBe(true);
    expect(keydown(dom, 'KeyW', true)).toBe(false);
  });

  it('unlocked: nothing is prevented, so menus keep native keyboard behaviour', () => {
    const { dom } = setup();
    for (const code of codes) expect(keydown(dom, code)).toBe(false);
    expect(keydown(dom, 'KeyS', true)).toBe(false);
    const wheel = fakeEvent('wheel', { deltaY: 1 });
    dom.target.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it('locked: wheel and contextmenu are prevented; wheel is registered non-passive', () => {
    const { dom, input } = setup();
    input.requestLock();
    const wheel = fakeEvent('wheel', { deltaY: 1 });
    const menu = fakeEvent('contextmenu');
    dom.target.dispatchEvent(wheel);
    dom.target.dispatchEvent(menu);
    expect(wheel.defaultPrevented).toBe(true);
    expect(menu.defaultPrevented).toBe(true);
    expect(dom.target.passive.get('wheel')).toBe(false);
  });
});
