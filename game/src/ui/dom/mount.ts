/**
 * createUi: the ui facade (frontend-components "Public API", logical-components C12). It mounts
 * the static tree once (status regions, screen host, dialog host, HUD), renders ScreenModels,
 * runs the HUD pipeline steps 4–6 and calls `send` synchronously inside user activations. It never
 * calls requestPointerLock, never subscribes to the bus and never touches storage.
 */
import './styles.css';
import type { DomainEvent } from '@sz/kernel';
import type { RadarSegment } from '@sz/maps';
import type { GraphicsPreset, StorageStatus } from '@sz/persistence';
import {
  createEffects,
  effectsContext,
  reduceEffects,
  resetRound,
  takeAnnouncements,
  type HudEffects,
} from '@sz/ui/core/effects';
import { MAX_HUD_PATCHES, diffHud } from '@sz/ui/core/hud-diff';
import { createHudModeller, type HudInput, type HudViewModel } from '@sz/ui/core/hud-model';
import type { SendIntent } from '@sz/ui/core/intents';
import { RADAR_PX_PER_M, radarOutlinePath, type RadarInput } from '@sz/ui/core/radar';
import { isDialog, storageNote, type ScreenId, type ScreenModel } from '@sz/ui/core/screens';
import type { SimSnapshot } from '@sz/sim';
import { append, byTestId, focusEl, h, on, type Cleanup } from './el';
import { mountHud } from './hud';
import { buildView, type View } from './screens';

export interface UiEnv {
  /** prefers-reduced-motion: reduce (app-shell reads matchMedia). */
  readonly reducedMotion: () => boolean;
}

export interface UiStats {
  readonly patchesLastFrame: number;
  readonly maxPatches: number;
  readonly framesSkippedByMemo: number;
}

export interface Ui {
  /** Unmounts the previous screen or dialog and mounts this one; the same id patches in place. */
  showScreen(model: ScreenModel): void;
  /** Step 4: reduce the events app-shell drained from the bus this frame (FD-UI-5). */
  onEvents(
    events: ReadonlyArray<DomainEvent>,
    snap: SimSnapshot | undefined,
    graphics: GraphicsPreset,
  ): void;
  /** Steps 5–6: view model, diff and patch. */
  updateHud(input: Omit<HudInput, 'effects'>): void;
  /** Radar input for the loaded map; app-shell computes segments once per map load. */
  radarInput(): RadarInput;
  setRadarOutline(segments: ReadonlyArray<RadarSegment> | null): void;
  announce(textValue: string, politeness?: 'polite' | 'assertive'): void;
  setStorageStatus(s: StorageStatus): void;
  flashSaved(): void;
  /** HUD fault containment (performance-design-ui-hud §4): hide readouts, show the text line. */
  showHudFault(): void;
  /** Next round: un-hide readouts, reset effects and the memo, force a full HUD write. */
  resetHud(): void;
  /** Read-only effect state for app-shell (lastKilledBy, advisory, roundIndex). */
  effects(): Readonly<HudEffects>;
  stats(): UiStats;
  dispose(): void;
}

interface Mounted {
  readonly id: ScreenId;
  readonly view: View;
  readonly focusKey: string;
}

function focusKeyOf(m: ScreenModel): string {
  switch (m.id) {
    case 'pause':
      return `pause:${m.confirm?.action ?? ''}`;
    case 'settings':
      return `settings:${String(m.confirmReset)}`;
    case 'history':
      return `history:${String(m.confirmClear)}`;
    case 'loading':
      return `loading:${String(m.ready)}`;
    default:
      return m.id;
  }
}

