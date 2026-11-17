import { PLAYER_ID, STEP_SEC, ZERO, vec3, type CharacterMover } from '@sz/kernel';
import {
  MOVEMENT_TUNING as T,
  createPlayerMotion,
  eyePosition,
  motionView,
  placePlayer,
  stepMovement,
} from '@sz/player';
import { describe, expect, it } from 'vitest';
import { createFakeMover } from '../support/fakes';
import {
  createFieldMover,
  horizontalSpeed,
  moveIntent,
  rig,
  spyMover,
} from '../support/player-rig';

const W = moveIntent({ forward: 1 });
const UNLOCKED = { move: true };

describe('placement (BR-P-44, BR-P-45)', () => {
  it('createPlayerMotion is unplaced; stepMovement is a no-op with zero mover calls', () => {
    const mover = spyMover(createFakeMover());
    const m = createPlayerMotion({ position: vec3(1, 2, 3), yaw: 0.5 });
    expect(m.id).toBe(PLAYER_ID);
    expect(m.placed).toBe(false);
    const out = stepMovement(m, W, mover, STEP_SEC, UNLOCKED);
    expect(out).toEqual({
      grounded: false,
      speed: 0,
      footstep: null,
      landed: false,
      outOfWorld: false,
    });
    expect(mover.calls.move + mover.calls.setStance).toBe(0);
    expect(m.position).toEqual(vec3(1, 2, 3));
  });

  it('a non-finite pose at creation becomes the origin with yaw 0', () => {
    const m = createPlayerMotion({ position: vec3(Number.NaN, 0, 0), yaw: Number.NaN });
    expect(m.position).toEqual(ZERO);
    expect(m.yaw).toBe(0);
  });

  it('placePlayer teleports, stands and fully resets state', () => {
    const { motion, mover, run } = rig();
    run(30, moveIntent({ forward: 1, crouch: true }));
    motion.pitch = 0.4;
    expect(placePlayer(motion, mover, { position: vec3(5, 0, 5), yaw: 7 })).toBe(true);
    expect(motion.position).toEqual(vec3(5, 0, 5));
    expect(motion.prevPosition).toEqual(vec3(5, 0, 5));
    expect(motion.velocity).toEqual(ZERO);
    expect(motion.yaw).toBeCloseTo(7 - 2 * Math.PI, 12);
    expect(motion.pitch).toBe(0);
    expect(motion.stance).toBe('stand');
    expect(motion.eyeHeight).toBe(T.standEyeHeight);
    expect(motion.strideAccum).toBe(0);
  });

  it('placePlayer rejects a non-finite pose and leaves the record unplaced', () => {
    const mover = spyMover(createFakeMover());
    const m = createPlayerMotion({ position: ZERO, yaw: 0 });
    expect(placePlayer(m, mover, { position: vec3(0, Infinity, 0), yaw: 0 })).toBe(false);
    expect(m.placed).toBe(false);
    expect(mover.calls.teleport).toBe(0);
  });

  it('reports outOfWorld below killY (map-bug guard)', () => {
    const { run, motion } = rig(
      createFieldMover(() => -1000),
      vec3(0, -49.9, 0),
    );
    const outs = run(30);
    expect(outs.some((o) => o.outOfWorld)).toBe(true);
    expect(motion.position.y).toBeLessThan(T.killY);
  });
});

