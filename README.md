# StrikeZone

StrikeZone is a single-player, browser-based 3D tactical shooter played against autonomous CPU bots. It runs entirely in the browser (TypeScript, Three.js, Rapier, Vite) and is served as a static site from a private S3 bucket through CloudFront, deployed by one AWS CDK v2 TypeScript app.

The final report with features, architecture, deployment details and testing evidence is in [REPORT.md](REPORT.md).

## Repository layout

| Path      | What it is                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `game/`   | The game: a Vite + TypeScript npm package. Source in `game/src/`, Vitest tests in `game/test/`, Playwright specs in `game/e2e/`. See [game/README.md](game/README.md). |
| `infra/`  | The hosting: one CDK v2 app with one stack, `StrikeZoneHosting`. See [infra/README.md](infra/README.md).         |
| `package.json` | Root scripts only (`verify`, `verify:evidence`, `deploy`, `destroy`). There are no npm workspaces.          |

## Prerequisites

- Node.js 22 or later (built and tested with Node 24.19.0 and npm 11.17.0).
- For deploy only: AWS credentials from the default provider chain, a region (`AWS_REGION` or the profile; there is no default), and an account bootstrapped with `cdk bootstrap`. The AWS CLI is not needed.
- For browser tests only: Playwright's Chromium (`npx --prefix game playwright install chromium`) and the system libraries it needs (on Debian or Ubuntu, `npx --prefix game playwright install-deps chromium`, which needs root).

## Build

```sh
npm --prefix game ci
npm --prefix infra ci
npm --prefix game run build      # writes game/dist (index.html plus hashed assets)
```

## Develop

```sh
npm --prefix game run dev        # Vite dev server with hot reload
npm --prefix game run preview    # serve a built game/dist locally
```

Open the printed URL in Chrome or Edge on a desktop. Add `?e2e` to the URL to install the test hook `window.__strikezone` (used by the browser tests and the manual FPS procedure).

## Release order

There is no hosted CI. Run these in order from the repository root:

| # | Command | What it does | Exit codes |
|---|---|---|---|
| 1 | `npm run verify` (or `npm run verify:evidence` to also capture `game/evidence/verify.log` and `verify-summary.json`) | Secret scan of the source tree, then game verify (lint, type-check, Vitest with coverage, build, dist check, advisory audit), infra verify (lint, type-check, tests, `cdk synth`), and a final clean of build outputs | 0 pass, non-zero fail |
| 2 | `npm --prefix game run e2e` | Builds the game, runs Playwright against `vite preview` on `127.0.0.1:4173`, and writes `game/e2e-results/results.json` and `results.md` | 0 all passed, 1 a check failed or did not record a result, 2 only flaky checks, 3 the browser could not launch (every row `not-run`) |
| 3 | `npm run deploy` | hosting-infra preflight, `cdk deploy --all`, stack-status and smoke checks | preflight: 2 no region, 3 no credentials, 4 not bootstrapped |
| 4 | `npm --prefix game run e2e:deployed` | Playwright against the deployed URL (`E2E_BASE_URL`, or `SiteUrl` from `infra/cdk-outputs.json`), writes `results-deployed.json` | as step 2; 3 also when no deployed URL is known |
| 5 | `npm --prefix game run clean:evidence` | Removes `game/e2e-results/` and `game/evidence/` after the report has been written | 0 |

A green `verify` does not mean "tested in a browser". Browser results are only in the e2e results files, where every check has one of these statuses: `passed`, `failed`, `flaky` (passed only on a retry), `manual-only` (a written procedure, see `game/e2e/support/checks.ts`), or `not-run`. Nothing turns `not-run` or `manual-only` into `passed`.

Other useful commands:

```sh
npm --prefix game run bench                # advisory benchmarks, including sim tick time (CPU only, not FPS)
npm --prefix infra run preflight           # read-only AWS check: region, identity, bootstrap
npm --prefix infra run smoke -- <SiteUrl>  # live HTTP checks against a deployed site
```

## Deploy

```sh
export AWS_REGION=<region>        # or AWS_PROFILE with a region set
npm run deploy                    # runs: npx cdk deploy --all (with preflight, stack-status and smoke)
```

The equivalent bare CDK command, run from `infra/`, is `npx cdk deploy --all`. The site URL is printed as the `SiteUrl` output and written to `infra/cdk-outputs.json`.

## Cleanup

```sh
npm run destroy                   # runs: npx cdk destroy --all (asks for confirmation)
```

The equivalent bare CDK command, run from `infra/`, is `npx cdk destroy --all`. It removes the bucket and its objects, the CloudFront distribution and every other resource in `StrikeZoneHosting`. These remain afterwards:

- The CDK bootstrap stack (`CDKToolkit`) and its asset bucket. This is shared account infrastructure that other CDK apps may use.
- The S3 auto-delete helper's Lambda log group, which Lambda creates implicitly. [infra/README.md](infra/README.md) shows how to remove it.

Local cleanup: `npm --prefix game run clean` (build outputs) and `npm --prefix game run clean:evidence` (test evidence).
