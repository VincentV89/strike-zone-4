/**
 * Launch and WebGL2 probe (security-design-verification-suite SD-VS-3). Launches Chromium once
 * with the configured flags and writes e2e-results/launch-<project>.json = { ok, webgl2, error? }.
 * A launch failure is recorded first, then stops the run: no test can pass without a browser,
 * and scripts/run-e2e.mjs always runs the summariser, which marks every row not-run (exit 3).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { redact } from '../../scripts/scan-secrets.mjs';
import { firstLine } from './policy';

const OUT = join(import.meta.dirname, '..', '..', 'e2e-results');

export interface LaunchRecord {
  readonly ok: boolean;
  readonly webgl2: boolean;
  readonly error?: string;
}

function write(project: string, rec: LaunchRecord): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `launch-${project}.json`), `${JSON.stringify(rec)}\n`);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const project = process.env['SZ_E2E_PROJECT'] === 'deployed' ? 'deployed' : 'local';
  const use = config.projects.find((p) => p.name === project)?.use ?? {};
  const args = use.launchOptions?.args ?? [];
  let rec: LaunchRecord;
  try {
    const browser = await chromium.launch({ args });
    try {
      const page = await browser.newPage();
      await page.setContent('<!doctype html><title>probe</title>');
      const webgl2 = await page.evaluate(
        () => document.createElement('canvas').getContext('webgl2') !== null,
      );
      rec = { ok: true, webgl2 };
    } finally {
      await browser.close();
    }
  } catch (e: unknown) {
    rec = {
      ok: false,
      webgl2: false,
      error: redact(firstLine(e instanceof Error ? e.message : e)),
    };
  }
  write(project, rec);
  if (!rec.ok) throw new Error(`browser-launch-failed: ${rec.error ?? 'unknown'}`);
}