describe('story-move-sprint-crouch (BR-P-20 to BR-P-26)', () => {
  it('AC1: W from rest does not reach top speed in one tick', () => {
    const { run, motion } = rig();
    run(2); // settle on the floor
    const [out] = run(1, W);
    expect(out!.speed).toBeCloseTo(T.groundAccel * STEP_SEC, 9);
    expect(horizontalSpeed(motion)).toBeLessThan(5);
  });

  it('AC1: W held 30 ticks reaches about 5 m/s, facing −Z at yaw 0', () => {
    const { run, motion } = rig();
    run(1);
    const outs = run(30, W);
    expect(outs.at(-1)!.speed).toBeCloseTo(5, 6);
    expect(horizontalSpeed(motion)).toBeCloseTo(5, 9);
    expect(motion.velocity.z).toBeLessThan(0);
    expect(Math.abs(motion.velocity.x)).toBeLessThan(1e-9);
  });

  it('AC2: Shift+W reaches 7.5 m/s, above walk', () => {
    const { run, motion } = rig();
    run(1);
    run(60, moveIntent({ forward: 1, sprint: true }));
    expect(horizontalSpeed(motion)).toBeCloseTo(T.sprintSpeed, 9);
  });

  it('sprint does not apply when moving backward or sideways', () => {
    const back = rig();
    back.run(1);
    back.run(60, moveIntent({ forward: -1, sprint: true }));
    expect(horizontalSpeed(back.motion)).toBeCloseTo(T.walkSpeed, 9);
    const side = rig();
    side.run(1);
    side.run(60, moveIntent({ right: 1, sprint: true }));
    expect(horizontalSpeed(side.motion)).toBeCloseTo(T.walkSpeed, 9);
  });

  it('AC3: C+W gives 2.5 m/s and the eye drops to 1.05 m', () => {
    const { run, motion } = rig();
    run(1);
    run(60, moveIntent({ forward: 1, crouch: true, sprint: true }));
    expect(horizontalSpeed(motion)).toBeCloseTo(T.crouchSpeed, 9);
    expect(motion.stance).toBe('crouch');
    expect(motion.eyeHeight).toBeCloseTo(1.05, 12);
    expect(eyePosition(motion).y).toBeCloseTo(motion.position.y + 1.05, 12);
  });

  it('diagonal movement is not faster than straight', () => {
    const { run, motion } = rig();
    run(1);
    run(60, moveIntent({ forward: 1, right: 1 }));
    expect(horizontalSpeed(motion)).toBeCloseTo(T.walkSpeed, 9);
  });

  it('movement is view-relative: yaw π/2 turns W toward −X', () => {
    const { run, motion } = rig();
    motion.yaw = Math.PI / 2;
    run(1);
    run(30, W);
    expect(motion.velocity.x).toBeCloseTo(-5, 6);
    expect(Math.abs(motion.velocity.z)).toBeLessThan(1e-9);
  });

  it('decelerates to rest at 50 m/s² when input stops', () => {
    const { run, motion } = rig();
    run(1);
    run(30, W);
    run(1);
    expect(horizontalSpeed(motion)).toBeCloseTo(5 - T.groundDecel * STEP_SEC, 9);
    run(10);
    expect(horizontalSpeed(motion)).toBe(0);
  });

  it('AC4: releasing C under a ceiling stays crouched and retries each tick', () => {
    const ceilings = [{ min: vec3(-1, 1.4, -1), max: vec3(1, 3, 1) }];
    const mover = spyMover(createFakeMover({ ceilings }));
    const { run, motion } = rig(mover);
    run(10, moveIntent({ crouch: true }));
    expect(motion.stance).toBe('crouch');
    const before = mover.calls.setStance;
    run(10);
    expect(motion.stance).toBe('crouch');
    expect(motion.eyeHeight).toBeCloseTo(1.05, 12);
    expect(mover.calls.setStance - before).toBe(10);
    expect(motion.wantsCrouch).toBe(false);
  });

  it('stands up once the ceiling is gone', () => {
    const ceilings = [{ min: vec3(-1, 1.4, -1), max: vec3(1, 3, 1) }];
    const { run, motion } = rig(createFakeMover({ ceilings }));
    run(5, moveIntent({ crouch: true }));
    run(120, moveIntent({ right: 1 })); // walk out from under it
    expect(motion.stance).toBe('stand');
    expect(motion.eyeHeight).toBeCloseTo(T.standEyeHeight, 12);
  });

  it('BR-P-26: a move lock decelerates, blocks jump and keeps the stance', () => {
    const { run, motion } = rig();
    run(1);
    run(30, moveIntent({ forward: 1, crouch: true }));
    run(30, moveIntent({ forward: 1, jump: true, crouch: false }), { move: false });
    expect(horizontalSpeed(motion)).toBe(0);
    expect(motion.stance).toBe('crouch');
    expect(motion.position.y).toBe(0);
  });
});

