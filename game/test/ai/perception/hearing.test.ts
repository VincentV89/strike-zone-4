// Hearing, damage and shot log (req-bot-hearing AC1, BR-AI-05, BR-AI-16 to BR-AI-18).
import { describe, expect, it } from 'vitest';
import { createPerceptionSystem } from '@sz/ai/perception';
import { PLAYER_ID, vec3, type ActorId } from '@sz/kernel';

const B1 = 'bot-1' as ActorId;
const B2 = 'bot-2' as ActorId;

function withBots() {
  const p = createPerceptionSystem();
  p.updatePositions([
    { id: B1, feet: vec3(0, 0, 0), alive: true },
    { id: B2, feet: vec3(60, 0, 0), alive: true },
  ]);
  return p;
}

describe('hearing', () => {
  it('delivers a gunshot to bots inside the radius only (AC1)', () => {
    const p = withBots();
    p.emitNoise({ source: PLAYER_ID, pos: vec3(30, 0, 0), radius: 40, kind: 'gunfire' });
    p.processNoises(1);
    expect(p.perceptsFor(B1, 1).heardNoise).toEqual({
      pos: vec3(30, 0, 0),
      at: 1,
      kind: 'gunfire',
    });
    expect(p.perceptsFor(B2, 1).heardNoise).toEqual({
      pos: vec3(30, 0, 0),
      at: 1,
      kind: 'gunfire',
    });
    p.emitNoise({ source: PLAYER_ID, pos: vec3(-35, 0, 0), radius: 40, kind: 'footstep' });
    p.processNoises(2);
    expect(p.perceptsFor(B1, 2).heardNoise?.kind).toBe('footstep');
    expect(p.perceptsFor(B2, 2).heardNoise?.at).toBe(1);
  });

  it('gives the noise position, never the live player position (BR-AI-05)', () => {
    const p = withBots();
    const noise = { source: PLAYER_ID, pos: vec3(5, 0, 5), radius: 20, kind: 'gunfire' as const };
    p.emitNoise(noise);
    p.processNoises(1);
    const heard = p.perceptsFor(B1, 1).heardNoise;
    expect(heard?.pos).toEqual(vec3(5, 0, 5));
    expect(Object.keys(heard ?? {}).sort()).toEqual(['at', 'kind', 'pos']);
  });

  it('ignores bot noises and malformed noises (BR-AI-17, BR-AI-19)', () => {
    const p = withBots();
    p.emitNoise({ source: B2, pos: vec3(1, 0, 0), radius: 40, kind: 'gunfire' });
    p.emitNoise({ source: PLAYER_ID, pos: vec3(NaN, 0, 0), radius: 40, kind: 'gunfire' });
    p.emitNoise({ source: PLAYER_ID, pos: vec3(1, 0, 0), radius: -1, kind: 'gunfire' });
    p.emitNoise({ source: PLAYER_ID, pos: vec3(1, 0, 0), radius: 5, kind: 'shout' as never });
    p.emitNoise(null as never);
    p.processNoises(1);
    expect(p.perceptsFor(B1, 1)).toEqual({});
    expect(p.stats().queuedNoises).toBe(0);
  });

  it('a noise reaches the bots of the next processNoises call only, then the queue is empty', () => {
    const p = withBots();
    p.emitNoise({ source: PLAYER_ID, pos: vec3(0, 0, 0), radius: 10, kind: 'gunfire' });
    expect(p.stats().queuedNoises).toBe(1);
    p.processNoises(1);
    p.processNoises(2);
    expect(p.perceptsFor(B1, 2).heardNoise?.at).toBe(1);
  });

  it('heard noises expire after 8 s, damage after 3 s (BR-AI-18)', () => {
    const p = withBots();
    p.emitNoise({ source: PLAYER_ID, pos: vec3(0, 0, 0), radius: 10, kind: 'gunfire' });
    p.processNoises(1);
    p.recordDamage(B1, vec3(1, 0, 0), 1);
    expect(p.perceptsFor(B1, 4).recentDamageFrom).toBeDefined();
    expect(p.perceptsFor(B1, 4.1).recentDamageFrom).toBeUndefined();
    expect(p.perceptsFor(B1, 9).heardNoise).toBeDefined();
    expect(p.perceptsFor(B1, 9.1).heardNoise).toBeUndefined();
  });

  it('dead bots hear nothing', () => {
    const p = createPerceptionSystem();
    p.updatePositions([{ id: B1, feet: vec3(0, 0, 0), alive: false }]);
    p.emitNoise({ source: PLAYER_ID, pos: vec3(0, 0, 0), radius: 10, kind: 'gunfire' });
    p.processNoises(1);
    expect(p.perceptsFor(B1, 1)).toEqual({});
  });

  it('keeps at most 64 queued noises per tick', () => {
    const p = withBots();
    for (let i = 0; i < 100; i++)
      p.emitNoise({ source: PLAYER_ID, pos: vec3(0, 0, 0), radius: 1, kind: 'footstep' });
    expect(p.stats().queuedNoises).toBe(64);
  });
});

describe('damage and shots', () => {
  it('stores a horizontal unit direction only (BR-AI-05, SEC-AI-05)', () => {
    const p = withBots();
    p.recordDamage(B1, vec3(3, 2, 4), 1);
    const d = p.perceptsFor(B1, 1).recentDamageFrom;
    expect(d?.dir.x).toBeCloseTo(0.6);
    expect(d?.dir.y).toBe(0);
    expect(d?.dir.z).toBeCloseTo(0.8);
    expect(Object.keys(d ?? {}).sort()).toEqual(['at', 'dir']);
  });

  it('a zero or non-finite direction is "damaged, direction unknown"', () => {
    const p = withBots();
    p.recordDamage(B1, vec3(0, 0, 0), 1);
    expect(p.perceptsFor(B1, 1).recentDamageFrom?.dir).toEqual(vec3(0, 0, 0));
    p.recordDamage(B1, vec3(NaN, 0, 1), 2);
    expect(p.perceptsFor(B1, 2).recentDamageFrom).toEqual({ dir: vec3(0, 0, 0), at: 2 });
    p.recordDamage(B1, vec3(1, 0, 0), NaN);
    expect(p.perceptsFor(B1, 2).recentDamageFrom?.at).toBe(2);
  });

  it('recentlyFired is true within 2 s of a shot (BR-AI-21)', () => {
    const p = withBots();
    p.noteShot(B1, 5);
    p.noteShot(PLAYER_ID, 5);
    p.noteShot(B2, NaN);
    expect(p.recentlyFired(B1, 7)).toBe(true);
    expect(p.recentlyFired(B1, 7.01)).toBe(false);
    expect(p.recentlyFired(B2, 5)).toBe(false);
    expect(p.stats().shots).toBe(1);
  });
});
