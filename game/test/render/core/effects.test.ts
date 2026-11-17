// BR-R-10 to BR-R-12, BR-R-15, BR-R-19: drained events → effects.
import { PLAYER_ID, vec3, type ActorId, type DomainEvent } from '@sz/kernel';
import { SPARKS_PER_HIT } from '@sz/render/core/effects';
import { stepPresentation } from '@sz/render/core/frame';
import { createPresentationState } from '@sz/render/core/state';
import { WEAPON_TABLE } from '@sz/weapons';
import { describe, expect, it } from 'vitest';
import {
  botsAhead,
  frame,
  impactBot,
  impactWorld,
  shot,
  snapshot,
} from '../../support/render-frames';

const B1 = 'bot-1' as ActorId;

function run(events: ReadonlyArray<DomainEvent>) {
  const s = createPresentationState();
  const curr = snapshot({ bots: botsAhead(3) });
  stepPresentation(s, frame(curr), 16 / 9);
  stepPresentation(s, frame(curr, { events }), 16 / 9);
  return s;
}

describe('event mapping (BR-R-10)', () => {
  it('player ShotFired kicks the viewmodel and shows its flash', () => {
    const s = run([shot(PLAYER_ID, vec3(0, 1.6, 0), vec3(0, 0, -1))]);
    expect(s.viewmodel.kick).toBeGreaterThan(0);
    expect(s.vmPose.flash).toBe(true);
  });

  it('bot ShotFired within draw distance shows a world muzzle flash', () => {
    const s = run([shot(B1, vec3(0, 1.6, -10), vec3(0, 0, 1))]);
    expect(s.effects.muzzle.live).toBe(1);
    expect(s.effectBuffers.muzzle.count).toBe(1);
  });

  it('bot ShotFired beyond draw distance shows nothing', () => {
    const s = run([shot(B1, vec3(0, 1.6, -500), vec3(0, 0, 1))]);
    expect(s.effects.muzzle.live).toBe(0);
  });

  it('every world ShotImpact places a puff and a decal at the point', () => {
    const s = run([
      impactWorld(vec3(1, 1, -3), vec3(0, 0, 1)),
      impactWorld(vec3(2, 0, -3), vec3(0, 1, 0)),
    ]);
    expect(s.effects.decal.live).toBe(2);
    expect(s.effects.puff.live).toBe(2);
    const live = s.effects.decal.slots.filter((x) => x.live);
    expect(live.map((d) => d.z)).toEqual([-2.99, -3]);
  });

  it('every bot ShotImpact emits hit sparks', () => {
    const s = run([impactBot(B1, vec3(0, 1.4, -10))]);
    expect(s.effects.spark.live).toBe(SPARKS_PER_HIT);
  });

  it('HitConfirmed on a bot starts a flinch; ActorKilled starts the death reaction', () => {
    const hit: DomainEvent = {
      type: 'HitConfirmed',
      shooter: PLAYER_ID,
      target: B1,
      zone: 'body',
      damage: 28,
      killed: false,
    };
    const kill: DomainEvent = {
      type: 'ActorKilled',
      killer: PLAYER_ID,
      victim: 'bot-2' as ActorId,
      weapon: 'rifle',
      headshot: false,
    };
    const s = run([hit, kill]);
    const slot1 = s.actors.slots[s.actors.index.get(B1) ?? -1];
    const slot2 = s.actors.slots[s.actors.index.get('bot-2') ?? -1];
    expect(slot1?.flinchStart).toBeGreaterThan(0);
    expect(slot2?.deathStart).toBeGreaterThan(0);
    // Away from the player at the origin: bots stand at -Z, so the fall points further -Z.
    expect(slot2?.deathDz).toBeLessThan(0);
  });

  it('ReloadStarted and WeaponSwitched for the player drive the viewmodel', () => {
    const s = run([
      { type: 'ReloadStarted', actor: PLAYER_ID, weapon: 'rifle', durationSec: 2.2 },
      { type: 'WeaponSwitched', actor: PLAYER_ID, from: 'rifle', to: 'sniper' },
    ]);
    expect(s.viewmodel.weapon).toBe('sniper');
    expect(s.viewmodel.reloadStart).toBe(-1);
    expect(s.viewmodel.drawDur).toBe(WEAPON_TABLE.sniper.drawSec);
  });

  it('bot reloads and switches do not touch the viewmodel', () => {
    const s = run([
      { type: 'ReloadStarted', actor: B1, weapon: 'rifle', durationSec: 2 },
      { type: 'WeaponSwitched', actor: B1, from: 'rifle', to: 'pistol' },
    ]);
    expect(s.viewmodel.weapon).toBe('rifle');
    expect(s.viewmodel.reloadStart).toBe(-1);
  });
});

