import { describe, expect, it, vi } from 'vitest';
import { PLAYER_ID, createEventBus, vec3, type ActorId, type DomainEvent } from '@sz/kernel';

const BOT = 'bot-1' as ActorId;

const footstep = (n: number): DomainEvent => ({
  type: 'Footstep',
  actor: PLAYER_ID,
  pos: vec3(n, 0, 0),
  gait: 'walk',
});
const killed: DomainEvent = {
  type: 'ActorKilled',
  killer: PLAYER_ID,
  victim: BOT,
  weapon: 'rifle',
  headshot: true,
};
const hit: DomainEvent = {
  type: 'HitConfirmed',
  shooter: PLAYER_ID,
  target: BOT,
  zone: 'head',
  damage: 100,
  killed: true,
};

function newBus() {
  const reports: { err: unknown; type: string }[] = [];
  const bus = createEventBus<DomainEvent>({
    onSubscriberError: (err, type) => reports.push({ err, type }),
  });
  return { bus, reports };
}

describe('EventBus (BR-K-20 to BR-K-28)', () => {
  it('BR-K-21: emit only queues; nothing is delivered before drain', () => {
    const { bus } = newBus();
    const fn = vi.fn();
    bus.subscribeAll(fn);
    bus.emit(footstep(1));
    expect(fn).not.toHaveBeenCalled();
    expect(bus.pending).toBe(1);
  });

  it('BR-K-22: drain delivers in emit order, then subscription order, and returns the batch', () => {
    const { bus } = newBus();
    const log: string[] = [];
    bus.subscribeAll((e) => log.push(`a:${e.type}`));
    bus.subscribeAll((e) => log.push(`b:${e.type}`));
    bus.emit(footstep(1));
    bus.emit(killed);
    const batch = bus.drain();
    expect(batch.map((e) => e.type)).toEqual(['Footstep', 'ActorKilled']);
    expect(log).toEqual(['a:Footstep', 'b:Footstep', 'a:ActorKilled', 'b:ActorKilled']);
    expect(bus.pending).toBe(0);
  });

  it('subscribe(type) filters by type and narrows the payload', () => {
    const { bus } = newBus();
    const victims: ActorId[] = [];
    bus.subscribe('ActorKilled', (e) => victims.push(e.victim));
    bus.emit(footstep(1));
    bus.emit(killed);
    bus.drain();
    expect(victims).toEqual([BOT]);
  });

  it('S7 / BR-K-23: an emit during drain is delivered on the next drain, never the current one', () => {
    const { bus } = newBus();
    const seen: string[] = [];
    bus.subscribe('ActorKilled', () => {
      bus.emit(hit);
    });
    bus.subscribeAll((e) => seen.push(e.type));
    bus.emit(killed);
    expect(bus.drain().map((e) => e.type)).toEqual(['ActorKilled']);
    expect(seen).toEqual(['ActorKilled']);
    expect(bus.pending).toBe(1);
    expect(bus.drain().map((e) => e.type)).toEqual(['HitConfirmed']);
    expect(seen).toEqual(['ActorKilled', 'HitConfirmed']);
  });

  it('BR-K-23: a re-entrant drain returns [] and delivers nothing', () => {
    const { bus } = newBus();
    const nested: ReadonlyArray<DomainEvent>[] = [];
    bus.subscribeAll(() => nested.push(bus.drain()));
    bus.emit(footstep(1));
    bus.emit(footstep(2));
    bus.drain();
    expect(nested).toEqual([[], []]);
  });

  it('BR-K-25: unsubscribe during drain takes effect from the next event', () => {
    const { bus } = newBus();
    const calls: number[] = [];
    let unsubB = (): void => undefined;
    bus.subscribeAll(() => {
      calls.push(1);
      unsubB();
    });
    unsubB = bus.subscribeAll(() => calls.push(2));
    bus.emit(footstep(1));
    bus.emit(footstep(2));
    bus.drain();
    expect(calls).toEqual([1, 1]);
  });

  it('BR-K-25: subscribe during drain takes effect from the next drain', () => {
    const { bus } = newBus();
    const late = vi.fn();
    let added = false;
    bus.subscribeAll(() => {
      if (!added) {
        added = true;
        bus.subscribeAll(late);
      }
    });
    bus.emit(footstep(1));
    bus.emit(footstep(2));
    bus.drain();
    expect(late).not.toHaveBeenCalled();
    bus.emit(footstep(3));
    bus.drain();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('BR-K-25: calling Unsubscribe twice is a no-op', () => {
    const { bus } = newBus();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = bus.subscribeAll(a);
    bus.subscribeAll(b);
    unsubA();
    unsubA();
    bus.emit(footstep(1));
    bus.drain();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('S6 / BR-K-24: a throwing subscriber is reported once; others keep receiving every event', () => {
    const { bus, reports } = newBus();
    const audio = vi.fn();
    bus.subscribe('HitConfirmed', () => {
      throw new Error('ui broke');
    });
    bus.subscribeAll(audio);
    for (let i = 0; i < 3; i++) bus.emit(hit);
    bus.drain();
    bus.emit(hit);
    bus.drain();
    expect(audio).toHaveBeenCalledTimes(4);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.type).toBe('HitConfirmed');
    expect((reports[0]?.err as Error).message).toBe('ui broke');
  });

  it('SEC-K-09: the report carries the error and type only, never the payload', () => {
    const { bus, reports } = newBus();
    bus.subscribeAll(() => {
      throw new Error('x');
    });
    bus.emit(killed);
    bus.drain();
    expect(Object.keys(reports[0] ?? {})).toEqual(['err', 'type']);
    expect(JSON.stringify(reports[0]?.type)).not.toContain('bot-1');
  });

  it('BR-K-24: the default reporter is console.error, once per subscription', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const bus = createEventBus<DomainEvent>();
      bus.subscribeAll(() => {
        throw new Error('boom');
      });
      bus.emit(killed);
      bus.emit(killed);
      bus.drain();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain('ActorKilled');
    } finally {
      spy.mockRestore();
    }
  });

  it('S5 / BR-K-26: clear() discards queued events and keeps subscriptions', () => {
    const { bus } = newBus();
    const fn = vi.fn();
    bus.subscribeAll(fn);
    bus.emit(footstep(1));
    bus.clear();
    expect(bus.pending).toBe(0);
    expect(bus.drain()).toEqual([]);
    bus.emit(footstep(2));
    bus.drain();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('PERF-K-02 / SCAL-K-02: 1,000 events × 12 subscriptions = exactly 12,000 calls', () => {
    const { bus } = newBus();
    let calls = 0;
    for (let s = 0; s < 12; s++)
      bus.subscribeAll(() => {
        calls++;
      });
    for (let i = 0; i < 1000; i++) bus.emit(footstep(i));
    expect(bus.drain()).toHaveLength(1000);
    expect(calls).toBe(12_000);
  });

  it('REL-K-03: 10,000 events over 100 drains are all delivered, in emit order', () => {
    const { bus } = newBus();
    const xs: number[] = [];
    bus.subscribe('Footstep', (e) => xs.push(e.pos.x));
    let n = 0;
    for (let d = 0; d < 100; d++) {
      for (let i = 0; i < 100; i++) bus.emit(footstep(n++));
      bus.drain();
    }
    expect(xs).toHaveLength(10_000);
    expect(xs.every((x, i) => x === i)).toBe(true);
  });

  it('drain still resets its draining flag when the error reporter itself throws', () => {
    const bus = createEventBus<DomainEvent>({
      onSubscriberError: () => {
        throw new Error('reporter broke');
      },
    });
    bus.subscribeAll(() => {
      throw new Error('sub');
    });
    bus.emit(killed);
    expect(() => bus.drain()).toThrow('reporter broke');
    bus.emit(killed);
    expect(bus.drain()).toHaveLength(1);
  });
});
