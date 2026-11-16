// Zone canary suite (BR-K-55, SD-K-2). Lints in-memory snippets with the real
// eslint.config.mjs and proves every zone entry fires. Cases are generated from
// eslint.zones.mjs, plus a hand-pinned no-cheat list so deleting that row fails too.
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint, type Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { SHARED_IMPORTS, ZONES, type Zone } from '../../eslint.zones.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

let eslint: ESLint;

beforeAll(() => {
  // Zone rules are core rules. Type-aware rules are switched off here because the
  // snippets are virtual files outside the TS project; the zone config is unchanged.
  eslint = new ESLint({
    cwd: ROOT,
    overrideConfig: tseslint.configs.disableTypeChecked as Linter.Config,
  });
});

/** A virtual file inside the zone, e.g. src/kernel/** → src/kernel/__canary__.ts. */
function fileIn(zone: Zone): string {
  const first = zone.files[0] ?? 'src/**';
  return first.replace('**', '__canary__.ts');
}

async function ruleHits(code: string, relPath: string, ruleId: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, relPath) });
  const messages = result?.messages ?? [];
  const fatal = messages.filter((m) => m.fatal === true);
  expect(fatal, `parse error in ${relPath}`).toEqual([]);
  return messages.filter((m) => m.ruleId === ruleId).length;
}

const importOf = (spec: string) => `import { x } from '${spec}';\nexport const y = x;\n`;

describe.each(ZONES.map((z) => [z.name, z] as const))('zone %s', (_name, zone) => {
  const file = fileIn(zone);
  const forbidden = zone.forbiddenImportPatterns.flatMap((p) => p.samples);

  it.each(forbidden)('forbids import of %s', async (spec) => {
    expect(await ruleHits(importOf(spec), file, 'no-restricted-imports')).toBe(1);
  });

  it.each(zone.allowed)('allows import of %s', async (spec) => {
    expect(await ruleHits(importOf(spec), file, 'no-restricted-imports')).toBe(0);
  });

  const globals = zone.forbiddenGlobals.map((g) => g.name);
  if (globals.length > 0) {
    it.each(globals)('forbids the global %s', async (name) => {
      expect(await ruleHits(`export const g = ${name};\n`, file, 'no-restricted-globals')).toBe(1);
    });
  }

  // A property-only ban (no `object`) is rendered on an arbitrary receiver (SD-A-5).
  const props = zone.forbiddenProperties.map((p) => `${p.object ?? 'x'}.${p.property}`);
  if (props.length > 0) {
    it.each(props)('forbids %s', async (expr) => {
      expect(
        await ruleHits(`export const p = ${expr}();\n`, file, 'no-restricted-properties'),
      ).toBe(1);
    });
  }

  it('keeps the shared entries: parent-relative imports and default exports still fail', async () => {
    for (const spec of SHARED_IMPORTS.flatMap((p) => p.samples)) {
      expect(await ruleHits(importOf(spec), file, 'no-restricted-imports')).toBe(1);
    }
    expect(await ruleHits('export default 1;\n', file, 'no-restricted-syntax')).toBe(1);
  });
});

describe('dynamic code bans (SEC-K-04)', () => {
  it.each(['src/kernel/__canary__.ts', 'src/ai/__canary__.ts', 'src/app/__canary__.ts'])(
    'fire in %s',
    async (file) => {
      expect(await ruleHits("export const a: unknown = eval('1');\n", file, 'no-eval')).toBe(1);
      expect(
        await ruleHits(
          "/* global setTimeout */\nsetTimeout('go()', 1);\n",
          file,
          'no-implied-eval',
        ),
      ).toBe(1);
      expect(
        await ruleHits("export const f = new Function('a', 'return a');\n", file, 'no-new-func'),
      ).toBe(1);
    },
  );

  it('the type-aware @typescript-eslint/no-implied-eval is an error in the real config', async () => {
    const real = new ESLint({ cwd: ROOT });
    const config = (await real.calculateConfigForFile(
      join(ROOT, 'src/kernel/clock.ts'),
    )) as Linter.Config;
    const rule = config.rules?.['@typescript-eslint/no-implied-eval'];
    expect(Array.isArray(rule) ? rule[0] : rule).toBe(2);
  });
});