describe('story-jump-gravity (BR-P-30 to BR-P-34)', () => {
  it('AC1: Space rises within one tick, apex about 1 m, lands after about 40 ticks', () => {
    const { run, motion } = rig();
    run(2);
    const [first] = run(1, moveIntent({ jump: true }));
    expect(motion.position.y).toBeGreaterThan(0);
    expect(first!.grounded).toBe(false);
    let apex = 0;
    let landedAt = -1;
    for (let i = 1; i < 80 && landedAt < 0; i++) {
      const [o] = run(1);
      apex = Math.max(apex, motion.position.y);
      if (o!.landed) landedAt = i + 1;
    }
    expect(apex).toBeGreaterThan(0.95);
    expect(apex).toBeLessThan(1.1);
    expect(landedAt).toBeGreaterThanOrEqual(38);
    expect(landedAt).toBeLessThanOrEqual(42);
    expect(motion.velocity.y).toBe(0);
  });

  it('AC2: Space while airborne does not change vy (no double jump, no buffer)', () => {
    const { run, motion } = rig();
    run(2);
    run(1, moveIntent({ jump: true }));
    run(5);
    const vy = motion.velocity.y;
    run(1, moveIntent({ jump: true }));
    expect(motion.velocity.y).toBeCloseTo(vy - T.gravity * STEP_SEC, 12);
  });

  it('holding Space does not re-jump on landing without a new edge from distributeIntent', () => {
    // stepMovement sees jump=true on every tick here; the edge-once guarantee is
    // distributeIntent's job (BR-P-60). This pins that stepMovement itself only needs grounded.
    const { run } = rig();
    run(2);
    const outs = run(100, moveIntent({ jump: true }));
    expect(outs.filter((o) => o.landed).length).toBeGreaterThan(1);
  });

  it('cannot jump while crouched', () => {
    const { run, motion } = rig();
    run(2, moveIntent({ crouch: true }));
    run(1, moveIntent({ crouch: true, jump: true }));
    expect(motion.position.y).toBe(0);
  });

  it('AC3: walking off a ledge falls and lands on the lower floor', () => {
    const floor = (x: number) => (x < 2 ? 2 : 0);
    const { run, motion } = rig(createFieldMover(floor), vec3(0, 2, 0));
    run(2);
    expect(motion.grounded).toBe(true);
    let airborne = false;
    let landed = false;
    for (let i = 0; i < 120 && !landed; i++) {
      const [o] = run(1, moveIntent({ right: 1 }));
      if (!o!.grounded) airborne = true;
      if (o!.landed && airborne) landed = true;
    }
    expect(airborne).toBe(true);
    expect(landed).toBe(true);
    expect(motion.position.y).toBe(0);
  });

  it('gravity is bounded by terminal fall speed', () => {
    const { run, motion } = rig(
      createFieldMover(() => -1e6),
      vec3(0, 1000, 0),
    );
    run(600);
    expect(motion.velocity.y).toBe(-T.terminalFallSpeed);
    expect(motion.airTimeSec).toBeCloseTo(600 * STEP_SEC, 6);
  });

  it('hitting a ceiling while rising zeroes vy', () => {
    const { run, motion } = rig(createFieldMover(() => 0, { ceilingY: 2.2 }));
    run(2);
    run(1, moveIntent({ jump: true }));
    run(5);
    expect(motion.velocity.y).toBeLessThanOrEqual(0);
  });
});

