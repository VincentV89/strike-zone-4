/**
 * HUD diff (PD-UI-3, PD-UI-5, PD-UI-6). The HUD has a fixed table of leaf fields (one per DOM
 * write target). diffHud compares leaf values and returns one patch per changed leaf, so the
 * patch count can never exceed HUD_LEAF_COUNT. The DOM writer only applies patches.
 */
import { MAX_ARCS, MAX_FEED } from './effects';
import { HIDDEN_HUD, type HudViewModel } from './hud-model';
import { RADAR_SLOTS } from './radar';

type Index5 = 0 | 1 | 2 | 3 | 4;
type Index20 = Index5 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19;

/** Closed vocabulary of HUD element ids (built once at mount). */
export type HudElementId =
  | 'hud'
  | 'health-value'
  | 'health-bar'
  | 'armor-value'
  | 'armor-bar'
  | 'weapon-label'
  | 'ammo-value'
  | 'ammo-cue'
  | 'reload-ring'
  | 'reload-arc'
  | `slot-${1 | 2 | 3}`
  | 'crosshair'
  | 'timer'
  | 'enemies'
  | 'kills'
  | 'countdown'
  | 'hit-marker'
  | `arc-${0 | 1 | 2 | 3}`
  | `feed-${Index5}`
  | 'radar-group'
  | 'radar-north'
  | `diamond-${Index20}`
  | `ping-${Index20}`
  | 'scoreboard'
  | 'scoreboard-stats'
  | `roster-${Index20}`
  | 'toast';

export type HudClass = 'is-scoped' | 'is-low-health' | 'is-warn' | 'is-headshot';
export type HudAttr = 'transform' | 'opacity' | 'data-kind' | 'data-state' | 'stroke-dashoffset';
export type HudStyle = 'transform' | 'opacity' | '--gap';

export type HudPatch =
  | { readonly el: HudElementId; readonly kind: 'text'; readonly value: string }
  | { readonly el: HudElementId; readonly kind: 'hidden'; readonly value: boolean }
  | {
      readonly el: HudElementId;
      readonly kind: 'class';
      readonly name: HudClass;
      readonly value: boolean;
    }
  | {
      readonly el: HudElementId;
      readonly kind: 'attr';
      readonly name: HudAttr;
      readonly value: string;
    }
  | {
      readonly el: HudElementId;
      readonly kind: 'style';
      readonly name: HudStyle;
      readonly value: string;
    };

export type LeafSpec =
  | { readonly el: HudElementId; readonly kind: 'text' | 'hidden' }
  | { readonly el: HudElementId; readonly kind: 'class'; readonly name: HudClass }
  | { readonly el: HudElementId; readonly kind: 'attr'; readonly name: HudAttr }
  | { readonly el: HudElementId; readonly kind: 'style'; readonly name: HudStyle };

type LeafValue = string | boolean;

interface Emitter {
  text(el: HudElementId, v: string): void;
  hidden(el: HudElementId, v: boolean): void;
  cls(el: HudElementId, name: HudClass, v: boolean): void;
  attr(el: HudElementId, name: HudAttr, v: string): void;
  style(el: HudElementId, name: HudStyle, v: string): void;
}

/** Circumference of the reload ring (r = 14): the dash offset runs from this to 0. */
export const RELOAD_RING_LENGTH = 88;

const id = (s: string): HudElementId => s as HudElementId;
const scale = (v: number) => `scaleX(${String(Math.round(Math.max(0, Math.min(100, v))) / 100)})`;