describe('import.meta (SEC-K-08)', () => {
  const code = 'export const u = import.meta.url;\n';
  it('is an error in the kernel', async () => {
    expect(await ruleHits(code, 'src/kernel/__canary__.ts', 'no-restricted-syntax')).toBe(1);
  });
  it('is allowed in app-shell', async () => {
    expect(await ruleHits(code, 'src/app/__canary__.ts', 'no-restricted-syntax')).toBe(0);
  });
});

// Hand-pinned: req-bot-no-cheat AC1 / dec-perception-gateway. Independent of zone data.
describe('no-cheat boundary (hand-pinned)', () => {
  it.each(['@sz/player', '@sz/combat', '@sz/sim', '@sz/physics'])(
    'src/ai/brain.ts cannot import %s',
    async (spec) => {
      expect(await ruleHits(importOf(spec), 'src/ai/brain.ts', 'no-restricted-imports')).toBe(1);
    },
  );

  it('perception may read the player but must not import bot-ai', async () => {
    const file = 'src/ai/perception/percepts.ts';
    expect(await ruleHits(importOf('@sz/player'), file, 'no-restricted-imports')).toBe(0);
    expect(await ruleHits(importOf('@sz/ai'), file, 'no-restricted-imports')).toBe(1);
  });

  it('S9: bot-ai can still use perception and the kernel', async () => {
    expect(
      await ruleHits(importOf('@sz/ai/perception'), 'src/ai/brain.ts', 'no-restricted-imports'),
    ).toBe(0);
    expect(await ruleHits(importOf('@sz/kernel'), 'src/ai/brain.ts', 'no-restricted-imports')).toBe(
      0,
    );
  });
});

describe('outside the zones', () => {
  it('an unzoned src/ directory still bans parent-relative imports', async () => {
    expect(await ruleHits(importOf('../x'), 'src/misc/a.ts', 'no-restricted-imports')).toBe(1);
  });

  it('tests may use relative imports and Node globals', async () => {
    expect(
      await ruleHits(
        importOf('../support/fakes'),
        'test/kernel/a.test.ts',
        'no-restricted-imports',
      ),
    ).toBe(0);
    expect(
      await ruleHits(
        'export const t = performance.now();\n',
        'test/kernel/a.test.ts',
        'no-restricted-globals',
      ),
    ).toBe(0);
  });

  it('S10: kernel code calling performance.now() or Math.random() fails', async () => {
    const file = 'src/kernel/__canary__.ts';
    expect(
      await ruleHits('export const t = performance.now();\n', file, 'no-restricted-globals'),
    ).toBe(1);
    expect(
      await ruleHits('export const r = Math.random();\n', file, 'no-restricted-properties'),
    ).toBe(1);
  });
});

// SD-WM-6 / SD-WM-10: dynamic import() is closed for maps, nav and physics; physics may load
// only Rapier itself that way.
describe('dynamic import (world-maps zones)', () => {
  const dyn = (spec: string) => `export const m = import('${spec}');\n`;
  it.each(['src/maps/__canary__.ts', 'src/nav/__canary__.ts'])('is banned in %s', async (file) => {
    expect(await ruleHits(dyn('@sz/kernel'), file, 'no-restricted-syntax')).toBe(1);
  });
  it('physics may dynamically import only @dimforge/rapier3d-compat', async () => {
    const file = 'src/physics/__canary__.ts';
    expect(await ruleHits(dyn('@dimforge/rapier3d-compat'), file, 'no-restricted-syntax')).toBe(0);
    expect(await ruleHits(dyn('@sz/kernel'), file, 'no-restricted-syntax')).toBe(1);
  });
  it('physics may still call console.error', async () => {
    const code = "console.error('x');\nexport const a = 1;\n";
    expect(await ruleHits(code, 'src/physics/__canary__.ts', 'no-restricted-properties')).toBe(0);
    expect(await ruleHits(code, 'src/physics/__canary__.ts', 'no-restricted-globals')).toBe(0);
  });
});

