# StrikeZone game (`game/`)

Vite + TypeScript package for the browser game. It holds the **kernel** (`src/kernel/`), the scaffold every later unit builds on, the **weapons-combat** library (`src/weapons/`, `src/combat/`), **game-audio** (`src/audio/`), and a placeholder entry (`index.html`, `src/app/main.ts`) that app-shell replaces.

## Commands

Run from `game/` (or with `npm --prefix game run <script>` from the repository root).

| Command              | What it does                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `npm ci`             | Install pinned dependencies. The only runtime dependency is `@dimforge/rapier3d-compat`.       |
| `npm run verify`     | Release gate: lint, typecheck, tests with coverage, build, dist check, clean, advisory audit.  |
| `npm run lint`       | ESLint with `--max-warnings 0` (includes the import zones) and the Prettier check.             |
| `npm test`           | Vitest with v8 coverage. Kernel, weapons, combat: 95% lines, 90% branches. Global: 80% lines.  |
| `npm run build`      | `vite build` into `dist/` (`index.html` at the root, hashed files under `dist/assets/`).       |
| `npm run check:dist` | Fails on inline scripts or `on*` handlers, external URLs in `dist/`, or a non-empty `public/`. |
| `npm run bench`      | Advisory kernel micro-benchmarks. Not part of verify.                                          |
| `npm run clean`      | Removes `dist/` and `coverage/`.                                                               |

The root `npm run verify` runs game verify, then infra verify (whose `cdk synth` rebuilds `game/dist`), then `game clean`.

## Layers and import zones

Cross-directory imports use the `@sz/<dir>` alias (tsconfig, Vite and Vitest). Imports starting with `../` are banned in `src/`. Other units import the kernel only through `@sz/kernel`.

| Layer | Directories                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| L0    | `kernel` (imports nothing, no browser globals, no `Date`, `Math.random`, `crypto`, `import.meta`)                                                     |
| L1    | `maps`, `nav`, `player`, `stats`, `ai` (bot-ai), `ai/perception`; `weapons` (kernel only) and `combat` (kernel and weapons only) have their own zones |
| L2    | `sim`, `round`                                                                                                                                        |
| L3    | `physics` (Rapier only), `render`, `assets` (Three.js only), `ui` and `ui/core`, `input`, `audio`, `diagnostics`, `persistence` (storage is injected) |
| L4    | `app`                                                                                                                                                 |

`src/ai/**` outside `perception` may not import `@sz/player`, `@sz/combat`, `@sz/sim` or `@sz/physics` (req-bot-no-cheat). The zones live as data in `eslint.zones.mjs`; `test/lint/zones.test.ts` generates a canary case for every entry. Loosening a zone needs a decision record.

## Kernel conventions

- Units are metres, seconds and radians. Degrees exist only at the settings/UI boundary.
- Right-handed, +Y up. Yaw 0 faces −Z, positive yaw turns left, positive pitch looks up (same as Three.js `rotation.y`).
- `FixedClock`: 1/60 s steps, at most 5 per frame; frames over 0.25 s are clamped and over-cap steps are dropped. Pause means not calling `advance` or `step`.
- `EventBus`: `emit` queues, `drain` delivers once per frame. Emits during a drain go to the next one. A throwing subscriber is reported once through `console.error`.
- `createRng(seed)`: mulberry32, pinned by golden-value tests. Not for security decisions.

## game-audio (`src/audio/`)

- `src/audio/core/**` is pure TypeScript (zone `audio core (L3-pure)`): cue table, DSP and recipes, bank synthesis and validation, event router, mixer, voice policy, listener geometry. It counts toward coverage (90 % lines, 85 % branches).
- `src/audio/web/**` is the Web Audio adapter (zone `audio adapter (L3)`, excluded from coverage, tested against `test/support/fake-web-audio.ts`). All AudioParam writes go through `web/params.ts`.
- Every sound is synthesised at boot into 48 kHz PCM from a seeded Rng. No audio file may be committed or shipped (`check:dist` and `test/audio/no-audio-files.test.ts`).
- No `AudioContext` exists before `unlock()`. app-shell wiring:

```ts
const audio = createAudio();
await audio.prepareBank(); // BootService step 'audio'; rejects { step: 'audio', retryable: true }
const off = bindAudioToEvents(bus, audio, PLAYER_ID); // once, at composition time
// Click to enter and every later UI activation:
void audio.unlock().then(() => audio.play('ui-click'));
// Each render frame, before bus.drain():
audio.setListener(eyePos, yaw);
// Settings and pause:
audio.setVolumes(master / 100, sfx / 100);
audio.duck(paused);
```

- Audio unavailable (no constructor, resume refused) gives a muted session and one `console.warn`, never `console.error`.

## Weapons and combat

