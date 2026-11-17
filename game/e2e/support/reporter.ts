/**
 * Raw results reporter (security-design-verification-suite C-VS-2, SD-VS-1). Writes one raw row
 * per test to e2e-results/raw-<project>.json. It never writes a status: scripts/e2e-summary.mjs
 * maps raw outcomes onto the check catalogue.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const OUT = join(import.meta.dirname, '..', '..', 'e2e-results');

interface Annotation {
  readonly type: string;
  readonly description?: string;
}

interface RawRow {
  readonly id: string;
  readonly outcome: string;
  readonly retry: number;
  readonly annotations: Annotation[];
  readonly warnings: string[];
  readonly notes: string[];
  readonly error?: string;
  readonly durationMs: number;
}

/** `<id> | <title>` → `<id>`; a title without the separator is reported as-is (uncatalogued). */
export function idOfTitle(title: string): string {
  const i = title.indexOf(' | ');
  return i < 0 ? title : title.slice(0, i);
}

const byType = (list: ReadonlyArray<Annotation>, type: string): string[] =>
  list.filter((a) => a.type === type).map((a) => a.description ?? '');

export default class RawReporter implements Reporter {
  private readonly tests: TestCase[] = [];
  private readonly last = new Map<TestCase, TestResult>();

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.last.has(test)) this.tests.push(test);
    this.last.set(test, result);
  }

  onEnd(result: FullResult): void {
    const project = process.env['SZ_E2E_PROJECT'] === 'deployed' ? 'deployed' : 'local';
    const rows: RawRow[] = this.tests.map((test) => {
      const last = this.last.get(test);
      const annotations: Annotation[] = [...test.annotations, ...(last?.annotations ?? [])].map(
        (a) => ({
          type: a.type,
          ...(a.description === undefined ? {} : { description: a.description }),
        }),
      );
      const error = last?.error?.message;
      return {
        id: idOfTitle(test.title),
        outcome: test.outcome(),
        retry: last?.retry ?? 0,
        annotations,
        warnings: byType(annotations, 'warning'),
        notes: byType(annotations, 'note'),
        ...(error === undefined ? {} : { error: error.split('\n')[0] ?? '' }),
        durationMs: last?.duration ?? 0,
      };
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, `raw-${project}.json`),
      `${JSON.stringify({ status: result.status, rows }, null, 2)}\n`,
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}
