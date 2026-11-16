// Event-to-sound mapping (BR-A-20 to BR-A-30, BR-A-73).
import { describe, expect, it, vi } from 'vitest';
import { PLAYER_ID, vec3, type ActorId, type DomainEvent } from '@sz/kernel';
import { bindAudioToEvents } from '@sz/audio/core/bind';
import { cuesForEvent, who } from '@sz/audio/core/router';
import { createRecordingBus } from '../support/recording-bus';

const BOT = 'bot-3' as ActorId;
const P = vec3(1, 2, 3);
const D = vec3(0, 0, -1);

const ev = {
  shot: (shooter: ActorId, weapon = 'rifle'): DomainEvent =>
    ({ type: 'ShotFired', shooter, weapon, origin: P, dir: D }) as DomainEvent,
  step: (actor: ActorId, gait: 'walk' | 'sprint'): DomainEvent => ({
    type: 'Footstep',
    actor,
    pos: P,
    gait,
  }),
};

describe('who', () => {
  it.each([
    [PLAYER_ID, 'player'],
    ['bot-1', 'bot'],
    ['bot-20', 'bot'],
    ['bot-21', 'other'],
    ['bot-0', 'other'],
    ['bot-x', 'other'],
    ['enemy', 'other'],
    ['', 'other'],
    [undefined, 'other'],
  ])('%s → %s', (id, expected) => {
    expect(who(id, PLAYER_ID)).toBe(expected);
  });
});

