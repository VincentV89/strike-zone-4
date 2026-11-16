# StrikeZone — Final Report

This report follows spec §16 sections A to H. Every figure in section G is copied from an evidence file written by a script (`game/evidence/verify-summary.json`, `game/evidence/verify.log`, `game/evidence/bot-states.json`, `game/e2e-results/results.json`, `game/e2e-results/results-deployed.json`) or from a command's exit code recorded on 2026-11-16 at commit `6f7b30784d4e12b89f95c5c18f397d3485b3a7f4` plus this Bolt's uncommitted changes. Where a check did not run, this report says so.

**Summary of status.** The game, its tests and the CDK app are complete and the release gate (`npm run verify`) passes. Two things have **not** been done in this build environment:

1. **No AWS deployment exists.** The deploy preflight stopped with exit 2 (no AWS region) and the runtime has no AWS credentials. There is therefore no live URL, account ID or deployed resource list yet. Section D lists the commands that complete it.
2. **No browser test has run.** Chromium cannot start here (`libglib-2.0.so.0` is missing and there is no root access to install it). All 33 local and 9 deployed browser checks are recorded as `not-run`, and the 6 checks that need real hardware are `manual-only`. The suite is ready to run on any machine with Chromium's system libraries.

## A. Live game

| Item | Value |
|---|---|
| Public HTTPS URL | **Not available: not deployed** (preflight exit 2, no region; no credentials). After `npm run deploy` the URL is the `SiteUrl` output in `infra/cdk-outputs.json` (`https://<id>.cloudfront.net/`). |
| Supported browsers | Target: latest desktop Chrome and Edge (WebGL2, pointer lock, Web Audio). **Verified in a browser: none** (see G). Firefox and Safari: not verified, manual procedure MP-5. Touch-only devices and viewports under 1024 px get a notice. |
| How to start playing | Open the URL, wait for loading to finish, press **Click to enter**, choose map, bot count (1, 2, 3, 5, 8, 10, 15, 20) and difficulty on the main menu, press **Start game**, then **Capture mouse and start** (click, Enter or Space). A 3 s countdown starts the round. |

**Controls**

| Input | Action |
|---|---|
| W A S D | Move |
| Mouse (pointer lock) | Look and aim |
| Left mouse | Fire (rifle: hold for automatic fire) |
| Right mouse | Scope (sniper) |
| Shift | Sprint |
| C | Crouch (C instead of Ctrl, because Ctrl+W closes the browser tab) |
| Space | Jump |
| R | Reload |
| 1, 2, 3 or mouse wheel | Rifle, pistol, sniper |
| Tab (hold) | Scoreboard |
| Esc | Pause (Resume needs a click or Enter on the Resume button) |

## B. Implemented features

| Area | What exists |
|---|---|
| Maps | **Desert Compound** (96 × 96 m, 4 routes, roof reached by ramps, 6 player and 24 bot spawns) and **Industrial Warehouse** (80 × 80 m open-top hall, 3 routes, elevated east gantry at 4 m, 6 player and 24 bot spawns). Both have collision on every solid, a hand-authored nav graph checked for connectivity, and spawns 20 m or more apart with no line of sight. |
| Weapons | Rifle (28 damage, 0.1 s interval, 30/90, automatic), pistol (22, 0.15 s, 15/45, one shot per press), sniper (90, 1.3 s, 5/20, 25° scope). Headshot ×4 for all. Spread grows with sustained fire and movement, recoil kicks the view. Hitscan with one raycast per shot; walls block shots; armor absorbs half of each hit until it runs out. |
| CPU AI | Seven-state finite state machine: Patrol, Investigate, Engage, Take Cover, Flank, Retreat, Dead, driven by a 28-row transition table. Bots perceive the player only through sight (field of view, range by difficulty, line of sight) and gunfire noise, through a separate perception module. Decisions run at 10 Hz, staggered across bots; A* paths with a per-tick budget; stuck detection and re-planning; flanking bots reserve different routes. |
| Bot counts | Exactly 1, 2, 3, 5, 8, 10, 15 or 20. |
| Difficulty | Easy, Normal, Hard. Reaction time 0.7–0.9 / 0.4–0.55 / 0.2–0.3 s; aim error 6° / 3.5° / 1.8°; cover chance 0.25 / 0.55 / 0.85; flank chance 0.05 / 0.25 / 0.5; vision 35 / 45 / 55 m. Health is 100 on every level. |
| Game mode | One round against all bots. Victory when every bot is dead; defeat when the player dies or the timer (2, 3, 5 or 10 min) expires ("Time Expired"). Restart and Play Again reset the round without a page reload. Abandoning a live round asks for confirmation and counts as a loss. |
| HUD and menus | Health, armor, weapon and ammo, crosshair, timer, enemies left, kills, hit markers, directional damage ring, kill feed, radar (shows only bots the player has seen or heard), Tab scoreboard, countdown, end-of-round statistics. Loading screen with step progress and per-step retry; main menu with match setup; Settings (sensitivity, master and effects volume, graphics Low/Medium/High, FOV 60–110, round length); Controls; About; match history; Pause. Settings, last setup, history and the win/loss record persist in localStorage with validation. |
| Audio and graphics | All sounds are synthesised at boot and all textures and models are generated in code; no asset files are shipped. Spatial audio starts only after the first click. Sun shadows on Medium and High. |