// Every src/<dir> on disk matches exactly one zone, so no directory is unzoned or double-zoned.
describe('one zone per directory', () => {
  const matches = (zone: Zone, rel: string) => {
    const inside = (glob: string) => rel.startsWith(glob.replace('**', ''));
    return zone.files.some(inside) && !(zone.ignores ?? []).some(inside);
  };
  const dirs = readdirSync(join(ROOT, 'src'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  it.each(dirs)('src/%s', (dir) => {
    const hit = ZONES.filter((z) => matches(z, `src/${dir}/__probe__.ts`)).map((z) => z.name);
    expect(hit).toHaveLength(1);
  });
});

// Hand-pinned player-movement canaries (security-design-player-movement, zone data).
describe('player and input zones (SD-P-1 to SD-P-3, hand-pinned)', () => {
  it('src/player can no longer import @sz/nav (the old L1 allowance is gone)', async () => {
    expect(await ruleHits(importOf('@sz/nav'), 'src/player/x.ts', 'no-restricted-imports')).toBe(1);
  });

  it('input DOM code cannot reach past the ports (defaultView), but may read pointerLockElement', async () => {
    const file = 'src/input/dom/x.ts';
    const reach =
      'export const f = (deps: { doc: { defaultView: unknown } }) => deps.doc.defaultView;\n';
    const ok =
      'export const f = (deps: { doc: { pointerLockElement: unknown } }) => deps.doc.pointerLockElement;\n';
    expect(await ruleHits(reach, file, 'no-restricted-syntax')).toBe(1);
    expect(await ruleHits(ok, file, 'no-restricted-syntax')).toBe(0);
  });

  it('the input core takes plain values, not DOM types', async () => {
    const code = 'export const f = (e: KeyboardEvent) => e;\n';
    expect(await ruleHits(code, 'src/input/core/x.ts', 'no-restricted-syntax')).toBe(1);
    expect(await ruleHits(code, 'src/input/dom/x.ts', 'no-restricted-syntax')).toBe(0);
  });

  it('bot-ai still cannot import @sz/player (no-cheat unchanged)', async () => {
    expect(await ruleHits(importOf('@sz/player'), 'src/ai/x.ts', 'no-restricted-imports')).toBe(1);
  });

  it('player code must use Number.isFinite, not the coercing global', async () => {
    const file = 'src/player/x.ts';
    expect(await ruleHits('export const a = isFinite(1);\n', file, 'no-restricted-globals')).toBe(
      1,
    );
    expect(
      await ruleHits('export const a = Number.isFinite(1);\n', file, 'no-restricted-globals'),
    ).toBe(0);
  });

  it.each([
    "import { stepMovement } from '@sz/player';\nexport const a = stepMovement;\n",
    "import { type PlayerInputIntent } from '@sz/player';\nexport type A = PlayerInputIntent;\n",
    "export { stepMovement } from '@sz/player';\n",
    "export * from '@sz/player';\n",
    "export const p = import('@sz/player');\n",
  ])('input forbids value use of @sz/player: %s', async (code) => {
    expect(await ruleHits(code, 'src/input/dom/x.ts', 'no-restricted-syntax')).toBe(1);
    expect(await ruleHits(code, 'src/input/core/x.ts', 'no-restricted-syntax')).toBe(1);
  });

  it('input allows whole-declaration type imports and type re-exports of @sz/player', async () => {
    const code =
      "import type { PlayerInputIntent } from '@sz/player';\nexport type { MoveAxes } from '@sz/player';\nexport type A = PlayerInputIntent;\n";
    expect(await ruleHits(code, 'src/input/dom/x.ts', 'no-restricted-syntax')).toBe(0);
    expect(await ruleHits(code, 'src/input/dom/x.ts', 'no-restricted-imports')).toBe(0);
  });

  it('input DOM code may import its own core; the core may not import the DOM side', async () => {
    expect(
      await ruleHits(
        importOf('@sz/input/core/state'),
        'src/input/dom/x.ts',
        'no-restricted-imports',
      ),
    ).toBe(0);
    expect(
      await ruleHits(
        importOf('@sz/input/dom/bind'),
        'src/input/core/x.ts',
        'no-restricted-imports',
      ),
    ).toBe(1);
  });

  it.each(['src/player/movement.ts', 'src/input/dom/bind.ts', 'src/input/core/state.ts'])(
    '%s is matched by exactly one zone',
    async (file) => {
      const real = new ESLint({ cwd: ROOT });
      const matched = ZONES.filter(
        (z) =>
          z.files.some((g) => file.startsWith(g.replace('**', ''))) &&
          !(z.ignores ?? []).some((g) => file.startsWith(g.replace('**', ''))),
      );
      expect(matched.map((z) => z.name)).toHaveLength(1);
      expect(await real.isPathIgnored(join(ROOT, file))).toBe(false);
    },
  );
});

// game-audio zones (security-design-game-audio SD-A-1, SD-A-5, SD-A-8). Hand-pinned.
describe('audio zones', () => {
  const adapter = 'src/audio/web/__canary__.ts';
  const core = 'src/audio/core/__canary__.ts';

  it('SD-A-8: core rejects fetch, decodeAudioData, Math.random and console.warn together', async () => {
    const code = [
      "export const a = fetch('x');",
      'export const b = x.decodeAudioData();',
      'export const c = Math.random();',
      "console.warn('x');",
    ].join('\n');
    expect(await ruleHits(code, core, 'no-restricted-globals')).toBe(2); // fetch, console
    expect(await ruleHits(code, core, 'no-restricted-properties')).toBe(2);
  });

  it('SD-A-8: core may not import the audio barrel or the web adapter', async () => {
    expect(await ruleHits(importOf('@sz/audio'), core, 'no-restricted-imports')).toBe(1);
    expect(await ruleHits(importOf('@sz/audio/web/params'), core, 'no-restricted-imports')).toBe(1);
    expect(await ruleHits(importOf('@sz/kernel'), core, 'no-restricted-imports')).toBe(0);
  });

  it('the adapter may use globalThis, setTimeout and console.warn, but not console.error', async () => {
    const code = [
      'export const g = globalThis.AudioContext;',
      'setTimeout(() => undefined, 0);',
      "console.warn('x');",
    ].join('\n');
    expect(await ruleHits(code, adapter, 'no-restricted-globals')).toBe(0);
    expect(await ruleHits(code, adapter, 'no-restricted-properties')).toBe(0);
    expect(await ruleHits("console.error('x');\n", adapter, 'no-restricted-properties')).toBe(1);
  });

  it.each([
    'p.value = 1;',
    'p.gain.value = 0.5;',
    'p.setValueAtTime(0, 1);',
    'p.setTargetAtTime(0, 1, 0.1);',
    'p.linearRampToValueAtTime(0, 1);',
    'p.exponentialRampToValueAtTime(1, 1);',
    'p.setValueCurveAtTime(c, 0, 1);',
    'l.setPosition(0, 0, 0);',
    'l.setOrientation(0, 0, -1, 0, 1, 0);',
  ])('SD-A-1: `%s` is banned outside params.ts (adapter and core)', async (stmt) => {
    const code = `declare const p: any; declare const l: any; declare const c: any;\n${stmt}\n`;
    expect(await ruleHits(code, adapter, 'no-restricted-syntax')).toBe(1);
    expect(await ruleHits(code, core, 'no-restricted-syntax')).toBe(1);
  });

  it('reading .value and other assignments stay allowed', async () => {
    const code = 'declare const p: any;\nexport const v = p.value;\np.buffer = 1;\n';
    expect(await ruleHits(code, adapter, 'no-restricted-syntax')).toBe(0);
  });

  // src/input now bans these globals (SEC-P-16); it reaches the DOM only through injected ports.
  it('diagnostics keeps window and navigator', async () => {
    const code = 'export const w = window;\nexport const n = navigator;\n';
    expect(await ruleHits(code, 'src/diagnostics/a.ts', 'no-restricted-globals')).toBe(0);
    expect(await ruleHits(code, adapter, 'no-restricted-globals')).toBe(2);
  });
});

// Hand-pinned: weapons-combat boundary (SEC-WC-12, SEC-WC-21, SEC-WC-22, ADR-WC-8).
describe('weapons and combat zones (hand-pinned)', () => {
  const dirs = ['src/weapons/__canary__.ts', 'src/combat/__canary__.ts'];

  it.each(dirs)('%s bans console, fetch, timers, Date and Math.random', async (file) => {
    expect(await ruleHits("console.error('x');\n", file, 'no-restricted-globals')).toBe(1);
    expect(await ruleHits("export const f = fetch('x');\n", file, 'no-restricted-globals')).toBe(1);
    expect(
      await ruleHits('export const t = setTimeout(() => 0, 1);\n', file, 'no-restricted-globals'),
    ).toBe(1);
    expect(await ruleHits('export const d = Date.now();\n', file, 'no-restricted-globals')).toBe(1);
    expect(
      await ruleHits('export const r = Math.random();\n', file, 'no-restricted-properties'),
    ).toBe(1);
  });

  it('weapons imports only the kernel: @sz/combat and @sz/nav fail, @sz/kernel passes', async () => {
    const file = 'src/weapons/tick-weapon.ts';
    expect(await ruleHits(importOf('@sz/combat'), file, 'no-restricted-imports')).toBe(1);
    expect(await ruleHits(importOf('@sz/nav'), file, 'no-restricted-imports')).toBe(1);
    expect(await ruleHits(importOf('@sz/kernel'), file, 'no-restricted-imports')).toBe(0);
    expect(await ruleHits(importOf('./spread'), file, 'no-restricted-imports')).toBe(0);
  });

  it('combat imports only the kernel and weapons, never deep paths', async () => {
    const file = 'src/combat/resolve-shot.ts';
    expect(await ruleHits(importOf('@sz/weapons'), file, 'no-restricted-imports')).toBe(0);
    expect(await ruleHits(importOf('@sz/weapons/guards'), file, 'no-restricted-imports')).toBe(1);
    expect(await ruleHits(importOf('@sz/physics'), file, 'no-restricted-imports')).toBe(1);
  });

  it('bot-ai may import @sz/weapons but still never @sz/combat', async () => {
    const file = 'src/ai/brain.ts';
    expect(await ruleHits(importOf('@sz/weapons'), file, 'no-restricted-imports')).toBe(0);
    expect(await ruleHits(importOf('@sz/combat'), file, 'no-restricted-imports')).toBe(1);
  });
});

// ADR-WC-7: every src/<dir> matches exactly one zone, so zone order never matters and a new
// directory cannot fall outside every zone.
describe('zone coverage (ADR-WC-7)', () => {
  const PLANNED = [
    'kernel',
    'maps',
    'nav',
    'player',
    'weapons',
    'combat',
    'stats',
    'ai',
    'ai/perception',
    'sim',
    'round',
    'physics',
    'render',
    'assets',
    'ui',
    'input',
    'audio',
    'diagnostics',
    'persistence',
    'app',
  ];

  function underGlob(glob: string, file: string): boolean {
    if (!glob.endsWith('/**')) throw new Error(`unsupported zone glob ${glob}`);
    return file.startsWith(glob.slice(0, -2));
  }

  function zonesFor(file: string): string[] {
    return ZONES.filter(
      (z) =>
        z.files.some((g) => underGlob(g, file)) &&
        !(z.ignores ?? []).some((g) => underGlob(g, file)),
    ).map((z) => z.name);
  }

  it('every zone glob has the src/<dir>/** shape', () => {
    for (const z of ZONES)
      for (const g of [...z.files, ...(z.ignores ?? [])]) {
        expect(g).toMatch(/^src\/[a-z/]+\/\*\*$/);
      }
  });

  const onDisk = readdirSync(join(ROOT, 'src'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  it.each([...new Set([...PLANNED, ...onDisk])])('src/%s matches exactly one zone', (dir) => {
    expect(zonesFor(`src/${dir}/__probe__.ts`)).toHaveLength(1);
  });

  it('weapons and combat are in their own zones', () => {
    expect(zonesFor('src/weapons/x.ts')).toEqual(['weapons (L1)']);
    expect(zonesFor('src/combat/x.ts')).toEqual(['combat (L1)']);
  });
});