describe('cuesForEvent', () => {
  it.each([
    ['BR-A-20 player rifle', ev.shot(PLAYER_ID), [{ cue: 'fire-rifle' }]],
    ['BR-A-20 player pistol', ev.shot(PLAYER_ID, 'pistol'), [{ cue: 'fire-pistol' }]],
    ['BR-A-21 bot sniper', ev.shot(BOT, 'sniper'), [{ cue: 'fire-sniper', at: P }]],
    ['unknown weapon', ev.shot(PLAYER_ID, '__proto__'), []],
    ['unknown shooter', ev.shot('ghost' as ActorId), []],
    [
      'BR-A-22 player dry fire',
      { type: 'DryFire', actor: PLAYER_ID, weapon: 'rifle' },
      [{ cue: 'dry-fire' }],
    ],
    ['bot dry fire', { type: 'DryFire', actor: BOT, weapon: 'rifle' }, []],
    [
      'BR-A-23 reload start',
      { type: 'ReloadStarted', actor: PLAYER_ID, weapon: 'rifle', durationSec: 2 },
      [{ cue: 'reload-start' }],
    ],
    [
      'bot reload start',
      { type: 'ReloadStarted', actor: BOT, weapon: 'rifle', durationSec: 2 },
      [],
    ],
    [
      'BR-A-24 reload done',
      { type: 'ReloadDone', actor: PLAYER_ID, weapon: 'rifle', magazine: 30, reserve: 60 },
      [{ cue: 'reload-end' }],
    ],
    [
      'BR-A-25 head hit',
      {
        type: 'HitConfirmed',
        shooter: PLAYER_ID,
        target: BOT,
        zone: 'head',
        damage: 99,
        killed: true,
      },
      [{ cue: 'hit-head' }],
    ],
    [
      'BR-A-25 body hit',
      {
        type: 'HitConfirmed',
        shooter: PLAYER_ID,
        target: BOT,
        zone: 'body',
        damage: 20,
        killed: false,
      },
      [{ cue: 'hit-body' }],
    ],
    [
      'bot hits player (no hit marker sound)',
      {
        type: 'HitConfirmed',
        shooter: BOT,
        target: PLAYER_ID,
        zone: 'body',
        damage: 20,
        killed: false,
      },
      [],
    ],
    [
      'BR-A-26 player hurt',
      {
        type: 'DamageTaken',
        victim: PLAYER_ID,
        from: BOT,
        dir: D,
        amount: 10,
        healthAfter: 90,
        armorAfter: 90,
      },
      [{ cue: 'player-hurt' }],
    ],
    [
      'bot hurt',
      {
        type: 'DamageTaken',
        victim: BOT,
        from: PLAYER_ID,
        dir: D,
        amount: 10,
        healthAfter: 90,
        armorAfter: 0,
      },
      [],
    ],
    [
      'BR-A-27 bot killed',
      { type: 'ActorKilled', killer: PLAYER_ID, victim: BOT, weapon: 'rifle', headshot: false },
      [{ cue: 'enemy-death' }],
    ],
    [
      'player killed',
      { type: 'ActorKilled', killer: BOT, victim: PLAYER_ID, weapon: 'rifle', headshot: false },
      [],
    ],
    [
      'BR-A-28 player walk',
      ev.step(PLAYER_ID, 'walk'),
      [{ cue: 'footstep', gainScale: 1, key: 'footstep:player' }],
    ],
    [
      'BR-A-28 player sprint',
      ev.step(PLAYER_ID, 'sprint'),
      [{ cue: 'footstep', gainScale: 1.41, key: 'footstep:player' }],
    ],
    [
      'BR-A-29 bot sprint',
      ev.step(BOT, 'sprint'),
      [{ cue: 'footstep', at: P, gainScale: 1.41, key: 'footstep:bot-3' }],
    ],
    ['unknown footstep actor', ev.step('bot-99' as ActorId, 'walk'), []],
    [
      'BR-A-30 victory',
      { type: 'RoundEnded', outcome: 'victory', durationSec: 60 },
      [{ cue: 'victory' }],
    ],
    [
      'BR-A-30 defeat',
      { type: 'RoundEnded', outcome: 'defeat', durationSec: 60 },
      [{ cue: 'defeat' }],
    ],
    [
      'BR-A-30 time expired',
      { type: 'RoundEnded', outcome: 'time-expired', durationSec: 300 },
      [{ cue: 'defeat' }],
    ],
    ['BR-A-30 abandoned', { type: 'RoundEnded', outcome: 'abandoned', durationSec: 10 }, []],
    ['bad outcome', { type: 'RoundEnded', outcome: 'draw', durationSec: 10 }, []],
    [
      'ShotImpact',
      { type: 'ShotImpact', shooter: PLAYER_ID, point: P, normal: D, surface: 'world' },
      [],
    ],
    [
      'WeaponSwitched',
      { type: 'WeaponSwitched', actor: PLAYER_ID, from: 'rifle', to: 'pistol' },
      [],
    ],
    [
      'NoiseEmitted',
      { type: 'NoiseEmitted', source: PLAYER_ID, pos: P, radius: 30, kind: 'gunfire' },
      [],
    ],
    ['BotStateChanged', { type: 'BotStateChanged', bot: BOT, from: 'patrol', to: 'engage' }, []],
    ['RoundPhaseChanged', { type: 'RoundPhaseChanged', from: 'countdown', to: 'live' }, []],
    ['PerformanceAdvisory', { type: 'PerformanceAdvisory', medianFps: 40, botCount: 20 }, []],
    ['unknown type', { type: 'Bogus' }, []],
  ])('%s', (_label, e, expected) => {
    expect(cuesForEvent(e as DomainEvent, PLAYER_ID)).toEqual(expected);
  });
});

describe('bindAudioToEvents', () => {
  it('plays each mapped event once, passing options, and survives bus.clear()', () => {
    const bus = createRecordingBus();
    const play = vi.fn();
    const off = bindAudioToEvents(bus, { play }, PLAYER_ID);
    bus.emit(ev.shot(PLAYER_ID));
    bus.emit(ev.step(BOT, 'walk'));
    bus.emit({ type: 'RoundPhaseChanged', from: 'ready', to: 'countdown' });
    bus.drain();
    expect(play.mock.calls).toEqual([
      ['fire-rifle', undefined, {}],
      ['footstep', P, { gainScale: 1, key: 'footstep:bot-3' }],
    ]);
    bus.clear();
    bus.emit(ev.shot(PLAYER_ID, 'pistol'));
    bus.drain();
    expect(play).toHaveBeenCalledTimes(3);
    off();
    bus.emit(ev.shot(PLAYER_ID));
    bus.drain();
    expect(play).toHaveBeenCalledTimes(3);
    expect(bus.errors).toEqual([]);
  });
});