export function createUi(root: HTMLElement, send: SendIntent, env: UiEnv): Ui {
  const cleanups: Cleanup[] = [];
  const status = h('div', {
    class: 'sz-sr-only',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
    'data-testid': 'status-region',
  });
  const alert = h('div', {
    class: 'sz-sr-only',
    'aria-live': 'assertive',
    'aria-atomic': 'true',
    'data-testid': 'alert-region',
  });
  const screenHost = h('div', { class: 'sz-screen-host', 'data-testid': 'screen-host' });
  const dialog = h('dialog', { class: 'sz-dialog', 'data-testid': 'dialog' });
  const hud = mountHud();
  const uiRoot = append(
    h('div', { id: 'ui-root', class: 'sz-ui', 'data-testid': 'ui-root' }),
    status,
    alert,
    screenHost,
    dialog,
    hud.root,
  );
  root.appendChild(uiRoot);

  let screen: Mounted | undefined;
  let modal: Mounted | undefined;
  /** The control that opened a dialog, so closing it returns focus there (BR-UI-41). */
  const openers = new Map<ScreenId, { screen: ScreenId; testid: string }>();
  let lastActivated: { screen: ScreenId; testid: string } | undefined;
  let storage: StorageStatus = 'persistent';

  const fx = createEffects();
  const modeller = createHudModeller();
  let lastVm: HudViewModel | undefined;
  let patchesLastFrame = 0;
  let maxPatches = 0;
  let radar: RadarInput = Object.freeze({ segments: null, pxPerM: RADAR_PX_PER_M, radiusPx: 130 });

  const reduced = () => {
    uiRoot.classList.toggle('is-reduced-motion', env.reducedMotion());
  };
  reduced();

  // Remember which control the user activated, for return focus after a dialog closes.
  cleanups.push(
    on(uiRoot, 'click', (e) => {
      const t = e.target instanceof Element ? e.target.closest('[data-testid]') : null;
      const current = modal ?? screen;
      if (t instanceof HTMLElement && current) {
        const testid = t.dataset['testid'];
        if (testid !== undefined) lastActivated = { screen: current.id, testid };
      }
    }),
  );

  // Esc on an open dialog (frontend-components focus rules, RD-4).
  cleanups.push(
    on(dialog, 'cancel', (e) => {
      e.preventDefault();
      if (!modal) return;
      if (modal.id === 'pause') {
        if (modal.focusKey === 'pause:') focusEl(byTestId(dialog, 'pause-resume-button'));
        else send({ kind: 'cancel' });
        return;
      }
      if (modal.focusKey === 'settings:true' || modal.focusKey === 'history:true') {
        send({ kind: 'cancel' });
        return;
      }
      send({ kind: 'close' });
    }),
  );

  function place(
    host: HTMLElement,
    prev: Mounted | undefined,
    m: ScreenModel,
  ): Mounted | undefined {
    const key = focusKeyOf(m);
    if (prev?.id === m.id && prev.focusKey === key && prev.view.update(m)) {
      return { id: m.id, view: prev.view, focusKey: key };
    }
    const active =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset['testid']
        : undefined;
    const sameScreen = prev?.id === m.id && prev.focusKey === key;
    prev?.view.dispose();
    prev?.view.root.remove();
    const v = buildView(m, send);
    if (!v) return undefined;
    host.appendChild(v.root);
    const restore = sameScreen && active !== undefined ? byTestId(v.root, active) : null;
    const opener = openers.get(prev?.id ?? m.id);
    const back = opener && opener.screen === m.id ? byTestId(v.root, opener.testid) : null;
    focusEl(restore ?? back ?? v.initialFocus());
    return { id: m.id, view: v, focusKey: key };
  }

  function closeModal(): void {
    if (!modal) return;
    modal.view.dispose();
    modal.view.root.remove();
    modal = undefined;
    if (dialog.open) dialog.close();
  }

  const ui: Ui = {
    showScreen(m) {
      if (isDialog(m.id)) {
        if (modal?.id !== m.id && lastActivated) openers.set(m.id, lastActivated);
        if (modal && modal.id !== m.id) closeModal();
        dialog.setAttribute('aria-labelledby', `${m.id}-dialog-title`);
        if (!dialog.open) dialog.showModal();
        modal = place(dialog, modal, m);
        const title = dialog.querySelector('h2');
        if (title) dialog.setAttribute('aria-labelledby', title.id);
        return;
      }
      const returning = modal?.id;
      closeModal();
      if (m.id === 'hud') {
        screen?.view.dispose();
        screen?.view.root.remove();
        screen = undefined;
        return;
      }
      if (returning !== undefined && screen?.id === m.id) {
        const opener = openers.get(returning);
        const target =
          opener && opener.screen === m.id ? byTestId(screen.view.root, opener.testid) : null;
        screen.view.update(m);
        focusEl(target ?? screen.view.initialFocus());
        return;
      }
      screen = place(screenHost, screen, m);
      if (m.id === 'end') ui.announce(m.title, 'assertive');
      if (m.id === 'main-menu') ui.setStorageStatus(m.storageStatus);
    },
    onEvents(events, snap, graphics) {
      reduceEffects(fx, events, effectsContext(snap, graphics));
      for (const a of takeAnnouncements(fx)) ui.announce(a);
    },
    updateHud(input) {
      const vm = modeller({ ...input, effects: fx });
      const patches = diffHud(lastVm, vm);
      lastVm = vm;
      hud.apply(patches);
      patchesLastFrame = patches.length;
      if (patches.length > maxPatches) maxPatches = Math.min(MAX_HUD_PATCHES * 2, patches.length);
    },
    radarInput: () => radar,
    setRadarOutline(segments) {
      radar = Object.freeze({ segments, pxPerM: RADAR_PX_PER_M, radiusPx: 130 });
      hud.setOutline(radarOutlinePath(segments));
    },
    announce(textValue, politeness = 'polite') {
      const region = politeness === 'assertive' ? alert : status;
      region.textContent = '';
      region.textContent = textValue;
    },
    setStorageStatus(s) {
      storage = s;
      uiRoot.querySelectorAll('[data-testid="storage-status"]').forEach((el) => {
        el.textContent = storageNote(storage);
      });
    },
    flashSaved() {
      // "✓ Saved" for 1.5 s with the Web Animations API: no timer in ui, and a repeat call
      // restarts it (PD-UI-15). The element rests at opacity 0 in styles.css.
      const frames = [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }];
      uiRoot.querySelectorAll('[data-testid="saved-indicator"]').forEach((el) => {
        for (const a of el.getAnimations()) a.cancel();
        el.animate(frames, { duration: 1500 });
      });
    },
    showHudFault() {
      hud.showFault();
    },
    resetHud() {
      // Clears the stores now; the round number advances when the RoundPhaseChanged loading → ready
      // event reaches onEvents, so it is restored here to avoid counting the round twice.
      hud.clearFault();
      resetRound(fx);
      fx.roundIndex = Math.max(0, fx.roundIndex - 1);
      modeller.reset();
      lastVm = undefined;
      reduced();
    },
    effects: () => fx,
    stats: () => ({ patchesLastFrame, maxPatches, framesSkippedByMemo: modeller.hits() }),
    dispose() {
      for (const c of cleanups.splice(0)) c();
      closeModal();
      screen?.view.dispose();
      screen = undefined;
      uiRoot.remove();
    },
  };
  return ui;
}