- `@sz/weapons`: `WEAPON_TABLE` (deep-frozen, the only place weapon numbers live), `weaponStats(id)` for ids from outside, `createInventory`, `tickWeapon`, `requestReload`, `switchWeapon`, `setScoped`, `weaponView`. `tickWeapon` runs reload completion, switch, reload request, scope, fire and spread recovery in that order. A locked tick (countdown, dead) never fires.
- `@sz/combat`: `resolveShot` (one nearest-hit raycast per shot, range capped at the table value, shooter must be alive), `applyResolution` (events in the order ShotFired, ShotImpact, HitConfirmed, DamageTaken, ActorKilled), `applyDamage`, `createVitals`.
- Every exported function is total: hostile input gives a no-op, a `miss` or a clamped value, never a throw.
- Each shot draws exactly 3 values from the injected `Rng` (cone radius, cone angle, yaw kick); a tick without a shot draws none. match-loop may share one stream across holders.
- match-loop owns the call order (player, then bots by ascending id; resolve and apply each shot before the next holder fires), passes `locked: true` for dead holders, emits `NoiseEmitted` from `WEAPON_TABLE[w].noiseRadiusM` and disables dead actors' hitboxes.
- `test/combat/scenarios.test.ts` pins a 600-tick duel by snapshot and by an FNV-1a digest literal. A verify run that prints `Snapshots: N written` means a snapshot was missing: investigate before committing.

## Test support

`test/support/` holds port fakes (`createFakePhysics`, `createFakeMover`), `createRecordingBus`, `describePhysicsQueryContract`, `createCountingRng`, the weapon tick driver, the combat scene helpers, the Web Audio fake (`createFakeWebAudio`) and `fnv1a` for literal determinism digests. world-maps runs the same contract suite against the Rapier adapter.

## World, navigation and physics (world-maps)

- `@sz/maps`: map schema, authoring helpers (`box`, `wall`, `ramp`, `crate`, `chain`, …), `createMapCatalog([...])` (static validation, deep freeze, no global registry), `selectSpawns`, `collidersToRadarSegments`, and `desertCompound`. Imports only `@sz/kernel`.
- `@sz/nav`: `buildNavGraph(map, physics)` validates every link (length, slope, clearance, ground), requires one connected component and linked routes; `NavGraph` offers `findPath`, `findFlankPath`, reservations; `createPathBudget(4)`. Imports only `@sz/kernel` and `@sz/maps`.
- `@sz/physics`: the only Rapier importer. `initPhysics()` (boot step, dynamic import, retryable `BootError`), `createPhysicsHost()` (one live world; build nav graphs with `host.query`), `createPhysicsWorld(map)`, `DEFAULT_CHARACTER`. Per tick: moves, `syncHitboxes`, one `step(1/60)`, then combat raycasts.
- Map tests run every map in `test/maps/shipped-maps.ts` against real Rapier, including a link walk with the real character controller. Rapier suites skip only when `SZ_ALLOW_RAPIER_SKIP=1` is set.
- The build emits `assets/third-party-notices-<hash>.txt` (Rapier's Apache-2.0 licence); `check:dist` requires it.

## Menus, HUD and persistence (ui-hud)

- `@sz/persistence` (`src/persistence/`): `createStore({ storage, now, schedule, onStatus, onSaved })`. Four `strikezone:*` keys in `{ schemaVersion: 1, data }` envelopes; reads are validate-or-default (65,536-char cap, no reviver, per-field settings repair); any storage throw switches to a session-only memory store without logging. Settings writes are debounced 250 ms (`flush()` on `pagehide`); `recordRound(summary)` is idempotent and saves history (newest 20) plus the lifetime W/L record; `clearHistory()` keeps the record.
- `src/ui/core/` is pure and covered: effect reducers (hit marker, damage arcs, kill feed, radar pings, toast, announcer, live tally), the memoised `toHudViewModel`, `diffHud` (fixed leaf table, at most 128 patches per frame), the radar fair-play gate (`toRadarModel` draws only `alive && revealed` bots and heard shots), and the screen models and reducers (`applySetupChange`, `applySettingChange`, pause/abandon, end, history, loading, unsupported).
- `src/ui/dom/` (excluded from coverage, checked by Playwright later) is flat: `el.ts` helpers, `hud.ts` (pools built once, patch writer), `screens.ts`, `widgets.ts`, `mount.ts` (`createUi(root, send, env)`) and `styles.css` (tokens pinned to `TOKENS`). Every interactive element and HUD value has a `data-testid`; radar diamonds carry `data-bot`.
- app-shell (B8) owns the wiring: obtain `window.localStorage` inside a `try`, seed `createRound({ totals: store.record() })`, call `ui.onEvents(bus.drain(), snapshot, graphics)` then `ui.updateHud(...)` inside one `try` per frame (on a throw: `console.error` once, `ui.showHudFault()`, skip the HUD until the next round, then `ui.resetHud()`), call `ui.setRadarOutline(collidersToRadarSegments(map))` once per map load, and request pointer lock synchronously inside the `capture-and-start` and `resume` intents.

## Rules for later units

- Never put files in `public/`: Vite copies them unhashed and hosting caches them for a year.
- Add coverage exclusions only with a reason comment in `vitest.config.mts`.
