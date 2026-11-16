/**
 * Frozen check catalogue (security-design-verification-suite SD-VS-1). The summariser builds
 * results.json from this table, not from raw Playwright output, so a check that never ran
 * cannot disappear and a row that is not catalogued fails. Specs take their titles from here.
 *
 * Node built-ins and erasable TypeScript only: scripts/e2e-summary.mjs imports this file
 * directly (Node 24 type stripping), and Playwright imports it through its own transpiler.
 */
export type CheckKind = 'browser' | 'webgl' | 'manual';
export type InputLabel = 'real' | 'injected';
export type CheckProject = 'local' | 'deployed' | 'both';

export interface Check {
  readonly id: string;
  readonly title: string;
  readonly requirements: ReadonlyArray<string>;
  /** browser: needs Chromium only. webgl: needs WebGL2 too. manual: a written procedure. */
  readonly kind: CheckKind;
  readonly input: InputLabel;
  readonly project: CheckProject;
  readonly seed?: number;
  /** Guard self-tests are expected to fail (test.fail()); their expected failure is a pass. */
  readonly selfTest?: boolean;
  /** Manual checks: the id of the written procedure in MANUAL_PROCEDURES. */
  readonly procedure?: string;
}

export const MAPS = ['desert-compound', 'industrial-warehouse'] as const;
export type E2eMapId = (typeof MAPS)[number];
export const BOT_MATRIX = [1, 5, 10, 20] as const;

const botCountChecks: Check[] = MAPS.flatMap((map) =>
  BOT_MATRIX.map((n): Check => ({
    id: `bot-count-${map}-${String(n)}`,
    title: `${map}: exactly ${String(n)} live bots at GO and on the HUD`,
    requirements: ['req-bot-count', 'req-automated-tests'],
    kind: 'webgl',
    input: 'injected',
    project: 'local',
    seed: 1000 + n,
  })),
);

const perMap = (
  prefix: string,
  title: string,
  requirements: ReadonlyArray<string>,
  seed: number,
): Check[] =>
  MAPS.map((map, i) => ({
    id: `${prefix}-${map}`,
    title: `${map}: ${title}`,
    requirements,
    kind: 'webgl',
    input: 'injected',
    project: 'local',
    seed: seed + i,
  }));

