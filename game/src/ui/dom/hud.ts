/**
 * HUD mount and patch writer (logical-components C11, PD-UI-10). Every HUD node is built once;
 * pools are fixed (4 arcs, 5 feed rows, 20 diamonds, 20 pings, 20 roster rows). The writer only
 * applies patches from the tested core diff: no comparisons, no logic that can drift.
 */
import type { HudAttr, HudElementId, HudPatch } from '@sz/ui/core/hud-diff';
import { RELOAD_RING_LENGTH, hudElementIds } from '@sz/ui/core/hud-diff';
import { RADAR_SLOTS } from '@sz/ui/core/radar';
import { append, h, svg } from './el';

type Writable = HTMLElement | SVGElement;

export interface HudDom {
  readonly root: HTMLElement;
  apply(patches: ReadonlyArray<HudPatch>): void;
  setOutline(d: string): void;
  showFault(): void;
  clearFault(): void;
}

const RADAR_SIZE = 260;

function setHudAttr(el: Element, name: HudAttr, value: string): void {
  switch (name) {
    case 'transform':
      el.setAttribute('transform', value);
      return;
    case 'opacity':
      el.setAttribute('opacity', value);
      return;
    case 'data-kind':
      el.setAttribute('data-kind', value);
      return;
    case 'data-state':
      el.setAttribute('data-state', value);
      return;
    case 'stroke-dashoffset':
      el.setAttribute('stroke-dashoffset', value);
      return;
  }
}

function vitals(reg: (id: HudElementId, el: Writable) => Writable): HTMLElement {
  const row = (label: string, value: HudElementId, bar: HudElementId) =>
    append(
      h('div', { class: 'sz-vital' }),
      h('span', { class: 'sz-vital-label' }, label),
      reg(value, h('span', { class: 'sz-vital-value', 'data-testid': `hud-${value}` }, '0')),
      append(h('div', { class: 'sz-bar' }), reg(bar, h('div', { class: 'sz-bar-fill' }))),
    );
  return append(
    h('div', { class: 'sz-plate sz-vitals' }),
    append(h('span', { class: 'sz-low-icon', 'aria-hidden': 'true' }, '✚')),
    row('Health', 'health-value', 'health-bar'),
    row('Armor', 'armor-value', 'armor-bar'),
  );
}

function weapon(reg: (id: HudElementId, el: Writable) => Writable): HTMLElement {
  const ring = svg('svg', { class: 'sz-reload', viewBox: '0 0 32 32', focusable: 'false' });
  append(
    ring,
    svg('circle', { class: 'sz-reload-track', cx: '16', cy: '16', r: '14' }),
    reg(
      'reload-arc',
      svg('circle', {
        class: 'sz-reload-arc',
        cx: '16',
        cy: '16',
        r: '14',
        'stroke-dasharray': String(RELOAD_RING_LENGTH),
        'stroke-dashoffset': String(RELOAD_RING_LENGTH),
      }),
    ),
  );
  reg('reload-ring', ring);
  const slots = h('div', { class: 'sz-slots' });
  (['Rifle', 'Pistol', 'Sniper'] as const).forEach((label, i) => {
    const id = `slot-${String(i + 1)}` as HudElementId;
    slots.appendChild(
      reg(
        id,
        h('span', { class: 'sz-slot', 'data-testid': `hud-${id}` }, `${String(i + 1)} ${label}`),
      ),
    );
  });
  return append(
    h('div', { class: 'sz-plate sz-weapon' }),
    reg('weapon-label', h('span', { class: 'sz-weapon-label', 'data-testid': 'hud-weapon-label' })),
    reg('ammo-value', h('span', { class: 'sz-ammo', 'data-testid': 'hud-ammo-value' })),
    reg('ammo-cue', h('span', { class: 'sz-ammo-cue', 'data-testid': 'hud-ammo-cue' })),
    ring,
    slots,
  );
}

function radar(reg: (id: HudElementId, el: Writable) => Writable, outline: SVGPathElement) {
  const c = String(RADAR_SIZE / 2);
  const root = svg('svg', {
    class: 'sz-radar',
    viewBox: `0 0 ${String(RADAR_SIZE)} ${String(RADAR_SIZE)}`,
    focusable: 'false',
    'data-testid': 'hud-radar',
  });
  const defs = append(
    svg('defs'),
    append(svg('clipPath', { id: 'sz-radar-clip' }), svg('circle', { cx: c, cy: c, r: c })),
  );
  const world = append(
    svg('g', { 'clip-path': 'url(#sz-radar-clip)' }),
    reg('radar-group', svg('g')),
  );
  world.firstElementChild?.appendChild(outline);
  const marks = svg('g', { 'clip-path': 'url(#sz-radar-clip)' });
  for (let i = 0; i < RADAR_SLOTS; i++) {
    const ping = svg('circle', {
      class: 'sz-ping',
      r: '6',
      cx: '0',
      cy: '0',
      transform: 'scale(0)',
    });
    ping.dataset['testid'] = `hud-radar-ping-${String(i + 1)}`;
    marks.appendChild(reg(`ping-${String(i)}` as HudElementId, ping));
  }
  for (let i = 0; i < RADAR_SLOTS; i++) {
    const d = svg('polygon', {
      class: 'sz-diamond',
      points: '0,-4 4,0 0,4 -4,0',
      transform: 'scale(0)',
      'data-bot': `bot-${String(i + 1)}`,
    });
    d.dataset['testid'] = `hud-radar-diamond-${String(i + 1)}`;
    marks.appendChild(reg(`diamond-${String(i)}` as HudElementId, d));
  }
  const player = svg('polygon', {
    class: 'sz-radar-player',
    points: `${c},${String(RADAR_SIZE / 2 - 7)} ${String(RADAR_SIZE / 2 + 5)},${String(RADAR_SIZE / 2 + 5)} ${String(RADAR_SIZE / 2 - 5)},${String(RADAR_SIZE / 2 + 5)}`,
  });
  const north = reg('radar-north', svg('g', { class: 'sz-radar-north' }));
  north.appendChild(svg('circle', { r: '5', cx: '0', cy: '0' }));
  return append(
    root,
    defs,
    svg('circle', { class: 'sz-radar-bg', cx: c, cy: c, r: c }),
    world,
    marks,
    player,
    north,
  );
}