Not delivered or not verified: no feature from the spec was cut. Items that work in code but have no browser verification are listed in G.

## C. Technical architecture

| Concern | Choice | Reason |
|---|---|---|
| Game engine | No engine. Own fixed-step (60 Hz) simulation in framework-free TypeScript, rendered with **Three.js 0.187** (WebGL2) | Keeps all game logic testable in Node with Vitest, separate from rendering |
| Frontend framework | None. Plain TypeScript DOM overlays for menus and HUD, built with **Vite 8** | The UI is small; a framework would add bundle size and another layer to test |
| Physics engine | **Rapier 0.21** (`@dimforge/rapier3d-compat`, WebAssembly) behind two narrow ports | One collision source for movement and raycasts; runs in Node for tests |
| AI architecture | Perception module (only it sees the player) → per-bot brain FSM with a data-driven transition table → per-tick intents; bots use the same weapon and damage code as the player | Bots cannot cheat by construction; ESLint import zones fail the build if bot code imports player, physics or simulation code |
| Navigation | Hand-authored waypoint graph per map, validated at boot with physics ray checks; A* with an LRU cache and a per-tick query budget; flank paths avoid reserved routes | Predictable, fast, and testable for connectivity |
| AWS services | Amazon S3 (private bucket), Amazon CloudFront (Origin Access Control, HTTPS redirect, security headers), AWS Lambda only for CDK's deployment and cleanup helpers, CloudWatch Logs (7-day log group) | Static game, no backend, pay-per-use, about US$0.10 per month |

The code is a layered modular monolith (`game/src/`): kernel → domain (maps, nav, player, weapons, combat, ai, stats) → application (sim, round) → adapters (physics, render, assets, audio, input, ui, persistence, diagnostics) → app shell. Layer rules are lint-enforced in `npm run verify`.

## D. AWS deployment

| Item | Value |
|---|---|
| AWS account ID | **Not determined.** No credentials in this environment. |
| AWS region | **Not set.** Preflight output: `preflight: no region resolved — set AWS_REGION or a profile region` (exit 2). |
| CDK application structure | One CDK v2 TypeScript app in `infra/` (`bin/strikezone.ts`, `lib/app.ts`, `lib/hosting-stack.ts`, `lib/security-headers.ts`), run with `npx cdk` from the local `aws-cdk` devDependency |
| CloudFormation stacks | `StrikeZoneHosting` (one stack) |
| Resources defined (from the synthesized template, not deployed) | S3 bucket (`SiteBucket`), its bucket policy, CloudFront distribution with OAC, response headers policy, two BucketDeployment custom resources with their Lambda handler and layers, the S3 auto-delete custom resource and provider Lambda, their IAM roles, and a CloudWatch log group (`DeployLogGroup`) |
| CloudFront distribution URL | **Not available: not deployed.** |
| Stack status, smoke checks | **not-run** (deploy stopped at preflight) |

To complete deployment (account owner):

```sh
export AWS_REGION=<region>              # plus credentials via AWS_PROFILE or environment
npx --prefix infra cdk bootstrap        # only if preflight exits 4 (account not bootstrapped)
npm run deploy                          # preflight, cdk deploy --all, stack-status, smoke
npm --prefix game run e2e:deployed      # browser checks against the deployed SiteUrl
```

## E. Deployment commands

Rebuild and deploy from the repository root:

```sh
npm --prefix game ci && npm --prefix infra ci
npm run verify
npm run deploy                 # runs preflight, then npx cdk deploy --all, then checks
```

The required CDK command, run from `infra/`:

```sh
npx cdk deploy --all
```

