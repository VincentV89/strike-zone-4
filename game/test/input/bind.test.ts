import {
  createInput,
  type InputAdapter,
  type InputDeps,
  type LockDocument,
  type LockTarget,
} from '@sz/input';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createFakeDom, fakeEvent, type FakeDom } from '../support/fake-input-dom';

function create(dom: FakeDom, pairs?: ReadonlyArray<readonly [unknown, unknown]>) {
  return pairs === undefined ? createInput(dom) : createInput(dom, pairs);
}

function locked(): { dom: FakeDom; input: InputAdapter } {
  const dom = createFakeDom();
  const input = unwrap(create(dom));
  input.setEnabled(true);
  input.requestLock();
  return { dom, input };
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error('unexpected err');
  return r.value;
}

describe('createInput (LC-I-5)', () => {
  it('returns err for an invalid binding table (app-shell falls back to defaults)', () => {
    const dom = createFakeDom();
    expect(create(dom, [['ControlLeft', 'crouch']])).toEqual({
      ok: false,
      error: { kind: 'forbidden-code', code: 'ControlLeft' },
    });
    expect(dom.doc.liveCount() + dom.win.liveCount() + dom.target.liveCount()).toBe(0);
  });

  it('accepts custom bindings', () => {
    const dom = createFakeDom();
    const input = unwrap(create(dom, [['KeyI', 'forward']]));
    input.setEnabled(true);
    input.requestLock();
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'KeyI' }));
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'KeyW' }));
    expect(input.poll().move.forward).toBe(1);
  });

  it('feeds keyboard, mouse and wheel events into the frame intent', () => {
    const { dom, input } = locked();
    dom.doc.dispatchEvent(fakeEvent('mousemove', { movementX: 1, movementY: 1 })); // dropped
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'KeyW' }));
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'ShiftLeft' }));
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'Space' }));
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'Space', repeat: true }));
    dom.doc.dispatchEvent(fakeEvent('mousemove', { movementX: 12, movementY: -5 }));
    dom.target.dispatchEvent(fakeEvent('mousedown', { button: 0 }));
    dom.target.dispatchEvent(fakeEvent('mousedown', { button: 2 }));
    dom.target.dispatchEvent(fakeEvent('wheel', { deltaY: -3 }));
    expect(input.poll()).toEqual({
      look: { dx: 12, dy: -5 },
      move: { forward: 1, right: 0 },
      sprint: true,
      crouch: false,
      fire: true,
      aim: true,
      jump: true,
      firePressed: true,
      reload: false,
      switchTo: 'prev',
    });
    dom.target.dispatchEvent(fakeEvent('mouseup', { button: 0 }));
    dom.doc.dispatchEvent(fakeEvent('keyup', { code: 'KeyW' }));
    expect(input.poll()).toMatchObject({ fire: false, jump: false, move: { forward: 0 } });
  });

  it('ignores malformed event fields', () => {
    const { dom, input } = locked();
    dom.doc.dispatchEvent(fakeEvent('keydown'));
    dom.doc.dispatchEvent(fakeEvent('mousemove'));
    dom.doc.dispatchEvent(fakeEvent('mousemove', { movementX: 3, movementY: 4 }));
    dom.target.dispatchEvent(fakeEvent('mousedown'));
    dom.target.dispatchEvent(fakeEvent('wheel'));
    expect(input.poll()).toMatchObject({ look: { dx: 3, dy: 4 }, fire: false, switchTo: null });
  });

  it('emits scoreboard true/false while Tab is held', () => {
    const { dom, input } = locked();
    const seen: boolean[] = [];
    input.on('scoreboard', (shown) => seen.push(shown));
    dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'Tab' }));
    dom.doc.dispatchEvent(fakeEvent('keyup', { code: 'Tab' }));
    expect(seen).toEqual([true, false]);
  });

  it('BR-P-73: blur, a hidden document and setEnabled(false) clear held input', () => {
    const { dom, input } = locked();
    const hold = () => {
      dom.doc.dispatchEvent(fakeEvent('keydown', { code: 'KeyW' }));
    };
    hold();
    dom.win.dispatchEvent(fakeEvent('blur'));
    expect(input.poll().move.forward).toBe(0);
    hold();
    dom.doc.visibilityState = 'hidden';
    dom.doc.dispatchEvent(fakeEvent('visibilitychange'));
    expect(input.poll().move.forward).toBe(0);
    dom.doc.visibilityState = 'visible';
    hold();
    dom.doc.dispatchEvent(fakeEvent('visibilitychange'));
    expect(input.poll().move.forward).toBe(1);
    input.setEnabled(false);
    expect(input.poll().move.forward).toBe(0);
    hold();
    expect(input.poll().move.forward).toBe(0);
    expect(input.isLocked()).toBe(true); // setEnabled(false) does not release
  });
});

describe('dispose (BR-P-81, SEC-P-13)', () => {
  it('10 create/dispose cycles leave zero live listeners per (type, capture)', () => {
    const dom = createFakeDom();
    for (let i = 0; i < 10; i++) {
      const input = unwrap(create(dom));
      input.setEnabled(true);
      input.dispose();
    }
    for (const t of [dom.doc, dom.win, dom.target]) {
      for (const [key, n] of t.live) expect(n, key).toBe(0);
      expect(t.adds).toBe(t.removes);
    }
    expect(dom.doc.adds).toBeGreaterThan(0);
  });

  it('releases a held lock, is idempotent and goes inert', () => {
    const { dom, input } = locked();
    input.dispose();
    expect(dom.doc.exitCalls).toBe(1);
    const removes = dom.doc.removes;
    input.dispose();
    expect(dom.doc.removes).toBe(removes);
    input.setEnabled(true);
    input.requestLock();
    expect(dom.target.requestCalls).toBe(1);
    expect(input.isLocked()).toBe(false);
  });
});

describe('port types (SD-P-3)', () => {
  it('the real DOM document, window and canvas satisfy the narrow ports', () => {
    expectTypeOf<Document>().toExtend<LockDocument>();
    expectTypeOf<HTMLCanvasElement>().toExtend<LockTarget>();
    expectTypeOf<{ doc: Document; win: Window; target: HTMLCanvasElement }>().toExtend<InputDeps>();
  });
});
