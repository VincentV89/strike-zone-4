// LC-R-9, RD-R-3: context-loss machine, pure half.
import {
  INITIAL_CONTEXT,
  canRender,
  contextTransition,
  type ContextMachine,
} from '@sz/render/core/context-state';
import { describe, expect, it } from 'vitest';

describe('context-loss state machine', () => {
  it('live → lost notifies once and prevents default; render stops', () => {
    const s = contextTransition(INITIAL_CONTEXT, { type: 'lost' });
    expect(s.next.state).toBe('lost');
    expect([s.preventDefault, s.notifyLost, s.startRestore, s.notifyRestored]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(canRender(s.next)).toBe(false);
    const again = contextTransition(s.next, { type: 'lost' });
    expect([again.next.state, again.preventDefault, again.notifyLost]).toEqual([
      'lost',
      true,
      false,
    ]);
  });

  it('lost → restoring → live notifies restored once', () => {
    const lost: ContextMachine = { state: 'lost', generation: 0 };
    const r = contextTransition(lost, { type: 'restored' });
    expect([r.next.state, r.next.generation, r.startRestore]).toEqual(['restoring', 1, true]);
    const done = contextTransition(r.next, { type: 'restore-done', generation: 1 });
    expect([done.next.state, done.notifyRestored]).toEqual(['live', true]);
    expect(canRender(done.next)).toBe(true);
  });

  it('a second loss during restoring discards the stale rebuild by generation', () => {
    const restoring: ContextMachine = { state: 'restoring', generation: 1 };
    const lost = contextTransition(restoring, { type: 'lost' });
    expect([lost.next.state, lost.preventDefault, lost.notifyLost]).toEqual(['lost', true, false]);
    const stale = contextTransition(lost.next, { type: 'restore-done', generation: 1 });
    expect(stale.next.state).toBe('lost');
    const again = contextTransition(lost.next, { type: 'restored' });
    expect(again.next.generation).toBe(2);
    const oldDone = contextTransition(again.next, { type: 'restore-done', generation: 1 });
    expect([oldDone.next.state, oldDone.notifyRestored]).toEqual(['restoring', false]);
  });

  it('ignores stray events and freezes after dispose', () => {
    expect(contextTransition(INITIAL_CONTEXT, { type: 'restored' }).next).toBe(INITIAL_CONTEXT);
    expect(contextTransition(INITIAL_CONTEXT, { type: 'restore-done', generation: 0 }).next).toBe(
      INITIAL_CONTEXT,
    );
    const lost: ContextMachine = { state: 'lost', generation: 0 };
    expect(contextTransition(lost, { type: 'restore-done', generation: 0 }).next).toBe(lost);
    const restoring: ContextMachine = { state: 'restoring', generation: 1 };
    expect(contextTransition(restoring, { type: 'restored' }).next).toBe(restoring);
    const d = contextTransition(INITIAL_CONTEXT, { type: 'dispose' }).next;
    expect(d.state).toBe('disposed');
    for (const type of ['lost', 'restored', 'dispose'] as const) {
      const s = contextTransition(d, { type });
      expect([s.next, s.notifyLost, s.preventDefault]).toEqual([d, false, false]);
    }
  });
});