/** Walks every leaf in a fixed order. Used to build LEAVES once and values per model. */
function walk(vm: HudViewModel, e: Emitter): void {
  e.hidden('hud', !vm.visible);
  e.cls('hud', 'is-scoped', vm.scoped);
  e.cls('hud', 'is-low-health', vm.healthLow);
  e.text('health-value', String(vm.health));
  e.style('health-bar', 'transform', scale(vm.health));
  e.text('armor-value', String(vm.armor));
  e.style('armor-bar', 'transform', scale(vm.armor));
  e.text('weapon-label', vm.weaponLabel);
  e.text('ammo-value', vm.ammoText);
  e.text('ammo-cue', vm.ammoCue);
  e.hidden('reload-ring', vm.reloadProgress === null);
  e.attr(
    'reload-arc',
    'stroke-dashoffset',
    String(Math.round(RELOAD_RING_LENGTH * (1 - (vm.reloadProgress ?? 0)))),
  );
  vm.slots.forEach((s, i) => {
    e.attr(id(`slot-${String(i + 1)}`), 'data-state', s);
  });
  e.style('crosshair', '--gap', `${String(vm.crosshairGapPx)}px`);
  e.text('timer', vm.timerText);
  e.cls('timer', 'is-warn', vm.timerWarn);
  e.text('enemies', String(vm.enemiesRemaining));
  e.text('kills', String(vm.kills));
  e.text('countdown', vm.countdown);
  e.attr('hit-marker', 'data-kind', vm.hitMarker.kind);
  e.style('hit-marker', 'opacity', String(vm.hitMarker.opacity));
  for (let i = 0; i < MAX_ARCS; i++) {
    const a = vm.damageArcs[i];
    e.style(id(`arc-${String(i)}`), 'transform', `rotate(${String(a?.angleDeg ?? 0)}deg)`);
    e.style(id(`arc-${String(i)}`), 'opacity', String(a?.opacity ?? 0));
  }
  for (let i = 0; i < MAX_FEED; i++) {
    const f = vm.killFeed[i];
    const text = f && f.text !== '' ? `${f.text}${f.headshot ? ' · HEADSHOT' : ''}` : '';
    e.text(id(`feed-${String(i)}`), text);
    e.style(id(`feed-${String(i)}`), 'opacity', String(f?.opacity ?? 0));
  }
  const r = vm.radar;
  e.attr('radar-group', 'transform', r?.groupTransform ?? '');
  e.attr('radar-north', 'transform', r?.northTransform ?? '');
  for (let i = 0; i < RADAR_SLOTS; i++) {
    e.attr(id(`diamond-${String(i)}`), 'transform', r?.diamonds[i] ?? 'scale(0)');
  }
  for (let i = 0; i < RADAR_SLOTS; i++) {
    const p = r?.pings[i] ?? null;
    e.attr(id(`ping-${String(i)}`), 'transform', p ? p.transform : 'scale(0)');
    e.attr(id(`ping-${String(i)}`), 'opacity', p ? String(p.opacity) : '0');
  }
  const sb = vm.scoreboard;
  e.hidden('scoreboard', !sb.open);
  e.text(
    'scoreboard-stats',
    `Kills ${String(sb.kills)} · Deaths ${String(sb.deaths)} · Headshots ${String(sb.headshots)} · Accuracy ${sb.accuracy} · Enemies remaining ${String(sb.enemiesRemaining)}`,
  );
  for (let i = 0; i < RADAR_SLOTS; i++) {
    const row = sb.roster[i] ?? null;
    e.text(
      id(`roster-${String(i)}`),
      row ? `${row.label} · ${row.alive ? 'Alive' : 'Eliminated'}` : '',
    );
  }
  e.text('toast', vm.toast);
}

function buildLeaves(): ReadonlyArray<LeafSpec> {
  const specs: LeafSpec[] = [];
  walk(HIDDEN_HUD, {
    text: (el) => specs.push({ el, kind: 'text' }),
    hidden: (el) => specs.push({ el, kind: 'hidden' }),
    cls: (el, name) => specs.push({ el, kind: 'class', name }),
    attr: (el, name) => specs.push({ el, kind: 'attr', name }),
    style: (el, name) => specs.push({ el, kind: 'style', name }),
  });
  return Object.freeze(specs);
}

/** Every leaf, in write order. Its length is the per-frame patch ceiling. */
export const LEAVES: ReadonlyArray<LeafSpec> = buildLeaves();
export const HUD_LEAF_COUNT = LEAVES.length;
/** PERF-UI-05 ceiling. */
export const MAX_HUD_PATCHES = 128;

const valueCache = new WeakMap<HudViewModel, ReadonlyArray<LeafValue>>();

export function hudLeafValues(vm: HudViewModel): ReadonlyArray<LeafValue> {
  const cached = valueCache.get(vm);
  if (cached) return cached;
  const vals: LeafValue[] = [];
  const push = (_el: HudElementId, ...rest: readonly unknown[]) => {
    vals.push(rest[rest.length - 1] as LeafValue);
  };
  walk(vm, { text: push, hidden: push, cls: push, attr: push, style: push });
  valueCache.set(vm, vals);
  return vals;
}

function patchOf(spec: LeafSpec, value: LeafValue): HudPatch {
  switch (spec.kind) {
    case 'text':
      return { el: spec.el, kind: 'text', value: String(value) };
    case 'hidden':
      return { el: spec.el, kind: 'hidden', value: value === true };
    case 'class':
      return { el: spec.el, kind: 'class', name: spec.name, value: value === true };
    case 'attr':
      return { el: spec.el, kind: 'attr', name: spec.name, value: String(value) };
    case 'style':
      return { el: spec.el, kind: 'style', name: spec.name, value: String(value) };
  }
}

export const NO_PATCHES: ReadonlyArray<HudPatch> = Object.freeze([]);

/** `prev` undefined means a full write (mount or resetHud). */
export function diffHud(
  prev: HudViewModel | undefined,
  next: HudViewModel,
): ReadonlyArray<HudPatch> {
  if (prev === next) return NO_PATCHES;
  const b = hudLeafValues(next);
  const a = prev ? hudLeafValues(prev) : undefined;
  const out: HudPatch[] = [];
  for (let i = 0; i < LEAVES.length; i++) {
    const spec = LEAVES[i];
    const v = b[i];
    if (spec === undefined || v === undefined) continue;
    if (a?.[i] !== v) out.push(patchOf(spec, v));
  }
  return out;
}

/** Every element id the DOM must provide. */
export function hudElementIds(): ReadonlyArray<HudElementId> {
  return [...new Set(LEAVES.map((l) => l.el))];
}