(`cdk.json` builds `game/dist` before synthesis.)

## F. Cleanup commands

```sh
npm run destroy                # runs npx cdk destroy --all in infra/, with a confirmation prompt
```

The required CDK command, run from `infra/`:

```sh
npx cdk destroy --all
```

This removes every resource in `StrikeZoneHosting`, including the bucket's objects. Shared infrastructure that remains:

- The **CDK bootstrap stack** `CDKToolkit` and its asset bucket `cdk-hnb659fds-assets-<account>-<region>` (shared by all CDK apps in the account and region).
- The **S3 auto-delete provider's Lambda log group** (`/aws/lambda/StrikeZoneHosting-CustomS3AutoDeleteObjects…`), which Lambda creates implicitly. `infra/README.md` shows how to delete it.

`cdk destroy` was not run during validation.

## G. Testing evidence

### G.1 Release gate: `npm run verify:evidence` (exit 0)

Source: `game/evidence/verify-summary.json` and `game/evidence/verify.log`, finished 2026-11-16T11:50:58Z.

| Step | Result |
|---|---|
| Secret scan of the source tree | `scan:secrets PASS` |
| Game lint (ESLint with import zones, zero warnings) and Prettier | passed |
| Game type-check (`tsc --noEmit`, includes e2e specs) | passed |
| Game Vitest | **111 files, 3,291 tests passed**, 0 failed, 0 skipped; 0 snapshots written; Rapier suites ran (not skipped) |
| Game coverage | All files 98.09 % statements, 93.69 % branches, 99.05 % lines; every per-directory threshold met (no threshold misses in the log) |
| Build and dist check | `check:dist PASS`; bundle gate `1,860,996 B gzip of 2,500,000 B` (main chunk 213,670 B gzip, Rapier chunk 1,644,885 B gzip); no external URLs, eval, secrets, test-tooling markers or binary assets in `dist/` |
| Infra Vitest | **6 files, 80 tests passed** (CDK assertion tests, script tests) |
| Infra `cdk synth` | passed (with a real `game/dist` build) |
| `npm audit` (advisory) | game: 7 moderate, infra: 8 moderate, all from one minimatch advisory via typescript-eslint and aws-cdk-lib; 0 high |

Vitest covers, among others: weapon and damage rules, the 28 bot transitions and guards, perception limits, pathfinding and flanking, map validation and nav connectivity on both maps against real Rapier, spawn rules for 20 bots, round outcomes and restart leak checks (10 restarts), a 1,800-tick determinism digest, persistence validation, the HUD diff, the screen machine, and the e2e summariser and secret scanner.

### G.2 Bot state machine evidence (passed)

Source: `game/evidence/bot-states.json`, written by `game/test/evidence/bot-states.test.ts` inside verify. Two seeded headless rounds on Desert Compound with real sim, bot AI, weapons and combat on the box-world physics fake (not Rapier, not a browser):

| State | Entries |
|---|---|
| Patrol (initial; counted only when re-entered) | 10 |
| Investigate | 17 |
| Engage | 47 |
| Take Cover | 6 |
| Flank | 13 |
| Retreat | 11 |
| Dead | 5 |

All seven states were entered. A separate bot-ai arena test also drives one bot through all seven states.

### G.3 Browser tests: `npm --prefix game run e2e` (exit 3)

Source: `game/e2e-results/results.json`. Chromium could not launch:

> `chrome-headless-shell: error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file: No such file or directory`

| Status | Count |
|---|---|
| passed | 0 |
| failed | 0 |
| flaky | 0 |
| manual-only | 6 |
| not-run | 33 |

The 33 local checks that did **not** run: test-hook boundary (absent without `?e2e`, frozen, tamper-proof, hostile inputs, snapshot aliasing), zero console errors on load, every main-menu option, keyboard-only start with a pointer-lock spy, settings persistence across reload, axe accessibility scans of the main menu, Settings, Pause and end screen, pause freezing the round, movement and wall collision, firing and reload, bot counts 1, 5, 10 and 20 on both maps, a win and a loss on each map, 10 restarts, and three guard self-tests. Gameplay checks drive the player through the `?e2e` hook and are labelled `injected`; the win scenarios aim using bot positions from the hook's snapshot, which is test-harness code and never reaches bot AI.

### G.4 Deployed checks: `npm --prefix game run e2e:deployed` (exit 3)

