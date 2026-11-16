# StrikeZone game (`game/`)

Vite + TypeScript package for the browser game. It holds the **kernel** (`src/kernel/`), the scaffold every later unit builds on, **game-audio** (`src/audio/`), and a placeholder entry (`index.html`, `src/app/main.ts`) that app-shell replaces.

## Commands

Run from `game/` (or with `npm --prefix game run <script>` from the repository root).

| Command              | What it does                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `npm ci`             | Install the pinned devDependencies. There are no runtime dependencies yet.                     |
| `npm run verify`     | Release gate: lint, typecheck, tests with coverage, build, dist check, clean, advisory audit.  |
| `npm run lint`       | ESLint with `--max-warnings 0` (includes the import zones) and the Prettier check.             |
| `npm test`           | Vitest with v8 coverage. Kernel: 95% lines and 90% branches. Global: 80% lines.                |
| `npm run build`      | `vite build` into `dist/` (`index.html` at the root, hashed files under `dist/assets/`).       |
| `npm run check:dist` | Fails on inline scripts or `on*` handlers, external URLs in `dist/`, or a non-empty `public/`. |
| `npm run bench`      | Advisory kernel micro-benchmarks. Not part of verify.                                          |
| `npm run clean`      | Removes `dist/` and `coverage/`.                                                               |

The root `npm run verify` runs game verify, then infra verify (whose `cdk synth` rebuilds `game/dist`), then `game clean`.

## Layers and import zones

Cross-directory imports use the `@sz/<dir>` alias (tsconfig, Vite and Vitest). Imports starting with `../` are banned in `src/`. Other units import the kernel only through `@sz/kernel`.

| Layer | Directories                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L0    | `kernel` (imports nothing, no browser globals, no `Date`, `Math.random`, `crypto`, `import.meta`)                                                      |
| L1    | `maps`, `nav`, `player`, `weapons`, `combat`, `stats`, `ai` (bot-ai), `ai/perception`                                                                  |
| L2    | `sim`, `round`                                                                                                                                         |
| L3    | `physics` (Rapier only), `render`, `assets` (Three.js only), `ui`, `input`, `audio`, `diagnostics`, `persistence` (only zone allowed to touch storage) |
| L4    | `app`                                                                                                                                                  |

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

## Test support

`test/support/` holds port fakes (`createFakePhysics`, `createFakeMover`), `createRecordingBus`, `describePhysicsQueryContract`, the Web Audio fake (`createFakeWebAudio`) and `fnv1a` for literal determinism digests. world-maps runs the same contract suite against the Rapier adapter.

## Rules for later units

- Never put files in `public/`: Vite copies them unhashed and hosting caches them for a year.
- Add coverage exclusions only with a reason comment in `vitest.config.mts`.
