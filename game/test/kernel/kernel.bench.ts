// Advisory micro-benchmarks (PERF-K-04, ADR-K-4). Run with `npm run bench`; not part of verify.
import { bench, describe } from 'vitest';
import { PLAYER_ID, createEventBus, createRng, vec3, type DomainEvent } from '@sz/kernel';

const EVENTS: DomainEvent[] = Array.from({ length: 1000 }, (_, i) => ({
  type: 'Footstep',
  actor: PLAYER_ID,
  pos: vec3(i, 0, 0),
  gait: 'walk',
}));

/** Exported so the benchmark work is observable and cannot be optimised away. */
export const sinkRef = { value: 0 };

describe('kernel', () => {
  const bus = createEventBus<DomainEvent>();
  for (let s = 0; s < 12; s++)
    bus.subscribeAll(() => {
      sinkRef.value++;
    });

  bench('drain 1,000 events to 12 subscriptions', () => {
    for (const e of EVENTS) bus.emit(e);
    bus.drain();
  });

  bench('1,000,000 Rng.next calls', () => {
    const rng = createRng(42);
    let acc = 0;
    for (let i = 0; i < 1_000_000; i++) acc += rng.next();
    sinkRef.value += acc;
  });
});
