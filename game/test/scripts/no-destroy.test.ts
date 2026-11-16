/**
 * SD-VS-12: destroy and AWS mutation are unreachable from the verification entry scripts.
 * Expands `npm run X`, `npm --prefix P run X` and `node <file>` references from the root, game
 * and infra package.json files, then greps every reachable command and referenced file.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(import.meta.dirname, '..', '..', '..');
const PACKAGES = { '.': REPO, game: join(REPO, 'game'), infra: join(REPO, 'infra') } as const;
type Pkg = keyof typeof PACKAGES;

// Built from parts so this file does not trip its own grep over game/test (not scanned anyway).
export const FORBIDDEN = [
  'destroy',
  '--force',
  'DeleteObject',
  'DeleteBucket',
  'PutObject',
  'CreateInvalidation',
  ['--require', 'approval never'].join('-'),
];

function scripts(pkg: Pkg): Record<string, string> {
  const json = JSON.parse(readFileSync(join(PACKAGES[pkg], 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return json.scripts ?? {};
}

interface Reached {
  readonly commands: string[];
  readonly files: string[];
}

function prefixOf(current: Pkg, raw: string | undefined): Pkg {
  if (raw === undefined) return current;
  const target = join(PACKAGES[current], raw);
  const hit = (Object.keys(PACKAGES) as Pkg[]).find((k) => PACKAGES[k] === target);
  if (hit === undefined) throw new Error(`unknown --prefix ${raw}`);
  return hit;
}

/** Walks the script graph from `pkg:name`. */
export function reach(pkg: Pkg, name: string, seen = new Set<string>()): Reached {
  const key = `${pkg}:${name}`;
  const out: Reached = { commands: [], files: [] };
  if (seen.has(key)) return out;
  seen.add(key);
  const cmd = scripts(pkg)[name];
  if (cmd === undefined) throw new Error(`missing script ${key}`);
  out.commands.push(`${key} = ${cmd}`);
  for (const m of cmd.matchAll(/npm(?:\s+--prefix\s+(\S+))?\s+run\s+([\w:-]+)/g)) {
    const sub = reach(prefixOf(pkg, m[1]), m[2] ?? '', seen);
    out.commands.push(...sub.commands);
    out.files.push(...sub.files);
  }
  for (const m of cmd.matchAll(/\bnode\s+(\S+\.m?js)/g)) {
    const file = join(PACKAGES[pkg], m[1] ?? '');
    if (existsSync(file)) out.files.push(file);
  }
  for (const m of cmd.matchAll(/\btsx\s+(\S+\.ts)/g)) {
    const file = join(PACKAGES[pkg], m[1] ?? '');
    if (existsSync(file)) out.files.push(file);
  }
  return out;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const hits = (text: string): string[] => FORBIDDEN.filter((t) => text.includes(t));

describe('no destroy or AWS mutation is reachable (SD-VS-12, SEC-VS-31)', () => {
  const entries: Array<[Pkg, string]> = [
    ['.', 'verify'],
    ['.', 'verify:evidence'],
    ['game', 'e2e'],
    ['game', 'e2e:deployed'],
  ];

  it.each(entries)('%s:%s reaches no forbidden token', (pkg, name) => {
    const { commands, files } = reach(pkg, name);
    expect(commands.length).toBeGreaterThan(0);
    for (const c of commands) expect(hits(c), c).toEqual([]);
    for (const f of files) expect(hits(readFileSync(f, 'utf8')), relative(REPO, f)).toEqual([]);
  });

  it('expands nested npm scripts across packages (root verify reaches infra verify)', () => {
    const { commands } = reach('.', 'verify');
    expect(commands.some((c) => c.startsWith('infra:verify'))).toBe(true);
    expect(commands.some((c) => c.startsWith('game:scan:secrets'))).toBe(true);
  });

  it('keeps destroy and deploy outside the graph but still present for the owner', () => {
    expect(scripts('.')['destroy']).toContain('destroy');
    expect(hits(scripts('infra')['deploy'] ?? '')).not.toEqual([]);
  });

  it('greps every file under game/e2e and game/scripts', () => {
    const files = [
      ...listFiles(join(PACKAGES.game, 'e2e')),
      ...listFiles(join(PACKAGES.game, 'scripts')),
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(hits(readFileSync(f, 'utf8')), relative(REPO, f)).toEqual([]);
  });

  it('rejects an unknown script or prefix', () => {
    expect(() => reach('game', 'no-such-script')).toThrow('missing script');
    expect(() => prefixOf('game', '../nowhere')).toThrow('unknown --prefix');
  });
});
