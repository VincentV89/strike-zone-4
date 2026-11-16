// Voice admission and stealing (W8, BR-A-31 to BR-A-34, BR-A-38).
import { describe, expect, it } from 'vitest';
import { CATEGORY_CAPS, MAX_VOICES } from '@sz/audio/core/cues';
import { createVoicePolicy, type AdmitRequest } from '@sz/audio/core/voices';
import type { CueCategory, SoundCue } from '@sz/audio/core/types';

const policy = () => createVoicePolicy({ maxVoices: MAX_VOICES, caps: CATEGORY_CAPS });

function req(
  cue: SoundCue,
  category: CueCategory,
  priority: number,
  over: Partial<AdmitRequest> = {},
): AdmitRequest {
  return { cue, key: cue, category, priority, retriggerSec: 0, ...over };
}

type Policy = ReturnType<typeof policy>;

function start(p: Policy, r: AdmitRequest, now: number, dur = 10): number {
  return p.started({ ...r, startedAt: now, endsAt: now + dur });
}

describe('voice policy', () => {
  it('admits into an empty pool', () => {
    expect(policy().admit(req('fire-rifle', 'gunfire', 4), 0)).toEqual({ admit: true });
  });

  it('BR-A-33: drops a retrigger inside the window, per key', () => {
    const p = policy();
    const hurt = req('player-hurt', 'feedback', 4, { retriggerSec: 0.08 });
    start(p, hurt, 1);
    expect(p.admit(hurt, 1.05)).toEqual({ admit: false, reason: 'retrigger' });
    expect(p.admit(hurt, 1.08)).toEqual({ admit: true });
    const a = req('footstep', 'footstep', 1, { key: 'footstep:bot-1', retriggerSec: 0.12 });
    start(p, a, 2);
    expect(p.admit({ ...a, key: 'footstep:bot-2' }, 2.01)).toEqual({ admit: true });
    expect(p.admit(a, 2.01).admit).toBe(false);
  });

  it('BR-A-34: a full category steals the oldest lowest-priority voice', () => {
    const p = policy();
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push(start(p, req('fire-rifle', 'gunfire', 3), i * 0.01));
    expect(p.countIn('gunfire')).toBe(10);
    const d = p.admit(req('fire-rifle', 'gunfire', 3), 0.5);
    expect(d).toEqual({ admit: true, stealVoiceId: ids[0] });
    expect(p.countIn('gunfire')).toBe(9); // the victim is removed at admit time
  });

  it('S6: the player shot steals a bot shot, a bot shot never steals the player', () => {
    const p = policy();
    for (let i = 0; i < 10; i++) start(p, req('fire-rifle', 'gunfire', 4), i * 0.01); // player
    expect(p.admit(req('fire-rifle', 'gunfire', 3), 0.5)).toEqual({
      admit: false,
      reason: 'category-full',
    });
    const q = policy();
    const bot = start(q, req('fire-rifle', 'gunfire', 3), 0.2);
    for (let i = 0; i < 9; i++) start(q, req('fire-rifle', 'gunfire', 4), i * 0.01);
    expect(q.admit(req('fire-rifle', 'gunfire', 4), 0.5)).toEqual({
      admit: true,
      stealVoiceId: bot,
    });
  });

  it('pool full: steals globally, footsteps first', () => {
    const p = policy();
    const step = start(p, req('footstep', 'footstep', 1), 5);
    for (let i = 0; i < 10; i++) start(p, req('fire-rifle', 'gunfire', 3), i);
    for (let i = 0; i < 3; i++) start(p, req('dry-fire', 'weapon', 3), i);
    for (let i = 0; i < 4; i++) start(p, req('hit-body', 'feedback', 4), i);
    for (let i = 0; i < 3; i++) start(p, req('ui-click', 'ui', 5), i);
    for (let i = 0; i < 3; i++) start(p, req('footstep', 'footstep', 2), 6 + i);
    expect(p.count).toBe(24);
    expect(p.admit(req('victory', 'sting', 5), 9)).toEqual({ admit: true, stealVoiceId: step });
  });

  it('pool full with nothing stealable drops the request', () => {
    const p = policy();
    for (let i = 0; i < 10; i++) start(p, req('fire-rifle', 'gunfire', 4), i);
    for (let i = 0; i < 3; i++) start(p, req('dry-fire', 'weapon', 3), i);
    for (let i = 0; i < 4; i++) start(p, req('hit-body', 'feedback', 4), i);
    for (let i = 0; i < 3; i++) start(p, req('ui-click', 'ui', 5), i);
    for (let i = 0; i < 4; i++) start(p, req('footstep', 'footstep', 2), i, 100);
    expect(p.admit(req('footstep', 'footstep', 1), 9)).toEqual({
      admit: false,
      reason: 'pool-full',
    });
  });

  it('BR-A-38: ended is idempotent and expired voices are pruned', () => {
    const p = policy();
    const id = start(p, req('hit-body', 'feedback', 4), 0, 0.1);
    p.ended(id);
    p.ended(id);
    expect(p.count).toBe(0);
    start(p, req('hit-body', 'feedback', 4), 0, 0.1);
    p.admit(req('hit-head', 'feedback', 4), 0.2);
    expect(p.count).toBe(0);
  });

  it('SEC-A-05: a 1000-request burst never exceeds 24 voices, and retrigger keys stay bounded', () => {
    const p = policy();
    const cats: [SoundCue, CueCategory, number][] = [
      ['fire-rifle', 'gunfire', 3],
      ['footstep', 'footstep', 1],
      ['hit-body', 'feedback', 4],
      ['dry-fire', 'weapon', 3],
      ['ui-click', 'ui', 5],
      ['victory', 'sting', 5],
    ];
    for (let i = 0; i < 1000; i++) {
      const [cue, cat, pr] = cats[i % cats.length] ?? cats[0]!;
      const r = req(cue, cat, pr, { key: `k${String(i)}`, retriggerSec: 0.05 });
      const now = i * 0.001;
      if (p.admit(r, now).admit) start(p, r, now, 5);
      expect(p.count).toBeLessThanOrEqual(24);
    }
    p.admit(req('ui-click', 'ui', 5, { key: 'late' }), 100);
    expect(p.count).toBe(0);
  });
});
