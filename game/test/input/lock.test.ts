import { createInput, type InputAdapter, type InputEventMap, type InputEventType } from '@sz/input';
import { describe, expect, it } from 'vitest';
import { createFakeDom, fakeEvent, flush, type FakeDom } from '../support/fake-input-dom';

function setup(enabled = true): {
  dom: FakeDom;
  input: InputAdapter;
  events: Array<{ type: InputEventType; payload: unknown }>;
} {
  const dom = createFakeDom();
  const r = createInput(dom);
  if (!r.ok) throw new Error('createInput failed');
  const input = r.value;
  const events: Array<{ type: InputEventType; payload: unknown }> = [];
  const types: InputEventType[] = ['lock-gained', 'lock-lost', 'lock-error', 'scoreboard'];
  for (const type of types) {
    input.on(type, (payload: InputEventMap[typeof type]) => events.push({ type, payload }));
  }
  input.setEnabled(enabled);
  return { dom, input, events };
}

describe('pointer lock (SD-P-5, BR-P-75 to BR-P-78)', () => {
  it('AC1: a canvas click requests the lock; the grant emits lock-gained', () => {
    const { dom, input, events } = setup();
    dom.target.dispatchEvent(fakeEvent('click'));
    expect(dom.target.requestCalls).toBe(1);
    expect(dom.doc.pointerLockElement).toBe(dom.target);
    expect(input.isLocked()).toBe(true);
    expect(events).toEqual([{ type: 'lock-gained', payload: null }]);
  });

  it('ignores clicks while disabled, requesting or locked (SEC-P-06)', () => {
    const { dom, input } = setup(false);
    dom.target.dispatchEvent(fakeEvent('click'));
    input.requestLock();
    expect(dom.target.requestCalls).toBe(0);
    input.setEnabled(true);
    dom.target.mode = 'pending';
    dom.target.dispatchEvent(fakeEvent('click'));
    dom.target.dispatchEvent(fakeEvent('click'));
    input.requestLock();
    expect(dom.target.requestCalls).toBe(1);
  });

  it('a missing requestPointerLock emits lock-error {unsupported}', () => {
    const { dom, input, events } = setup();
    delete dom.target.requestPointerLock;
    input.requestLock();
    expect(events).toEqual([{ type: 'lock-error', payload: { reason: 'unsupported' } }]);
  });

  it.each(['reject', 'throw', 'error-event'] as const)(
    'a %s refusal emits lock-error {denied} once, and a retry works',
    async (mode) => {
      const { dom, input, events } = setup();
      dom.target.mode = mode;
      input.requestLock();
      await flush();
      expect(events).toEqual([{ type: 'lock-error', payload: { reason: 'denied' } }]);
      dom.target.mode = 'grant';
      input.requestLock();
      expect(input.isLocked()).toBe(true);
    },
  );

  it('Chromium double report (pointerlockerror plus rejection) emits one lock-error', async () => {
    const { dom, input, events } = setup();
    dom.target.mode = 'reject-and-error';
    input.requestLock();
    await flush();
    expect(events.filter((e) => e.type === 'lock-error')).toHaveLength(1);
  });

  it('a late rejection after a successful lock does not flip state', async () => {
    const { dom, input, events } = setup();
    let rejectLate: (e: Error) => void = () => undefined;
    dom.target.requestPointerLock = () => {
      dom.target.requestCalls++;
      dom.doc.setLock(dom.target);
      return new Promise((_, rej) => {
        rejectLate = rej;
      });
    };
    input.requestLock();
    rejectLate(new Error('late'));
    await flush();
    expect(input.isLocked()).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['lock-gained']);
  });

  it('an undefined return value (older browsers) is fine', async () => {
    const { dom, input, events } = setup();
    dom.target.mode = 'undefined';
    input.requestLock();
    await flush();
    expect(events).toEqual([]);
    dom.doc.setLock(dom.target);
    expect(input.isLocked()).toBe(true);
  });

  it('AC4: releaseLock exits the lock and reports {released}', () => {
    const { dom, input, events } = setup();
    input.requestLock();
    input.releaseLock();
    expect(dom.doc.exitCalls).toBe(1);
    expect(input.isLocked()).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'lock-lost', payload: { reason: 'released' } });
  });

  it('an external loss (Esc, alt-tab) reports {external} and clears held input', () => {
    const { dom, input, events } = setup();
    input.requestLock();
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'KeyW' }));
    expect(input.poll().move.forward).toBe(1);
    dom.doc.setLock(null);
    expect(events.at(-1)).toEqual({ type: 'lock-lost', payload: { reason: 'external' } });
    expect(input.poll().move.forward).toBe(0);
  });

  it('releaseLock while unlocked does nothing; a throwing exitPointerLock is contained', () => {
    const { dom, input, events } = setup();
    input.releaseLock();
    expect(dom.doc.exitCalls).toBe(0);
    input.requestLock();
    dom.doc.exitPointerLock = () => {
      throw new Error('boom');
    };
    expect(() => {
      input.releaseLock();
    }).not.toThrow();
    dom.doc.setLock(null);
    expect(events.at(-1)).toEqual({ type: 'lock-lost', payload: { reason: 'external' } });
  });

  it('the first mouse move after lock-gained is dropped', () => {
    const { dom, input } = setup();
    input.requestLock();
    dom.doc.dispatchEvent(fakeEvent('mousemove', { movementX: 900, movementY: 900 }));
    dom.doc.dispatchEvent(fakeEvent('mousemove', { movementX: 4, movementY: -3 }));
    expect(input.poll().look).toEqual({ dx: 4, dy: -3 });
  });

  it('dispose during a pending request suppresses the later error', async () => {
    const { dom, input, events } = setup();
    let rejectLate: (e: Error) => void = () => undefined;
    dom.target.requestPointerLock = () =>
      new Promise((_, rej) => {
        rejectLate = rej;
      });
    input.requestLock();
    input.dispose();
    rejectLate(new Error('late'));
    await flush();
    expect(events).toEqual([]);
  });

  it('unsubscribe stops delivery; on() after dispose is inert', () => {
    const { input } = setup();
    const seen: string[] = [];
    const off = input.on('lock-gained', () => seen.push('a'));
    off();
    input.requestLock();
    expect(seen).toEqual([]);
    input.dispose();
    const offLate = input.on('lock-lost', () => seen.push('b'));
    offLate();
    expect(seen).toEqual([]);
  });
});
