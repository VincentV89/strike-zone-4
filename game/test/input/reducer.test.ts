import { DEFAULT_BINDINGS, validateBindings, type KeyBindings } from '@sz/input';
import { createInputState, type InputState } from '@sz/input/core/state';
import { describe, expect, it } from 'vitest';

function bindings(): KeyBindings {
  const r = validateBindings(DEFAULT_BINDINGS);
  if (!r.ok) throw new Error('defaults invalid');
  return r.value;
}

function setup(active = true): { s: InputState; board: boolean[] } {
  const board: boolean[] = [];
  const s = createInputState(bindings(), (shown) => board.push(shown));
  s.setActive(active);
  return { s, board };
}

describe('InputState reducer (business-logic-model §5.1)', () => {
  it('builds move axes from held keys: forward = W − S, right = D − A', () => {
    const { s } = setup();
    s.keyDown('KeyW', false);
    s.keyDown('KeyA', false);
    expect(s.poll().move).toEqual({ forward: 1, right: -1 });
    s.keyDown('KeyS', false);
    s.keyDown('KeyD', false);
    expect(s.poll().move).toEqual({ forward: 0, right: 0 });
    s.keyUp('KeyW');
    expect(s.poll().move).toEqual({ forward: -1, right: 0 });
  });

  it('held states persist across polls; edges reset after one poll', () => {
    const { s } = setup();
    s.keyDown('ShiftLeft', false);
    s.keyDown('KeyC', false);
    s.keyDown('Space', false);
    s.keyDown('KeyR', false);
    s.mouseDown(0);
    s.mouseDown(2);
    const a = s.poll();
    expect(a).toMatchObject({
      sprint: true,
      crouch: true,
      fire: true,
      aim: true,
      jump: true,
      reload: true,
      firePressed: true,
    });
    const b = s.poll();
    expect(b).toMatchObject({ sprint: true, crouch: true, fire: true, aim: true });
    expect(b).toMatchObject({ jump: false, reload: false, firePressed: false, switchTo: null });
  });

  it('BR-P-72: key repeat sets held but never latches an edge', () => {
    const { s } = setup();
    s.keyDown('Space', true);
    s.keyDown('KeyR', true);
    s.keyDown('Digit2', true);
    expect(s.poll()).toMatchObject({ jump: false, reload: false, switchTo: null });
  });

  it('firePressed survives a press and release inside one frame', () => {
    const { s } = setup();
    s.mouseDown(0);
    s.mouseUp(0);
    expect(s.poll()).toMatchObject({ fire: false, firePressed: true });
  });

  it('weapon keys and wheel set switchTo; the last request wins', () => {
    const { s } = setup();
    s.keyDown('Digit1', false);
    expect(s.poll().switchTo).toBe('rifle');
    s.keyDown('Digit2', false);
    s.keyDown('Digit3', false);
    expect(s.poll().switchTo).toBe('sniper');
    s.wheel(120);
    expect(s.poll().switchTo).toBe('next');
    s.wheel(-1);
    expect(s.poll().switchTo).toBe('prev');
    s.wheel(0);
    s.wheel(Number.NaN);
    expect(s.poll().switchTo).toBeNull();
  });

  it('sums mouse deltas and resets them after poll', () => {
    const { s } = setup();
    s.mouseMove(3, -2);
    s.mouseMove(4, 1);
    expect(s.poll().look).toEqual({ dx: 7, dy: -1 });
    expect(s.poll().look).toEqual({ dx: 0, dy: 0 });
  });

  it('BR-P-74: drops non-finite components, spikes over 1000 px and the first move after lock', () => {
    const { s } = setup();
    s.mouseMove(Number.NaN, 5);
    s.mouseMove(1001, 1);
    s.mouseMove(2, Infinity);
    expect(s.poll().look).toEqual({ dx: 2, dy: 5 });
    s.dropNextMove();
    s.mouseMove(50, 50);
    s.mouseMove(1, 1);
    expect(s.poll().look).toEqual({ dx: 1, dy: 1 });
  });

  it('clamps the per-frame accumulator to ±4000 px', () => {
    const { s } = setup();
    for (let i = 0; i < 100; i++) s.mouseMove(1000, -1000);
    expect(s.poll().look).toEqual({ dx: 4000, dy: -4000 });
  });

  it('BR-P-71: ignores presses while inactive but always applies releases', () => {
    const { s } = setup(false);
    s.keyDown('KeyW', false);
    s.mouseDown(0);
    s.mouseMove(10, 10);
    s.wheel(1);
    expect(s.poll()).toMatchObject({
      move: { forward: 0, right: 0 },
      fire: false,
      firePressed: false,
      look: { dx: 0, dy: 0 },
      switchTo: null,
    });
    s.setActive(true);
    s.keyDown('KeyW', false);
    s.mouseDown(0);
    s.setActive(false);
    s.keyUp('KeyW');
    s.mouseUp(0);
    expect(s.poll()).toMatchObject({ move: { forward: 0, right: 0 }, fire: false });
  });

  it('scoreboard emits true on hold start and false on release, not on repeat', () => {
    const { s, board } = setup();
    s.keyDown('Tab', false);
    s.keyDown('Tab', true);
    s.keyUp('Tab');
    s.keyUp('Tab');
    expect(board).toEqual([true, false]);
  });

  it('BR-P-73: clear() drops held keys, buttons, edges and deltas, and hides the scoreboard', () => {
    const { s, board } = setup();
    s.keyDown('KeyW', false);
    s.keyDown('Tab', false);
    s.keyDown('Space', false);
    s.mouseDown(0);
    s.mouseDown(2);
    s.mouseMove(5, 5);
    s.wheel(1);
    s.clear();
    const intent = s.poll();
    expect(intent).toMatchObject({
      move: { forward: 0, right: 0 },
      fire: false,
      aim: false,
      jump: false,
      firePressed: false,
      switchTo: null,
      look: { dx: 0, dy: 0 },
    });
    expect(board).toEqual([true, false]);
    s.clear();
    expect(board).toEqual([true, false]);
  });

  it('ignores unbound and prototype-named codes and other mouse buttons', () => {
    const { s } = setup();
    for (const code of ['__proto__', 'constructor', 'toString', 'KeyZ', 'Escape']) {
      s.keyDown(code, false);
      s.keyUp(code);
    }
    s.mouseDown(1);
    s.mouseUp(1);
    s.mouseDown(Number.NaN);
    const intent = s.poll();
    expect(intent).toMatchObject({ jump: false, fire: false, aim: false, switchTo: null });
    expect(intent.move).toEqual({ forward: 0, right: 0 });
  });
});