describe('drained events, not curr.events (BR-R-15)', () => {
  it('a frame that ran 3 ticks shows all 3 ticks of impacts', () => {
    const drained = [
      impactWorld(vec3(0, 1, -5), vec3(0, 0, 1)),
      impactWorld(vec3(1, 1, -5), vec3(0, 0, 1)),
      impactWorld(vec3(2, 1, -5), vec3(0, 0, 1)),
    ];
    const s = createPresentationState();
    const lastTickOnly = snapshot({ events: drained.slice(2) });
    stepPresentation(s, frame(lastTickOnly, { events: drained }), 16 / 9);
    expect(s.effects.decal.live).toBe(3);
  });
});

describe('hostile events (BR-R-19)', () => {
  it('unknown types, ids and non-finite vectors never throw and add nothing', () => {
    const hostile = [
      { type: 'Nope' },
      null,
      7,
      {
        type: 'ShotImpact',
        point: vec3(Number.NaN, 0, 0),
        normal: vec3(0, 1, 0),
        surface: 'world',
      },
      { type: 'ShotImpact', point: vec3(0, 0, 0), normal: vec3(0, 0, 0), surface: 'world' },
      {
        type: 'ShotImpact',
        point: vec3(0, 0, 0),
        normal: vec3(0, 1, 0),
        surface: 'actor',
        target: '__proto__',
      },
      {
        type: 'ShotFired',
        shooter: B1,
        weapon: 'rifle',
        origin: vec3(0, 0, 0),
        dir: vec3(0, 0, 0),
      },
      { type: 'ShotFired', shooter: B1, weapon: 'rifle', origin: { x: 'a' }, dir: vec3(0, 0, 1) },
      {
        type: 'HitConfirmed',
        shooter: PLAYER_ID,
        target: 'constructor',
        zone: 'body',
        damage: 1,
        killed: false,
      },
      {
        type: 'ActorKilled',
        killer: PLAYER_ID,
        victim: 'bot-21',
        weapon: 'rifle',
        headshot: false,
      },
      { type: 'WeaponSwitched', actor: PLAYER_ID, from: 'rifle', to: '__proto__' },
      { type: 'ReloadStarted', actor: PLAYER_ID, weapon: 'rifle', durationSec: Number.NaN },
      {
        type: 'DamageTaken',
        victim: PLAYER_ID,
        from: B1,
        dir: vec3(1, 0, 0),
        amount: 5,
        healthAfter: 95,
        armorAfter: 95,
      },
    ] as unknown as DomainEvent[];
    const s = run(hostile);
    expect(
      s.effects.decal.live + s.effects.puff.live + s.effects.spark.live + s.effects.muzzle.live,
    ).toBe(0);
    expect(s.viewmodel.weapon).toBe('rifle');
    expect(s.viewmodel.reloadStart).toBe(-1);
    const s2 = createPresentationState();
    stepPresentation(s2, frame(snapshot(), { events: 'x' as unknown as DomainEvent[] }), 1);
    expect(s2.effects.decal.live).toBe(0);
  });

  it('a hit from an unknown shooter still flinches the bot (fallback direction)', () => {
    const s = run([
      {
        type: 'HitConfirmed',
        shooter: 'nobody' as ActorId,
        target: B1,
        zone: 'head',
        damage: 1,
        killed: false,
      },
    ]);
    expect(s.actors.slots[s.actors.index.get(B1) ?? -1]?.flinchStart).toBeGreaterThan(0);
  });
});
