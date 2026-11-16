// HUD pipeline integration (FD-UI-4, PD-UI-24, PERF-UI-05): app-shell steps 4–6 over a real round.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, createStore } from '@sz/persistence';
import { MAX_HUD_PATCHES } from '@sz/ui/core/hud-diff';
import { createFakeStorage, createManualSchedule } from '../../support/fake-storage';
import { createHudDriver } from '../../support/hud-driver';
import { aimAt, botsInFront, createTestRound, headOf, intentOf } from '../../support/round-driver';

function fight(botCount: number) {
  const t = createTestRound({ botCount, placeBots: botsInFront, seed: 7 });
  const hud = createHudDriver(t);
  t.goLive();
  hud.frame();
  for (let i = 0; i < 1500 && t.round.state().phase === 'live'; i++) {
    const target = t.round.snapshot()?.bots.find((b) => b.alive);
    if (target) aimAt(t.round, headOf(target));
    t.round.tick(intentOf({ fire: true, firePressed: i % 2 === 0 }));
    hud.frame(i % 50 < 10);
  }
  hud.frame();
  return { t, hud };
}

describe('HUD pipeline over a scripted round', () => {
  it('the live tally equals the authoritative summary (FD-UI-4)', () => {
    const { t, hud } = fight(3);
    const view = t.round.state();
    expect(view.phase).toBe('ended');
    const s = view.summary;
    if (!s) throw new Error('no summary');
    const tally = hud.effects.tally;
    expect(s.kills).toBeGreaterThan(0);
    expect(tally.kills).toBe(s.kills);
    expect(tally.deaths).toBe(s.deaths);
    expect(tally.headshots).toBe(s.headshots);
    expect(tally.shotsFired).toBe(s.shotsFired);
    expect(tally.shotsHit).toBe(s.shotsHit);
    expect(tally.damageDealt).toBe(s.damageDealt);
    expect(tally.damageReceived).toBe(s.damageReceived);
    expect(hud.effects.feed.length).toBeGreaterThan(0);
    expect(hud.effects.roundIndex).toBe(1);
  }, 60_000);

  it('every frame stays within the patch ceiling; the ended frame hides the HUD', () => {
    const { hud } = fight(5);
    expect(Math.max(...hud.patchCounts)).toBeLessThanOrEqual(MAX_HUD_PATCHES);
    expect(hud.last?.visible).toBe(false);
  }, 60_000);

  it('paused frames produce no patches and reuse the model', () => {
    const t = createTestRound({ botCount: 2, seed: 3 });
    const hud = createHudDriver(t);
    t.goLive();
    hud.frame();
    t.round.setPaused(true);
    hud.frame();
    const vm = hud.last;
    for (let i = 0; i < 30; i++) expect(hud.frame()).toHaveLength(0);
    expect(hud.last).toBe(vm);
  }, 60_000);

  it('600 HUD frames make zero storage calls (PD-UI-24)', () => {
    const storage = createFakeStorage();
    const store = createStore({ storage, now: () => 0, schedule: createManualSchedule().schedule });
    const t = createTestRound({ botCount: 5, seed: 11 });
    const hud = createHudDriver(t, store.settings());
    const before = storage.count();
    t.goLive();
    for (let i = 0; i < 600; i++) {
      t.round.tick(intentOf({}));
      hud.frame();
    }
    expect(storage.count()).toBe(before);
    expect(store.settings()).toBe(store.settings());
    expect(DEFAULT_SETTINGS.graphics).toBe('medium');
  }, 60_000);

  it('a restart resets the tally and increments the round number', () => {
    const { t, hud } = fight(1);
    const r = t.round.restart();
    expect(r.start.ok).toBe(true);
    hud.frame();
    expect(hud.effects.roundIndex).toBe(2);
    expect(hud.effects.tally.kills).toBe(0);
    expect(hud.effects.feed).toHaveLength(0);
  }, 60_000);
});