Source: `game/e2e-results/results-deployed.json`. All 9 checks `not-run`, reason `no-deployed-url` (headers on `/` and an unknown path, deep-path refresh, a short round, hook boundary, load).

### G.5 Manual-only checks (procedures not yet performed)

| Id | Check | Procedure |
|---|---|---|
| MP-1 | Real pointer lock and mouse look | Open the site in Chrome or Edge, Click to enter, Start game, Capture mouse and start. The cursor disappears, the view follows the mouse, pitch stops at straight up and down; Esc opens Pause |
| MP-2 | Audible, panned sound and volume | Fire and reload each weapon; a bot firing from the left pans left; Master 0 is silent; SFX 0 with Master 100 leaves menu clicks only |
| MP-3 | 60 FPS with 5 bots (req-perf-5-bots) | On the target desktop at 1920×1080, open `/?e2e`, Graphics High, Desert Compound with 5 bots; after 5 s run `__strikezone.frameStats()` every 10 s for 60 s; record GPU, CPU, browser, medianFps and worstMs |
| MP-4 | 30 FPS with 20 bots on Medium (req-perf-20-bots) | As MP-3 with Medium and 20 bots; pass at medianFps ≥ 30 and worstMs ≤ 100 after 5 s; on High confirm the Medium suggestion appears below 30 FPS |
| MP-5 | Firefox and Safari | Play a full round and Play Again in the latest versions; record versions and console errors |
| MP-6 | No memory growth over 10 restarts | DevTools heap snapshot after round 1 and after 10 Play Again; retained size does not grow |

### G.6 Performance observations

- **Frame rate: not measured.** No GPU or working browser here (MP-3, MP-4).
- **CPU-only sim tick** (`npm --prefix game run bench`, `test/bench/sim-tick.bench.ts`, advisory, this ARM64 runtime, Node 24.19.0): mean 0.29 ms / p99 0.80 ms with 5 bots on Rapier; mean 0.65 ms / p99 1.64 ms with 20 bots on Rapier (box-world fake: 0.34 / 1.39 ms and 0.85 / 1.25 ms). This is simulation CPU time only, not FPS; it leaves room inside a 16.7 ms frame but says nothing about rendering cost.
- **First-load size:** 1,860,996 B gzip of JS and CSS, of which Rapier is 1,644,885 B.

### G.7 Known limitations

- Not deployed; no live URL (D).
- No browser verification of any kind in this environment, including rendering, shadows, WebGL context loss, audio, pointer lock and console cleanliness in a real page.
- Headless WebGL2 through SwiftShader is untested, so even on a machine where Chromium starts, rendering checks may be reported `manual-only`.
- Determinism is verified Node-to-Node only.
- The `?e2e` test hook ships in the production bundle (installed only with the URL flag; single-player, no server).
- The secret scan of the source tree matches AWS secret-key and session-token setting names only when a value is assigned, so that hosting-infra's own detection patterns do not fail it; shipped `dist/` files and evidence use the strict check that fails on any mention.

## H. Source code

| Item | Location |
|---|---|
| Source code | This repository: `game/` (game), `infra/` (CDK app), root `package.json` (scripts only) |
| README | [README.md](README.md) (build, develop, release order, deploy, cleanup), plus [game/README.md](game/README.md) and [infra/README.md](infra/README.md) |
| Build | `npm --prefix game ci && npm --prefix game run build` |
| Development | `npm --prefix game run dev` |
| Deployment | `npm run deploy` (`npx cdk deploy --all` in `infra/`) |
| Cleanup | `npm run destroy` (`npx cdk destroy --all` in `infra/`) |

Project structure:

```
game/
  src/        kernel, maps, nav, player, weapons, combat, ai, stats, sim, round,
              physics, render, assets, audio, input, ui, persistence, diagnostics, app
  test/       Vitest unit, integration and evidence tests (incl. test/support fakes)
  e2e/        Playwright specs and harness (support/: catalogue, guard, hook client)
  scripts/    check-dist, scan-secrets, e2e-summary, run-e2e, run-logged
infra/
  bin/, lib/  CDK app and the StrikeZoneHosting stack
  scripts/    preflight, stack-status, smoke
  test/       CDK assertion and script tests
```

Test tooling licences (devDependencies only, not shipped): `@playwright/test` 1.65.1 (Apache-2.0), `@axe-core/playwright` 4.14.0 and `axe-core` (MPL-2.0). Shipped third-party code: three.js (MIT) and Rapier (Apache-2.0), with notices in a hashed `third-party-notices-*.txt` in `dist/assets/`.
