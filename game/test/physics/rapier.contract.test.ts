// BR-WM-55, BR-WM-56: the kernel PhysicsQuery contract suite against the Rapier adapter.
import { afterAll, describe, expect, it } from 'vitest';
import { PLAYER_ID, vec3, type ActorId, type CollisionMask } from '@sz/kernel';
import { createPhysicsWorld, type CharacterSpec, type PhysicsWorld } from '@sz/physics';
import { describePhysicsQueryContract } from '../support/physics-contract';
import { sceneMap, wallBox } from '../support/physics-scenes';
import { RAPIER_SKIP_REASON, rapierAvailable } from '../support/rapier-probe';

const BOT = 'bot-1' as ActorId;

/** Hitboxes matching the contract scene: body 0–1.5 m (±0.3), head 1.5–1.9 m (±0.2). */
const CONTRACT_SPEC: CharacterSpec = {
  radius: 0.3,
  standHeight: 1.8,
  crouchHeight: 1.2,
  hitboxes: [
    { zone: 'body', stance: 'stand', offset: vec3(0, 0.75, 0), half: vec3(0.3, 0.75, 0.3) },
    { zone: 'head', stance: 'stand', offset: vec3(0, 1.7, 0), half: vec3(0.2, 0.2, 0.2) },
  ],
};

const worlds: PhysicsWorld[] = [];
afterAll(() => {
  for (const w of worlds) w.dispose();
});

function contractScene(): PhysicsWorld {
  const w = createPhysicsWorld(sceneMap([wallBox('wall', vec3(-1, 0, -6), vec3(1, 3, -5))]));
  worlds.push(w);
  w.addCharacter(BOT, CONTRACT_SPEC, vec3(5, 0, 0));
  w.addCharacter(PLAYER_ID, CONTRACT_SPEC, vec3(-5, 0, 0));
  w.syncHitboxes(BOT, vec3(5, 0, 0), 0, 'stand');
  w.syncHitboxes(PLAYER_ID, vec3(-5, 0, 0), 0, 'stand');
  w.step(1 / 60);
  return w;
}

describe.skipIf(!rapierAvailable)(`Rapier adapter${RAPIER_SKIP_REASON}`, () => {
  describePhysicsQueryContract('Rapier PhysicsWorld', contractScene);

  it('SEC-WM-07: mask 0xFFFF cannot select the CHARACTER bit, so capsules stay invisible', () => {
    const w = contractScene();
    w.setHitboxesEnabled(BOT, false);
    w.step(1 / 60);
    const all = 0xffff as CollisionMask;
    expect(w.raycast(vec3(0, 1, 0), vec3(1, 0, 0), 100, all)).toBeNull();
    expect(w.raycast(vec3(0, 1, 0), vec3(1, 0, 0), 100, 0x0020 as CollisionMask)).toBeNull();
  });
});
