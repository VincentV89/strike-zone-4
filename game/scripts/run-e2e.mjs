// e2e runner (security-design-verification-suite SD-VS-3, ADR-VS-1). Node built-ins only.
// Resolves the base URL, runs Playwright for one project, then ALWAYS runs the summariser and
// exits with the summariser's code. A shell `||` chain would lose that code.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summariseProject } from './e2e-summary.mjs';
import { redact } from './scan-secrets.mjs';

const gameRoot = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(gameRoot, 'e2e-results');

/** Reads E2E_BASE_URL, else only the SiteUrl field of infra/cdk-outputs.json. */
export async function resolveDeployedBase(env, repoRoot) {
  const { parseBaseUrl, siteUrlFromOutputs } = await import('../e2e/support/policy.ts');
  let raw = env.E2E_BASE_URL;
  if (raw === undefined || raw === '') {
    const outputs = join(repoRoot, 'infra', 'cdk-outputs.json');
    if (existsSync(outputs)) raw = siteUrlFromOutputs(JSON.parse(readFileSync(outputs, 'utf8')));
  }
  return parseBaseUrl(raw);
}

async function main() {
  const i = process.argv.indexOf('--project');
  const project = i >= 0 ? process.argv[i + 1] : 'local';
  if (project !== 'local' && project !== 'deployed') {
    console.error('run-e2e: --project must be local or deployed');
    return 1;
  }
  mkdirSync(outDir, { recursive: true });
  for (const f of [`raw-${project}.json`, `launch-${project}.json`]) {
    rmSync(join(outDir, f), { force: true });
  }
  const env = { ...process.env, SZ_E2E_PROJECT: project };
  if (project === 'deployed') {
    const base = await resolveDeployedBase(process.env, join(gameRoot, '..'));
    if (!base.ok) {
      // No URL to test: every deployed row is not-run and the exit code is 3, never 0.
      writeFileSync(
        join(outDir, `launch-${project}.json`),
        `${JSON.stringify({ ok: false, webgl2: false, error: base.reason })}\n`,
      );
      console.error(`run-e2e: deployed base URL unavailable (${base.reason})`);
      return summariseProject(gameRoot, project);
    }
    env.SZ_E2E_BASE_URL = base.url;
  }
  const bin = join(gameRoot, 'node_modules', '.bin', 'playwright');
  const run = spawnSync(bin, ['test', '--project', project], {
    cwd: gameRoot,
    env,
    stdio: 'inherit',
  });
  if (run.error) console.error(`run-e2e: playwright did not start: ${redact(run.error.message)}`);
  console.log(`run-e2e: playwright exited ${String(run.status ?? 'signal')}; summarising`);
  return summariseProject(gameRoot, project);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