const CHECK_LIST: Check[] = [
  // Test-hook boundary (SD-VS-8). Runs locally and on the deployed URL.
  {
    id: 'hook-absent-without-flag',
    title: 'hook: window.__strikezone is undefined without ?e2e',
    requirements: ['contract-e2e-hook', 'SEC-VS-20'],
    kind: 'browser',
    input: 'real',
    project: 'both',
  },
  {
    id: 'hook-descriptor-frozen',
    title: 'hook: non-writable, non-configurable, non-enumerable and frozen',
    requirements: ['SEC-VS-21'],
    kind: 'browser',
    input: 'real',
    project: 'both',
  },
  {
    id: 'hook-tamper-sloppy',
    title: 'hook: sloppy-mode assignment and delete change nothing',
    requirements: ['SEC-VS-21'],
    kind: 'browser',
    input: 'real',
    project: 'both',
  },
  {
    id: 'hook-tamper-strict',
    title: 'hook: strict-mode assignment and delete throw TypeError without console errors',
    requirements: ['SEC-VS-21'],
    kind: 'browser',
    input: 'real',
    project: 'both',
  },
  {
    id: 'hook-hostile-inputs',
    title: 'hook: hostile seeds, ticks and setups return ok:false with no console error',
    requirements: ['SEC-VS-22'],
    kind: 'browser',
    input: 'real',
    project: 'both',
  },
  {
    id: 'hook-snapshot-aliasing',
    title: 'hook: mutating a snapshot leaves the next snapshot unchanged',
    requirements: ['SEC-VS-24', 'req-bot-no-cheat'],
    kind: 'webgl',
    input: 'injected',
    project: 'local',
    seed: 77,
  },
  // Load, menus and accessibility.
  {
    id: 'load-zero-console-errors',
    title: 'load: boots to an enabled Click to enter with zero console errors',
    requirements: ['req-no-console-errors', 'req-loading-screen'],
    kind: 'webgl',
    input: 'real',
    project: 'both',
  },
  {
    id: 'menus-main-options',
    title: 'menus: every main-menu option opens a working screen or control',
    requirements: ['req-main-menu', 'req-controls-about', 'req-match-setup'],
    kind: 'webgl',
    input: 'real',
    project: 'local',
  },
  {
    id: 'menus-keyboard-start',
    title: 'menus: keyboard-only path reaches the capture button and calls requestPointerLock',
    requirements: ['req-menu-accessibility', 'req-pointer-lock-look'],
    kind: 'webgl',
    input: 'real',
    project: 'local',
  },
  {
    id: 'settings-persist-reload',
    title: 'settings: a changed setting survives a page reload',
    requirements: ['req-settings-persistence'],
    kind: 'webgl',
    input: 'real',
    project: 'local',
  },
  {
    id: 'a11y-main-menu',
    title: 'a11y: main menu and Match Setup have no critical or serious axe violations',
    requirements: ['req-menu-accessibility', 'SEC-VS-50'],
    kind: 'webgl',
    input: 'real',
    project: 'local',
  },
  {
    id: 'a11y-settings',
    title: 'a11y: Settings has no critical or serious axe violations',
    requirements: ['req-menu-accessibility', 'SEC-VS-50'],
    kind: 'webgl',
    input: 'real',
    project: 'local',
  },
  {
    id: 'a11y-pause',
    title: 'a11y: Pause has no critical or serious axe violations',
    requirements: ['req-menu-accessibility', 'SEC-VS-50'],
    kind: 'webgl',
    input: 'injected',
    project: 'local',
    seed: 31,
  },
  {
    id: 'a11y-end',
    title: 'a11y: the end screen has no critical or serious axe violations',
    requirements: ['req-menu-accessibility', 'SEC-VS-50'],
    kind: 'webgl',
    input: 'injected',
    project: 'local',
    seed: 32,
  },
  // Gameplay through the hook (ADR-VS-3). All injected.
  {
    id: 'pause-freezes-round',
    title: 'pause: window blur opens Pause and freezes the timer and bots',
    requirements: ['req-pause-menu'],
    kind: 'webgl',
    input: 'injected',
    project: 'local',
    seed: 41,
  },
  {
    id: 'movement-wasd',
    title: 'movement: injected forward input moves the player and walls stop it',
    requirements: ['req-player-movement', 'req-player-collision'],
    kind: 'webgl',
    input: 'injected',
    project: 'local',
    seed: 42,
  },
  {
    id: 'firing-ammo',
    title: 'firing: injected fire spends ammo and reload refills the magazine',
    requirements: ['req-weapon-loadout', 'req-ammo-reload'],
    kind: 'webgl',
    input: 'injected',
    project: 'local',
    seed: 43,
  },
  ...botCountChecks,
  ...perMap('win', 'a round can be won (victory)', ['req-round-outcomes', 'req-map-common'], 50),
  ...perMap('lose', 'a round can be lost (defeat)', ['req-round-outcomes', 'req-map-common'], 60),
  {
    id: 'restart-10',
    title: 'restart: 10 consecutive restarts keep N bots and add no hook errors',
    requirements: ['req-round-reset'],
    kind: 'webgl',
    input: 'injected',
    project: 'local',
    seed: 70,
  },
  // Guard self-tests (SD-VS-6). Each must fail for the guard to be working.
  {
    id: 'guard-console-error',
    title: 'guard self-test: a console.error fails the test',
    requirements: ['SEC-VS-10'],
    kind: 'browser',
    input: 'real',
    project: 'local',
    selfTest: true,
  },
  {
    id: 'guard-page-error',
    title: 'guard self-test: an uncaught error fails the test',
    requirements: ['SEC-VS-10'],
    kind: 'browser',
    input: 'real',
    project: 'local',
    selfTest: true,
  },
  {
    id: 'guard-cross-origin',
    title: 'guard self-test: a cross-origin request fails the test',
    requirements: ['SEC-VS-11'],
    kind: 'browser',
    input: 'real',
    project: 'local',
    selfTest: true,
  },
  // Deployed URL (REL-VS-6).
  {
    id: 'deployed-headers',
    title: 'deployed: CSP, HSTS and nosniff on / and on an unknown path',
    requirements: ['req-deploy-verification', 'SEC-VS-13', 'req-hosting-security'],
    kind: 'browser',
    input: 'real',
    project: 'deployed',
  },
  {
    id: 'deployed-refresh-deep-path',
    title: 'deployed: a deep path returns the app (200 text/html) and boots',
    requirements: ['req-refresh-routing'],
    kind: 'browser',
    input: 'real',
    project: 'deployed',
  },
  {
    id: 'deployed-short-round',
    title: 'deployed: one short seeded round with zero console errors',
    requirements: ['req-deploy-verification', 'req-no-console-errors'],
    kind: 'webgl',
    input: 'injected',
    project: 'deployed',
    seed: 90,
  },
  // Manual-only (SEC-VS-04). No browser result can upgrade these.
  {
    id: 'manual-pointer-lock',
    title: 'manual: real pointer lock is acquired and mouse look feels right',
    requirements: ['req-pointer-lock-look'],
    kind: 'manual',
    input: 'real',
    project: 'local',
    procedure: 'MP-1',
  },
  {
    id: 'manual-audio-speakers',
    title: 'manual: sounds are audible, pan left and right, and respect volume',
    requirements: ['req-spatial-audio', 'req-audio-unlock'],
    kind: 'manual',
    input: 'real',
    project: 'local',
    procedure: 'MP-2',
  },
  {
    id: 'manual-fps-5-bots',
    title: 'manual: median FPS at least 60 with 5 bots on High at 1080p',
    requirements: ['req-perf-5-bots'],
    kind: 'manual',
    input: 'real',
    project: 'local',
    procedure: 'MP-3',
  },
  {
    id: 'manual-fps-20-bots',
    title: 'manual: median FPS at least 30 with 20 bots on Medium, no frame over 100 ms',
    requirements: ['req-perf-20-bots'],
    kind: 'manual',
    input: 'real',
    project: 'local',
    procedure: 'MP-4',
  },
  {
    id: 'manual-other-browsers',
    title: 'manual: the round loop works in Firefox and Safari',
    requirements: ['req-browser-support'],
    kind: 'manual',
    input: 'real',
    project: 'local',
    procedure: 'MP-5',
  },
  {
    id: 'manual-memory-growth',
    title: 'manual: browser memory does not grow over 10 restarts',
    requirements: ['req-round-reset'],
    kind: 'manual',
    input: 'real',
    project: 'local',
    procedure: 'MP-6',
  },
];

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export const CHECKS: ReadonlyArray<Check> = deepFreeze(CHECK_LIST);

