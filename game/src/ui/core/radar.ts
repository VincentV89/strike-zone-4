/**
 * Radar model: the fair-play gate (business-logic-model-ui-hud §8, SD-UI-12, BR-UI-31).
 * This is the only function in ui that reads bot positions. It emits a diamond only for a bot
 * that is alive && revealed (FD-UI-2) and a ring only for a heard bot shot (FD-UI-7).
 */
import type { RadarSegment } from '@sz/maps';
import type { SimSnapshot } from '@sz/sim';
import { worldToRadar } from './bearing';
import { pingOpacity, type HudEffects } from './effects';
import { botNumber, quantise } from './format';

export const RADAR_SLOTS = 20;
export const RADAR_PX_PER_M = 4;

export interface RadarInput {
  /** World-metre wall segments for the loaded map; null when outline generation failed. */
  readonly segments: ReadonlyArray<RadarSegment> | null;
  readonly pxPerM: number;
  /** 130 at the reference size, 100 for short viewports. */
  readonly radiusPx: number;
}

export interface RadarPing {
  readonly transform: string;
  readonly opacity: number;
}

export interface RadarModel {
  readonly groupTransform: string;
  readonly northTransform: string;
  /** Per bot slot (bot-n → slot n-1): a transform, or null when nothing may be drawn. */
  readonly diamonds: ReadonlyArray<string | null>;
  readonly pings: ReadonlyArray<RadarPing | null>;
}

const fmt = (v: number): string => String(quantise(v, 0.1));

function slotOf(id: string): number {
  const n = botNumber(id);
  return n >= 1 && n <= RADAR_SLOTS ? n - 1 : -1;
}

export function toRadarModel(
  snap: SimSnapshot,
  fx: Pick<HudEffects, 'pings'>,
  input: RadarInput,
): RadarModel {
  const c = input.radiusPx;
  const k = input.pxPerM;
  const pl = snap.player.pos;
  const yaw = snap.player.yaw;
  const yawDeg = quantise((yaw * 180) / Math.PI, 0.5);
  const inside = (x: number, y: number, margin: number) => Math.hypot(x - c, y - c) <= c - margin;

  const diamonds: (string | null)[] = new Array<string | null>(RADAR_SLOTS).fill(null);
  for (const b of snap.bots) {
    const slot = slotOf(b.id);
    if (slot < 0 || !b.alive || !b.revealed) continue;
    const p = worldToRadar(b.pos, pl, yaw, c, k);
    if (inside(p.x, p.y, 4)) diamonds[slot] = `translate(${fmt(p.x)} ${fmt(p.y)})`;
  }

  const pings: (RadarPing | null)[] = new Array<RadarPing | null>(RADAR_SLOTS).fill(null);
  for (const [id, ping] of fx.pings) {
    const slot = slotOf(id);
    if (slot < 0) continue;
    const p = worldToRadar(ping, pl, yaw, c, k);
    const opacity = quantise(pingOpacity(ping, snap.now), 0.05);
    if (opacity > 0 && inside(p.x, p.y, 0)) {
      pings[slot] = { transform: `translate(${fmt(p.x)} ${fmt(p.y)})`, opacity };
    }
  }

  const r = c - 8;
  return {
    groupTransform: `translate(${String(c)} ${String(c)}) scale(${String(k)}) rotate(${String(yawDeg)}) translate(${fmt(-pl.x)} ${fmt(-pl.z)})`,
    northTransform: `translate(${fmt(c + r * Math.sin(yaw))} ${fmt(c - r * Math.cos(yaw))})`,
    diamonds,
    pings,
  };
}

/** One SVG path `d` string for the map outline, built once per map load (PD-UI-10). */
export function radarOutlinePath(segments: ReadonlyArray<RadarSegment> | null): string {
  if (!segments) return '';
  const parts: string[] = [];
  for (const s of segments) {
    if (![s.x1, s.z1, s.x2, s.z2].every(Number.isFinite)) continue;
    parts.push(`M${fmt(s.x1)} ${fmt(s.z1)}L${fmt(s.x2)} ${fmt(s.z2)}`);
  }
  return parts.join('');
}