/** Builds the whole HUD once (frontend-components "Hud"). */
export function mountHud(): HudDom {
  const els = new Map<HudElementId, Writable>();
  const reg = <E extends Writable>(id: HudElementId, el: E): E => {
    els.set(id, el);
    return el;
  };
  const root = reg(
    'hud',
    h('div', { class: 'sz-hud', 'aria-hidden': 'true', 'data-testid': 'hud' }),
  );
  root.hidden = true;

  const crosshair = reg(
    'crosshair',
    h('div', { class: 'sz-crosshair', 'data-testid': 'hud-crosshair' }),
  );
  for (const side of ['t', 'r', 'b', 'l'])
    crosshair.appendChild(h('span', { class: `sz-cross-${side}` }));

  const top = append(
    h('div', { class: 'sz-plate sz-top' }),
    reg('timer', h('span', { class: 'sz-timer', 'data-testid': 'hud-timer' }, '0:00')),
    append(
      h('span', { class: 'sz-stat' }, 'Enemies '),
      reg('enemies', h('strong', { 'data-testid': 'hud-enemies' })),
    ),
    append(
      h('span', { class: 'sz-stat' }, 'Kills '),
      reg('kills', h('strong', { 'data-testid': 'hud-kills' })),
    ),
  );

  const marker = reg(
    'hit-marker',
    svg('svg', {
      class: 'sz-hit-marker',
      viewBox: '-12 -12 24 24',
      focusable: 'false',
      'data-testid': 'hud-hit-marker',
    }),
  );
  for (const [x1, y1, x2, y2] of [
    ['-10', '-10', '-4', '-4'],
    ['10', '-10', '4', '-4'],
    ['-10', '10', '-4', '4'],
    ['10', '10', '4', '4'],
  ] as const) {
    marker.appendChild(svg('line', { x1, y1, x2, y2 }));
  }

  const ring = h('div', { class: 'sz-damage-ring', 'data-testid': 'hud-damage-ring' });
  for (let i = 0; i < 4; i++)
    ring.appendChild(reg(`arc-${String(i)}` as HudElementId, h('div', { class: 'sz-arc' })));

  const feed = h('ol', { class: 'sz-feed', 'data-testid': 'hud-kill-feed' });
  for (let i = 0; i < 5; i++)
    feed.appendChild(
      reg(`feed-${String(i)}` as HudElementId, h('li', { class: 'sz-plate sz-feed-row' })),
    );

  const outline = svg('path', { class: 'sz-radar-outline', d: '' });

  const roster = h('ol', { class: 'sz-roster' });
  for (let i = 0; i < RADAR_SLOTS; i++)
    roster.appendChild(reg(`roster-${String(i)}` as HudElementId, h('li')));
  const board = reg(
    'scoreboard',
    append(
      h('section', { class: 'sz-plate sz-scoreboard', 'data-testid': 'hud-scoreboard' }),
      h('h2', {}, 'Scoreboard'),
      reg('scoreboard-stats', h('p', { 'data-testid': 'hud-scoreboard-stats' })),
      roster,
    ),
  );
  board.hidden = true;

  const fault = h(
    'p',
    { class: 'sz-plate sz-hud-fault', 'data-testid': 'hud-fault' },
    'HUD unavailable — Pause (Esc) still works',
  );
  fault.hidden = true;

  append(
    root,
    h('div', { class: 'sz-vignette' }),
    h('div', { class: 'sz-scope', 'data-testid': 'hud-scope' }),
    crosshair,
    top,
    reg('countdown', h('div', { class: 'sz-countdown', 'data-testid': 'hud-countdown' })),
    marker,
    ring,
    feed,
    radar(reg, outline),
    vitals(reg),
    weapon(reg),
    board,
    reg('toast', h('p', { class: 'sz-plate sz-toast', 'data-testid': 'hud-toast' })),
    fault,
  );

  for (const id of hudElementIds()) {
    if (!els.has(id)) throw new Error(`mountHud: no element for ${id}`);
  }

  return {
    root,
    apply(patches) {
      for (const p of patches) {
        const el = els.get(p.el);
        if (!el) continue;
        switch (p.kind) {
          case 'text':
            el.textContent = p.value;
            break;
          case 'hidden':
            el.toggleAttribute('hidden', p.value);
            break;
          case 'class':
            el.classList.toggle(p.name, p.value);
            break;
          case 'attr':
            setHudAttr(el, p.name, p.value);
            break;
          case 'style':
            el.style.setProperty(p.name, p.value);
            break;
        }
      }
    },
    setOutline(d) {
      outline.setAttribute('d', d);
    },
    showFault() {
      root.classList.add('is-faulted');
      fault.hidden = false;
    },
    clearFault() {
      root.classList.remove('is-faulted');
      fault.hidden = true;
    },
  };
}