describe('story-solid-world-collision (BR-P-40 to BR-P-43)', () => {
  it('AC1: sprinting into a wall for 300 ticks stays on the near side with no stored speed', () => {
    const { run, motion } = rig(createFieldMover(() => 0, { wallZ: -3 }));
    run(1);
    run(300, moveIntent({ forward: 1, sprint: true }));
    expect(motion.position.z).toBe(-3);
    expect(horizontalSpeed(motion)).toBeLessThan(1e-9);
  });

  it('slides along a wall: the tangential component is kept', () => {
    const { run, motion } = rig(createFieldMover(() => 0, { wallZ: -1 }));
    run(1);
    run(60, moveIntent({ forward: 1, right: 1 }));
    expect(motion.position.z).toBe(-1);
    expect(motion.velocity.x).toBeGreaterThan(0);
    expect(Math.abs(motion.velocity.z)).toBeLessThan(1e-9);
  });

  it('BR-P-42: a non-finite mover position keeps the previous position and zeroes velocity', () => {
    const inner = createFakeMover();
    let poison = false;
    const mover: CharacterMover = {
      move: (id, v, dt) =>
        poison
          ? { position: vec3(Number.NaN, 0, 0), grounded: true, hitCeiling: false, collided: false }
          : inner.move(id, v, dt),
      setStance: (id, s) => inner.setStance(id, s),
      teleport: (id, p) => {
        inner.teleport(id, p);
      },
    };
    const { run, motion } = rig(mover);
    run(20, W);
    const before = motion.position;
    poison = true;
    const [o] = run(1, W);
    expect(motion.position).toEqual(before);
    expect(motion.velocity).toEqual(ZERO);
    expect(o!.speed).toBe(0);
  });

  it('BR-P-43: the eye stays on the capsule axis', () => {
    const { run, motion } = rig(createFieldMover(() => 0, { wallZ: -0.5 }));
    run(60, W);
    const eye = eyePosition(motion);
    expect(eye.x).toBe(motion.position.x);
    expect(eye.z).toBe(motion.position.z);
  });

  it('calls mover.move exactly once per placed tick and setStance at most once', () => {
    const mover = spyMover(createFakeMover());
    const { run } = rig(mover);
    const base = mover.calls.setStance;
    run(10, W);
    expect(mover.calls.move).toBe(10);
    run(1, moveIntent({ crouch: true }));
    run(1);
    expect(mover.calls.move).toBe(12);
    expect(mover.calls.setStance - base).toBe(2);
  });

  it.each([0, -1, Number.NaN, Infinity, 0.2])('dt %d is a no-op with no mover call', (dt) => {
    const mover = spyMover(createFakeMover());
    const { motion } = rig(mover);
    const out = stepMovement(motion, W, mover, dt, UNLOCKED);
    expect(out.speed).toBe(0);
    expect(mover.calls.move).toBe(0);
  });
});

describe('footsteps (req-footsteps, BR-P-50, BR-P-51)', () => {
  const count = (n: number, intent = W) => {
    const { run } = rig();
    run(1);
    return run(n, intent).filter((o) => o.footstep !== null);
  };

  it('walking 2 s gives 5 ± 1 walk steps', () => {
    const steps = count(120);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.length).toBeLessThanOrEqual(6);
    expect(steps.every((s) => s.footstep === 'walk')).toBe(true);
  });

  it('sprinting gives sprint steps at about 2.9 per second', () => {
    const steps = count(120, moveIntent({ forward: 1, sprint: true }));
    expect(steps.some((s) => s.footstep === 'sprint')).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.length).toBeLessThanOrEqual(7);
  });

  it('is silent standing still, crouch-walking and airborne', () => {
    expect(count(120, moveIntent())).toHaveLength(0);
    expect(count(120, moveIntent({ forward: 1, crouch: true }))).toHaveLength(0);
    const { run } = rig(
      createFieldMover(() => -1e6),
      vec3(0, 100, 0),
    );
    expect(run(120, W).filter((o) => o.footstep !== null)).toHaveLength(0);
  });

  it('never emits two steps on consecutive ticks', () => {
    const { run } = rig();
    run(1);
    const outs = run(600, moveIntent({ forward: 1, sprint: true }));
    for (let i = 1; i < outs.length; i++) {
      expect(outs[i]!.footstep !== null && outs[i - 1]!.footstep !== null).toBe(false);
    }
  });
});

describe('motionView', () => {
  it('copies the read-only fields', () => {
    const { run, motion } = rig();
    run(5, W);
    const v = motionView(motion);
    expect(v).toEqual({
      id: PLAYER_ID,
      position: motion.position,
      prevPosition: motion.prevPosition,
      velocity: motion.velocity,
      yaw: motion.yaw,
      pitch: motion.pitch,
      stance: motion.stance,
      eyeHeight: motion.eyeHeight,
      grounded: motion.grounded,
    });
  });

  it('pins the requirement anchors and freezes the tuning', () => {
    expect(T.walkSpeed).toBe(5);
    expect(T.sprintSpeed).toBeGreaterThan(5);
    expect(T.crouchSpeed).toBeLessThan(5);
    expect(Object.isFrozen(T)).toBe(true);
  });
});
