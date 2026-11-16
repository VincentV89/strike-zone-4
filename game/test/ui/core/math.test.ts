import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vec3 } from '@sz/kernel';
import { DEFAULT_BINDINGS } from '@sz/input';
import { BOT_LOADOUT, WEAPON_TABLE } from '@sz/weapons';
import { angleDiffDeg, damageArcAngle, normDeg, worldToRadar } from '@sz/ui/core/bearing';
import {
  TEXT_COLOR_TOKENS,
  TOKENS,
  contrast,
  hexToRgb,
  plateOverWhite,
} from '@sz/ui/core/contrast';
import { CONTROLS_TABLE } from '@sz/ui/core/controls-table';
import { HEARD_SHOT_RADIUS_M } from '@sz/ui/core/effects';
import {
  actorLabel,
  botNumber,
  formatAccuracy,
  formatClock,
  quantise,
  recordLine,
  weaponLabel,
} from '@sz/ui/core/format';

const deg = (d: number) => (d * Math.PI) / 180;

describe('damageArcAngle (§9.1, req-hud-damage-indicator AC1)', () => {
  // dir points from the player toward the attacker. Forward at yaw y is (-sin y, -cos y).
  const forward = (y: number) => vec3(-Math.sin(y), 0, -Math.cos(y));
  const right = (y: number) => vec3(Math.cos(y), 0, -Math.sin(y));

  it.each([0, 90])('at yaw %i°: ahead 0, right 90, behind 180, left 270', (yawDeg) => {
    const y = deg(yawDeg);
    const f = forward(y);
    const r = right(y);
    expect(damageArcAngle(y, f)).toBeCloseTo(0, 6);
    expect(damageArcAngle(y, r)).toBeCloseTo(90, 6);
    expect(damageArcAngle(y, vec3(-f.x, 0, -f.z))).toBeCloseTo(180, 6);
    expect(damageArcAngle(y, vec3(-r.x, 0, -r.z))).toBeCloseTo(270, 6);
  });

  it('normDeg and angleDiffDeg wrap correctly', () => {
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(720)).toBe(0);
    expect(normDeg(Number.NaN)).toBe(0);
    expect(angleDiffDeg(350, 10)).toBe(20);
    expect(angleDiffDeg(10, 190)).toBe(180);
  });
});

describe('worldToRadar (§9.2)', () => {
  it.each([0, 90, 37])('a bot straight ahead projects above the centre at yaw %i°', (yawDeg) => {
    const y = deg(yawDeg);
    const ahead = vec3(-Math.sin(y) * 10, 0, -Math.cos(y) * 10);
    const p = worldToRadar(ahead, vec3(0, 0, 0), y, 130, 4);
    expect(p.x).toBeCloseTo(130, 6);
    expect(p.y).toBeCloseTo(90, 6);
  });

  it('equals the SVG group transform translate(c c) scale(k) rotate(yawDeg) translate(-x -z)', () => {
    const pl = vec3(12, 0, -7);
    const yaw = deg(123);
    const c = 130;
    const k = 4;
    for (const pt of [vec3(20, 0, 3), vec3(-5, 0, -30), vec3(12, 0, -17)]) {
      // Hand-applied SVG: rotate(θ) maps (x, y) to (x cosθ − y sinθ, x sinθ + y cosθ).
      const x = pt.x - pl.x;
      const z = pt.z - pl.z;
      const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
      const ry = x * Math.sin(yaw) + z * Math.cos(yaw);
      const p = worldToRadar(pt, pl, yaw, c, k);
      expect(p.x).toBeCloseTo(c + k * rx, 9);
      expect(p.y).toBeCloseTo(c + k * ry, 9);
    }
  });
});

describe('format (§9.3)', () => {
  it('formatClock floors durations and ceils the live timer', () => {
    expect(formatClock(180)).toBe('3:00');
    expect(formatClock(179.2, 'ceil')).toBe('3:00');
    expect(formatClock(179.2)).toBe('2:59');
    expect(formatClock(0.01, 'ceil')).toBe('0:01');
    expect(formatClock(0, 'ceil')).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(-1)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });

  it('labels actors, weapons, accuracy and the record', () => {
    expect(actorLabel('player')).toBe('You');
    expect(actorLabel('bot-12')).toBe('Bot-12');
    expect(actorLabel('bot-99')).toBe('Bot');
    expect(actorLabel('__proto__')).toBe('Bot');
    expect(botNumber('bot-7')).toBe(7);
    expect(botNumber('player')).toBe(0);
    expect(weaponLabel('sniper')).toBe('Sniper');
    expect(formatAccuracy(0)).toBe('0%');
    expect(formatAccuracy(Number.NaN)).toBe('0%');
    expect(recordLine({ roundsWon: 3, roundsLost: 2 })).toBe('Record W 3 · L 2');
    expect(quantise(0.123, 0.05)).toBe(0.1);
    expect(quantise(Number.POSITIVE_INFINITY, 0.05)).toBe(0);
  });
});

describe('contrast gate (§9.4, team HUD contrast rule)', () => {
  const plate = plateOverWhite();

  it('the plate over white is #46484B', () => {
    expect(plate).toEqual(hexToRgb('#46484B'));
  });

  // The team figures (7.8, 4.6, 4.4) are rounded to one decimal; the gates are WCAG levels.
  it('pins the token ratios', () => {
    expect(contrast(hexToRgb(TOKENS.text), plate)).toBeCloseTo(7.8, 1);
    expect(contrast(hexToRgb(TOKENS.amber), plate)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hexToRgb(TOKENS.amber), plate)).toBeCloseTo(4.6, 1);
    expect(contrast(hexToRgb(TOKENS.secondary), plate)).toBeGreaterThanOrEqual(3);
    expect(contrast(hexToRgb(TOKENS.secondary), plate)).toBeCloseTo(4.4, 1);
    expect(contrast(hexToRgb(TOKENS.red), plate)).toBeLessThanOrEqual(3.1);
  });

  it('red is never a text colour token', () => {
    expect(TEXT_COLOR_TOKENS).not.toContain(TOKENS.red);
  });

  it('styles.css uses exactly these tokens and never colours text red', () => {
    // Prettier lower-cases hex colours, so compare case-insensitively.
    const css = readFileSync(
      new URL('../../../src/ui/dom/styles.css', import.meta.url),
      'utf8',
    ).toLowerCase();
    for (const [name, value] of [
      ['text', TOKENS.text],
      ['secondary', TOKENS.secondary],
      ['amber', TOKENS.amber],
      ['red', TOKENS.red],
      ['plate', TOKENS.plate],
    ] as const) {
      expect(css).toContain(`--sz-${name}: ${value.toLowerCase()};`);
    }
    expect(css).not.toMatch(/(^|[^-])color:\s*var\(--sz-red\)/m);
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe('pins', () => {
  it('CONTROLS_TABLE covers every DEFAULT_BINDINGS action and key (FD-UI-10)', () => {
    for (const [code, action] of DEFAULT_BINDINGS) {
      const row = CONTROLS_TABLE.find((r) => r.action === action);
      expect(row, action).toBeDefined();
      expect(row?.codes, `${action} ${code}`).toContain(code);
    }
  });

  it('HEARD_SHOT_RADIUS_M equals the largest noiseRadiusM over BOT_LOADOUT (FD-UI-7)', () => {
    const max = Math.max(...BOT_LOADOUT.map((w) => WEAPON_TABLE[w].noiseRadiusM));
    expect(HEARD_SHOT_RADIUS_M).toBe(max);
  });
});
