/**
 * Display formatting (business-logic-model-ui-hud §9.3). Pure; labels are derived, never stored.
 */
import { parseActorId, PLAYER_ID, type ActorId, type MapId, type WeaponId } from '@sz/kernel';
import type { SessionTotals } from '@sz/stats';

/** m:ss. `mode` ceil is for the live timer (opens at 3:00, shows 0:00 only at expiry). */
export function formatClock(seconds: number, mode: 'floor' | 'ceil' = 'floor'): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = mode === 'ceil' ? Math.ceil(seconds - 1e-9) : Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(m)}:${s < 10 ? '0' : ''}${String(s)}`;
}

/** "41%"; 0 shots shows "0%" (req-match-stats AC3). */
export function formatAccuracy(pct: number): string {
  return `${String(Number.isFinite(pct) ? Math.round(pct) : 0)}%`;
}

const WEAPON_LABELS: ReadonlyMap<WeaponId, string> = new Map([
  ['rifle', 'Rifle'],
  ['pistol', 'Pistol'],
  ['sniper', 'Sniper'],
]);

export function weaponLabel(w: WeaponId): string {
  return WEAPON_LABELS.get(w) ?? 'Weapon';
}

/** 'player' → "You", bot-12 → "Bot-12", anything else → "Bot". */
export function actorLabel(id: ActorId | string): string {
  const r = parseActorId(id);
  if (!r.ok) return 'Bot';
  if (r.value === PLAYER_ID) return 'You';
  return `Bot-${r.value.slice(4)}`;
}

/** 1-based bot number for bot-n, 0 for the player or an invalid id. */
export function botNumber(id: ActorId | string): number {
  const r = parseActorId(id);
  return r.ok && r.value !== PLAYER_ID ? Number(r.value.slice(4)) : 0;
}

/** "Record W a · L b" (FD-UI-1: lifetime, never "Session"). */
export function recordLine(t: SessionTotals): string {
  return `Record W ${String(t.roundsWon)} · L ${String(t.roundsLost)}`;
}

const MAP_NAMES: ReadonlyMap<MapId, string> = new Map([
  ['desert-compound', 'Desert Compound'],
  ['industrial-warehouse', 'Industrial Warehouse'],
]);

/** Fallback map names when no catalog summary is at hand. */
export function mapName(id: MapId): string {
  return MAP_NAMES.get(id) ?? 'Unknown map';
}

const DIFFICULTY_LABELS: ReadonlyMap<string, string> = new Map([
  ['easy', 'Easy'],
  ['normal', 'Normal'],
  ['hard', 'Hard'],
]);

export function difficultyLabel(d: string): string {
  return DIFFICULTY_LABELS.get(d) ?? 'Normal';
}

/** Quantises to `step` so float noise never causes a DOM write (PD-UI-4). */
export function quantise(v: number, step: number): number {
  if (!Number.isFinite(v)) return 0;
  const q = Math.round(v / step) * step;
  return Math.round(q * 1000) / 1000;
}