/** Written steps for manual checks; the report copies these verbatim. */
export const MANUAL_PROCEDURES: Readonly<Record<string, string>> = deepFreeze({
  'MP-1':
    'Open the site in Chrome or Edge on a desktop. Click to enter, Start game, then click "Capture mouse and start". Confirm the cursor disappears, the view turns with the mouse, and pitch stops at straight up and down. Press Esc: Pause opens and the cursor returns.',
  'MP-2':
    'With speakers or headphones on, Click to enter (a click sound plays). In a round, fire each weapon and reload; let a bot fire from your left and confirm it pans left. Set Master volume to 0: nothing is audible. Set SFX to 0 with Master 100: effects stop, menu clicks remain.',
  'MP-3':
    'On the target desktop (record GPU, CPU, browser, resolution 1920x1080), open /?e2e, set Graphics to High, start Desert Compound with 5 bots. After 5 s of combat, run `__strikezone.frameStats()` in the console every 10 s for 60 s and record medianFps and worstMs.',
  'MP-4':
    'As MP-3, but Graphics Medium and 20 bots. Pass when medianFps is at least 30 and worstMs is at most 100 after the first 5 s. Also set High and confirm the Medium suggestion appears if FPS drops below 30.',
  'MP-5':
    'Repeat a full round (start, fight, win or lose, Play Again) in the latest Firefox and Safari. Record versions and any console errors.',
  'MP-6':
    'In Chrome, open DevTools Memory. Take a heap snapshot after round 1, Play Again 10 times, take another snapshot. The retained size should not grow round over round.',
});

export function checkById(id: string): Check | undefined {
  return CHECKS.find((c) => c.id === id);
}

/** Catalogue rows for one Playwright project (local or deployed). */
export function checksFor(project: 'local' | 'deployed'): ReadonlyArray<Check> {
  return CHECKS.filter((c) => c.project === project || c.project === 'both');
}

/** Title used for a spec: `<id> | <title>`, so the reporter can recover the id. */
export function specTitle(id: string): string {
  const c = checkById(id);
  if (c === undefined) throw new Error(`uncatalogued check id: ${id}`);
  return `${c.id} | ${c.title}`;
}
