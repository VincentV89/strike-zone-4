import { describe, expect, it } from 'vitest';
import { PLAYER_ID, ZERO, vec3, type ActorId } from '@sz/kernel';
import { createFakeMover, createFakePhysics, raySlab } from './fakes';
import { describePhysicsQueryContract } from './physics-contract';

const BOT = 'bot-1' as ActorId;

describePhysicsQueryContract('createFakePhysics', () =>
  createFakePhysics({
    boxes: [{ min: vec3(-1, 0, -6), max: vec3(1, 3, -5) }],
    actors: [
      {
        id: BOT,
        side: 'bot',
        body: { min: vec3(4.7, 0, -0.3), max: vec3(5.3, 1.5, 0.3) },
        head: { min: vec3(4.8, 1.5, -0.2), max: vec3(5.2, 1.9, 0.2) },
      },
      {
        id: PLAYER_ID,
        side: 'player',
        body: { min: vec3(-5.3, 0, -0.3), max: vec3(-4.7, 1.5, 0.3) },
        head: { min: vec3(-5.2, 1.5, -0.2), max: vec3(-4.8, 1.9, 0.2) },
      },
    ],
  }),
);

describe('raySlab', () => {
  const box = { min: vec3(-1, -1, -1), max: vec3(1, 1, 1) };

  it('hits at t = 0 when the ray starts inside the box', () => {
    expect(raySlab(ZERO, vec3(1, 0, 0), box)?.t).toBe(0);
  });

  it('misses a parallel ray outside the slab and a box behind the origin', () => {
    expect(raySlab(vec3(0, 5, 0), vec3(1, 0, 0), box)).toBeNull();
    expect(raySlab(vec3(5, 0, 0), vec3(1, 0, 0), box)).toBeNull();
  });
});

describe('createFakeMover (BR-K-44 to BR-K-46)', () => {
  it('moves by velocity × dt and clamps to the floor', () => {
    const m = createFakeMover();
    m.add(PLAYER_ID, vec3(0, 0, 0));
    const r = m.move(PLAYER_ID, vec3(3, -1, 0), 0.5);
    expect(r.position).toEqual(vec3(1.5, 0, 0));
    expect(r.grounded).toBe(true);
  });

  it('treats non-finite velocity as zero and unknown ids as not found', () => {
    const m = createFakeMover();
    m.add(PLAYER_ID, vec3(1, 2, 3));
    expect(m.move(PLAYER_ID, vec3(Number.NaN, 0, 0), 1 / 60).position).toEqual(vec3(1, 2, 3));
    expect(m.move(BOT, vec3(1, 0, 0), 1 / 60)).toEqual({
      position: ZERO,
      grounded: false,
      hitCeiling: false,
      collided: false,
    });
  });

  it('refuses to stand under a low ceiling, always allows crouch', () => {
    const m = createFakeMover({ ceilings: [{ min: vec3(-1, 1.2, -1), max: vec3(1, 2, 1) }] });
    m.add(PLAYER_ID, vec3(0, 0, 0));
    expect(m.setStance(PLAYER_ID, 'crouch')).toBe(true);
    expect(m.setStance(PLAYER_ID, 'stand')).toBe(false);
    expect(m.stanceOf(PLAYER_ID)).toBe('crouch');
    m.teleport(PLAYER_ID, vec3(5, 0, 5));
    expect(m.setStance(PLAYER_ID, 'stand')).toBe(true);
    expect(m.setStance(BOT, 'stand')).toBe(false);
  });

  it('teleport registers an unknown actor', () => {
    const m = createFakeMover();
    m.teleport(BOT, vec3(2, 0, 2));
    expect(m.move(BOT, ZERO, 1 / 60).position).toEqual(vec3(2, 0, 2));
  });
});
