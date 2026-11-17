import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STRICT_PATTERNS,
  TREE_PATTERNS,
  findSecrets,
  isSkippedFile,
  main,
  redact,
  scanTree,
} from '../../scripts/scan-secrets.mjs';

// Fixtures are built at runtime so this file never contains a literal its scanner would match.
const KEY_ID = 'AKIA' + 'Q'.repeat(16);
const SESSION_ID = 'ASIA' + '7'.repeat(16);
const SECRET_NAME = ['aws', 'secret', 'access', 'key'].join('_');
const TOKEN_NAME = ['aws', 'session', 'token'].join('_');
const PEM = '-'.repeat(5) + 'BEGIN OPENSSH PRIVATE KEY' + '-'.repeat(5);

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sz-scan-'));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('findSecrets strict mode (SD-VS-10)', () => {
  it.each([
    ['access-key-id', `id=${KEY_ID}`],
    ['access-key-id', `token ${SESSION_ID} end`],
    ['secret-key-name', `${SECRET_NAME.toUpperCase()} is set`],
    ['session-token-name', `export ${TOKEN_NAME}=x`],
    ['private-key', `${PEM}\nabc`],
  ])('reports %s', (kind, text) => {
    expect(findSecrets(text).map((h) => h.kind)).toContain(kind);
  });

  it('reports the 1-based line and never the value', () => {
    const hits = findSecrets(`a\nb\nkey ${KEY_ID}\n`);
    expect(hits).toEqual([{ kind: 'access-key-id', line: 3 }]);
    expect(JSON.stringify(hits)).not.toContain(KEY_ID);
  });

  it.each([
    'AKIA' + 'q'.repeat(16), // lower case
    'AKIA' + 'Q'.repeat(15), // too short
    'XAKIA' + 'Q'.repeat(16), // no word boundary
    'BEGIN PRIVATE KEY without dashes',
    '',
  ])('ignores %j', (text) => {
    expect(findSecrets(text)).toEqual([]);
  });

  it('returns nothing for non-strings', () => {
    expect(findSecrets(undefined)).toEqual([]);
    expect(findSecrets(42)).toEqual([]);
  });

  it('keeps both pattern sets frozen', () => {
    expect(Object.isFrozen(STRICT_PATTERNS)).toBe(true);
    expect(Object.isFrozen(TREE_PATTERNS)).toBe(true);
  });
});

describe('findSecrets tree mode', () => {
  it('ignores a setting name used inside detection code', () => {
    expect(findSecrets(`const re = /${SECRET_NAME}/i;`, TREE_PATTERNS)).toEqual([]);
  });

  it('reports an assigned value', () => {
    const ini = `[default]\n${SECRET_NAME} = ${'a1B2'.repeat(10)}\n`;
    expect(findSecrets(ini, TREE_PATTERNS)).toEqual([{ kind: 'secret-key-assignment', line: 2 }]);
    const json = `{"${TOKEN_NAME}": "${'Zz9'.repeat(10)}"}`;
    expect(findSecrets(json, TREE_PATTERNS).map((h) => h.kind)).toEqual([
      'session-token-assignment',
    ]);
  });

  it('still reports key ids and private keys', () => {
    expect(findSecrets(`${KEY_ID}\n${PEM}`, TREE_PATTERNS).map((h) => h.kind)).toEqual([
      'access-key-id',
      'private-key',
    ]);
  });
});

describe('redact (SEC-VS-33)', () => {
  it('removes credentials, home paths, AWS config paths, profiles and ANSI escapes', () => {
    const text = `\u001b[31m${KEY_ID}\u001b[0m /home/tester/.aws/credentials AWS_PROFILE=owner /home/tester/x`;
    const out = redact(text, '/home/tester');
    expect(out).toBe('[redacted] [aws-config] AWS_PROFILE=[redacted] ~/x');
    expect(findSecrets(out)).toEqual([]);
  });

  it('handles non-strings and a missing home', () => {
    expect(redact(undefined)).toBe('');
    expect(redact('plain', '')).toBe('plain');
  });
});

describe('scanTree', () => {
  it('passes a clean tree and reports file and line for a leak', () => {
    const root = tree({ 'a/ok.ts': 'export const x = 1;\n', 'b/leak.txt': `\n${KEY_ID}\n` });
    expect(scanTree(root)).toEqual([{ file: 'b/leak.txt', kind: 'access-key-id', line: 2 }]);
  });

  it('skips node_modules, build outputs, top-level dot directories, .env files and cdk outputs', () => {
    const root = tree({
      'node_modules/p/x.js': KEY_ID,
      'game/dist/a.js': KEY_ID,
      'game/coverage/a.json': KEY_ID,
      '.aidlc/notes.md': KEY_ID,
      '.env.local': KEY_ID,
      'infra/cdk-outputs.json': KEY_ID,
      'img/logo.png': KEY_ID,
      'game/.hidden/nested.txt': KEY_ID,
    });
    // Only top-level dot directories are skipped; a nested one is still scanned.
    expect(scanTree(root).map((h) => h.file)).toEqual(['game/.hidden/nested.txt']);
  });

  it('returns nothing for a missing root', () => {
    expect(scanTree(join(tmpdir(), 'sz-no-such-dir-xyz'))).toEqual([]);
  });

  it.each([
    ['.env', true],
    ['sub/.env.production', true],
    ['infra/cdk-outputs.json', true],
    ['x.wasm', true],
    ['src/a.ts', false],
  ])('isSkippedFile(%s) = %s', (path, skipped) => {
    expect(isSkippedFile(path)).toBe(skipped);
  });

  it('passes on this repository (the scanner does not match itself)', () => {
    const repo = join(import.meta.dirname, '..', '..', '..');
    expect(scanTree(repo)).toEqual([]);
  });
});

describe('scan:secrets CLI', () => {
  const sink = () => {
    const lines: string[] = [];
    return {
      lines,
      log: { error: (m: string) => lines.push(`E ${m}`), log: (m: string) => lines.push(`L ${m}`) },
    };
  };

  it('returns 0 and prints PASS for a clean tree', () => {
    const root = tree({ 'a.txt': 'clean' });
    const s = sink();
    expect(main([root], s.log)).toBe(0);
    expect(s.lines).toEqual([`L scan:secrets PASS (${root})`]);
  });

  it('returns 1 and names file, line and kind without the value', () => {
    const root = tree({ 'x/leak.md': `ok\n${KEY_ID}` });
    const s = sink();
    expect(main([root], s.log)).toBe(1);
    expect(s.lines).toEqual(['E scan:secrets FAIL x/leak.md:2 access-key-id']);
  });

  it('skips files over the size limit and dangling symlinks', () => {
    const root = tree({ 'big.txt': `${KEY_ID}${' '.repeat(5 * 1024 * 1024)}` });
    symlinkSync(join(root, 'missing-target'), join(root, 'dangling'));
    expect(scanTree(root)).toEqual([]);
  });
});
