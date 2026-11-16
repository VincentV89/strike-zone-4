// Import-boundary zones as data (decision SD-K-2, business-logic-model import-zone model).
//
// Each zone becomes one flat-config object. Flat config REPLACES the option array of
// no-restricted-imports / -globals / -properties / -syntax for a later matching object,
// so eslint.config.mjs concatenates SHARED_IMPORTS and SHARED_SYNTAX into every zone.
//
// `samples` and `allowed` are test data for test/lint/zones.test.ts and are stripped by
// the mapper. Loosening or removing any entry needs a decision record (SEC-K-06).

const ADAPTERS = 'physics|input|render|assets|audio|ui|persistence|diagnostics';

/** Shared by every file in src/: no parent-relative imports, so paths cannot bypass a zone. */
export const SHARED_IMPORTS = [
  {
    regex: '^\\.\\./',
    message: 'BR-K-05: no parent-relative imports in src/. Use the @sz/<dir> alias.',
    samples: ['../x', '../../kernel/rng'],
  },
];

/** Shared by every linted file: named exports only (team-practices Code Style). */
export const SHARED_SYNTAX = [
  { selector: 'ExportDefaultDeclaration', message: 'BR-K-06: use named exports.' },
];

const imp = (regex, message, samples) => ({ regex, message, samples });

const THREE = imp('^three(/|$)', 'dec-import-boundaries: only render/assets may import three.', [
  'three',
  'three/addons/x.js',
]);
const RAPIER = imp('^@dimforge/', 'dec-import-boundaries: only physics may import Rapier.', [
  '@dimforge/rapier3d-compat',
]);
const KERNEL_DEEP = imp('^@sz/kernel/', 'BR-K-05: import the kernel only through @sz/kernel.', [
  '@sz/kernel/rng',
]);
const APP = imp('^@sz/app(/|$)', 'dec-import-boundaries: nothing imports app-shell.', ['@sz/app']);
const ALL_ADAPTERS = imp(
  `^@sz/(${ADAPTERS})(/|$)`,
  'dec-import-boundaries: domain and application layers must not import adapters.',
  ['@sz/physics', '@sz/render/scene', '@sz/ui', '@sz/persistence'],
);
const SIM_ROUND_APP = imp(
  '^@sz/(sim|round|app)(/|$)',
  'dec-import-boundaries: L1 domain must not import simulation, round or app.',
  ['@sz/sim', '@sz/round/controller', '@sz/app'],
);

const L1_IMPORTS = [THREE, RAPIER, SIM_ROUND_APP, ALL_ADAPTERS, KERNEL_DEEP];

const BROWSER_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'requestAnimationFrame',
  'performance',
].map((name) => ({ name, message: `SEC-K-07: ${name} is not allowed in this layer.` }));

const STORAGE_GLOBALS = ['localStorage', 'sessionStorage'].map((name) => ({
  name,
  message: `dec-import-boundaries: ${name} only through persistence.`,
}));

/** L0 to L2: browser globals, wall-clock time and unseeded randomness are banned. */
const PURE_GLOBALS = [
  ...BROWSER_GLOBALS,
  { name: 'Date', message: 'BR-K-03: no wall-clock time; time enters as dt arguments.' },
  { name: 'crypto', message: 'SEC-K-07: use the injected Rng.' },
];

const PURE_PROPERTIES = [
  { object: 'Math', property: 'random', message: 'SEC-K-07: use the injected Rng (BR-K-34).' },
];

// ---- game-audio zones (security-design-game-audio SD-A-1, SD-A-5, SD-A-8) ----

const AUDIO_IMPORTS = [THREE, RAPIER, APP, KERNEL_DEEP];

const AUDIO_GLOBALS = [
  ...STORAGE_GLOBALS,
  ...[
    'fetch',
    'XMLHttpRequest',
    'Audio',
    'HTMLAudioElement',
    'OfflineAudioContext',
    'navigator',
    'window',
    'document',
  ].map((name) => ({ name, message: `SEC-A-02: ${name} is not allowed in audio.` })),
  ...['isFinite', 'isNaN'].map((name) => ({
    name,
    message: `SD-A-2: ${name} coerces. Use Number.${name}.`,
  })),
];

const AUDIO_PROPERTIES = [
  ...[
    'decodeAudioData',
    'addModule',
    'getUserMedia',
    'createMediaStreamSource',
    'createMediaElementSource',
    'createScriptProcessor',
  ].map((property) => ({ property, message: `SEC-A-02: ${property} is not allowed in audio.` })),
  ...['error', 'log', 'info', 'debug', 'trace'].map((property) => ({
    object: 'console',
    property,
    message: 'SD-A-7: audio logs only through warnOnce (console.warn).',
  })),
];

const AUDIO_PARAM_METHODS =
  'setValueAtTime|setTargetAtTime|linearRampToValueAtTime|exponentialRampToValueAtTime|setValueCurveAtTime|setPosition|setOrientation';

/** SD-A-1: AudioParam writes only through src/audio/web/params.ts (finite-guarded). */
const AUDIO_PARAM_SYNTAX = [
  {
    selector: "AssignmentExpression > MemberExpression.left[property.name='value']",
    message: 'SD-A-1: write AudioParams through setParam in src/audio/web/params.ts.',
  },
  {
    selector: `CallExpression[callee.property.name=/^(${AUDIO_PARAM_METHODS})$/]`,
    message: 'SD-A-1: schedule AudioParams through src/audio/web/params.ts.',
  },
];

/** Later entries with the same name are dropped, so a canary sees each global once. */
function uniqueByName(entries) {
  const seen = new Set();
  return entries.filter((e) => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}

/**
 * weapons and combat only (ADR-WC-8): no console, network, workers or timers. Time enters as
 * ctx.now and ctx.dt. The shared lists for other zones are unchanged (residual risk R-6).
 */
const UNIT_GLOBALS = [
  ...PURE_GLOBALS,
  ...[
    'console',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'Worker',
    'setTimeout',
    'setInterval',
    'queueMicrotask',
  ].map((name) => ({
    name,
    message: `SEC-WC-22/ADR-WC-8: ${name} is not allowed in weapons or combat.`,
  })),
];

/** @type {ReadonlyArray<Zone>} */
export const ZONES = [
  {
    name: 'kernel (L0)',
    files: ['src/kernel/**'],
    forbiddenImportPatterns: [
      imp('^[^.]', 'BR-K-02: the kernel imports nothing outside src/kernel/.', [
        '@sz/maps',
        '@sz/kernel',
        'three',
        'node:fs',
        'lodash',
      ]),
    ],
    allowed: ['./types'],
    forbiddenGlobals: PURE_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [
      {
        selector: "MetaProperty[meta.name='import']",
        message: 'SEC-K-08: import.meta is not allowed in the kernel.',
      },
    ],
  },
  {
    name: 'domain (L1)',
    files: ['src/maps/**', 'src/nav/**', 'src/player/**', 'src/stats/**'],
    forbiddenImportPatterns: L1_IMPORTS,
    allowed: ['@sz/kernel', '@sz/nav'],
    forbiddenGlobals: PURE_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [],
  },
  {
    // ADR-WC-7: own zone, not in domain (L1), so no file matches two zones. One pattern bans
    // every non-relative import except @sz/kernel; it subsumes L1_IMPORTS (which would
    // otherwise report a second time for the same import).
    name: 'weapons (L1)',
    files: ['src/weapons/**'],
    forbiddenImportPatterns: [
      imp('^(?!@sz/kernel$)[^.]', 'SEC-WC-21: weapons imports only @sz/kernel.', [
        '@sz/combat',
        '@sz/player',
        '@sz/nav',
        '@sz/weapons',
        '@sz/kernel/rng',
        '@sz/sim',
        '@sz/physics',
        'three',
        '@dimforge/rapier3d-compat',
        'gl-matrix',
      ]),
    ],
    allowed: ['@sz/kernel', './weapon-table'],
    forbiddenGlobals: UNIT_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [],
  },
  {
    name: 'combat (L1)',
    files: ['src/combat/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!@sz/(kernel|weapons)$)[^.]',
        'SEC-WC-21: combat imports only @sz/kernel and @sz/weapons.',
        [
          '@sz/player',
          '@sz/physics',
          '@sz/nav',
          '@sz/ai',
          '@sz/sim',
          '@sz/weapons/weapon-table',
          '@sz/kernel/rng',
          'three',
          '@dimforge/rapier3d-compat',
        ],
      ),
    ],
    allowed: ['@sz/kernel', '@sz/weapons', './guards'],
    forbiddenGlobals: UNIT_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [],
  },
  {
    name: 'perception (L1)',
    files: ['src/ai/perception/**'],
    forbiddenImportPatterns: [
      ...L1_IMPORTS,
      imp(
        '^@sz/ai($|/(?!perception(/|$)))',
        'dec-perception-gateway: perception must not import bot-ai (no cycle).',
        ['@sz/ai', '@sz/ai/brain'],
      ),
    ],
    allowed: ['@sz/kernel', '@sz/player', '@sz/ai/perception/types'],
    forbiddenGlobals: PURE_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [],
  },
  {
    name: 'bot-ai (L1, no-cheat)',
    files: ['src/ai/**'],
    ignores: ['src/ai/perception/**'],
    forbiddenImportPatterns: [
      ...L1_IMPORTS,
      imp(
        '^@sz/(player|combat)(/|$)',
        'req-bot-no-cheat: bot-ai learns about the player only through perception (BotPercepts).',
        ['@sz/player', '@sz/combat/damage'],
      ),
    ],
    allowed: ['@sz/kernel', '@sz/ai/perception', '@sz/nav', '@sz/weapons'],
    forbiddenGlobals: PURE_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [],
  },
  {
    name: 'simulation (L2)',
    files: ['src/sim/**'],
    forbiddenImportPatterns: [
      THREE,
      RAPIER,
      imp('^@sz/(round|app)(/|$)', 'dec-import-boundaries: sim must not import round or app.', [
        '@sz/round',
        '@sz/app',
      ]),
      ALL_ADAPTERS,
      KERNEL_DEEP,
    ],
    allowed: ['@sz/kernel', '@sz/player', '@sz/ai'],
    forbiddenGlobals: PURE_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [],
  },
  {
    name: 'round (L2)',
    files: ['src/round/**'],
    forbiddenImportPatterns: [THREE, RAPIER, APP, ALL_ADAPTERS, KERNEL_DEEP],
    allowed: ['@sz/kernel', '@sz/sim'],
    forbiddenGlobals: PURE_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [],
  },
  {
    name: 'physics adapter (L3)',
    files: ['src/physics/**'],
    forbiddenImportPatterns: [
      THREE,
      imp(
        `^@sz/(sim|round|app|input|render|assets|audio|ui|persistence|diagnostics)(/|$)`,
        'dec-import-boundaries: physics must not import application layers or other adapters.',
        ['@sz/sim', '@sz/render', '@sz/app'],
      ),
      KERNEL_DEEP,
    ],
    allowed: ['@sz/kernel', '@sz/maps', '@dimforge/rapier3d-compat'],
    forbiddenGlobals: BROWSER_GLOBALS,
    forbiddenProperties: [],
    forbiddenSyntax: [],
  },
  {
    name: 'render and assets (L3)',
    files: ['src/render/**', 'src/assets/**'],
    forbiddenImportPatterns: [
      RAPIER,
      imp(
        '^@sz/(app|ui|input|persistence|audio)(/|$)',
        'dec-import-boundaries: render/assets must not import app or other adapters.',
        ['@sz/ui', '@sz/app', '@sz/audio'],
      ),
      KERNEL_DEEP,
    ],
    allowed: ['@sz/kernel', 'three', '@sz/sim'],
    forbiddenGlobals: STORAGE_GLOBALS,
    forbiddenProperties: [],
    forbiddenSyntax: [],
  },
  {
    name: 'ui (L3)',
    files: ['src/ui/**'],
    forbiddenImportPatterns: [
      THREE,
      RAPIER,
      imp(
        '^@sz/(app|render|assets|physics)(/|$)',
        'dec-import-boundaries: ui uses DOM only, never three, Rapier or app.',
        ['@sz/render', '@sz/physics'],
      ),
      KERNEL_DEEP,
    ],
    allowed: ['@sz/kernel', '@sz/persistence'],
    forbiddenGlobals: STORAGE_GLOBALS,
    forbiddenProperties: [],
    forbiddenSyntax: [],
  },
  {
    name: 'input, diagnostics (L3)',
    files: ['src/input/**', 'src/diagnostics/**'],
    forbiddenImportPatterns: [THREE, RAPIER, APP, KERNEL_DEEP],
    allowed: ['@sz/kernel'],
    forbiddenGlobals: STORAGE_GLOBALS,
    forbiddenProperties: [],
    forbiddenSyntax: [],
  },
  {
    name: 'audio adapter (L3)',
    files: ['src/audio/**'],
    forbiddenImportPatterns: AUDIO_IMPORTS,
    allowed: ['@sz/kernel'],
    forbiddenGlobals: AUDIO_GLOBALS,
    forbiddenProperties: AUDIO_PROPERTIES,
    forbiddenSyntax: AUDIO_PARAM_SYNTAX,
  },
  {
    // Must come after the adapter zone: it repeats every adapter entry (flat config replaces arrays).
    name: 'audio core (L3-pure)',
    files: ['src/audio/core/**'],
    forbiddenImportPatterns: [
      ...AUDIO_IMPORTS,
      imp('^@sz/audio(/|$)', 'BR-A-50: audio core never imports the audio barrel or web adapter.', [
        '@sz/audio',
        '@sz/audio/web/adapter',
      ]),
    ],
    allowed: ['@sz/kernel', './dsp'],
    forbiddenGlobals: uniqueByName([
      ...AUDIO_GLOBALS,
      ...PURE_GLOBALS,
      ...[
        'globalThis',
        'console',
        'setTimeout',
        'setInterval',
        'AudioContext',
        'webkitAudioContext',
        'AudioBuffer',
      ].map((name) => ({ name, message: `BR-A-50: ${name} is not allowed in audio core.` })),
    ]),
    forbiddenProperties: [...AUDIO_PROPERTIES, ...PURE_PROPERTIES],
    forbiddenSyntax: AUDIO_PARAM_SYNTAX,
  },
  {
    name: 'persistence (L3)',
    files: ['src/persistence/**'],
    forbiddenImportPatterns: [THREE, RAPIER, APP, KERNEL_DEEP],
    allowed: ['@sz/kernel'],
    forbiddenGlobals: [],
    forbiddenProperties: [],
    forbiddenSyntax: [],
  },
  {
    name: 'app-shell (L4)',
    files: ['src/app/**'],
    forbiddenImportPatterns: [KERNEL_DEEP],
    allowed: ['@sz/kernel', '@sz/round', '@sz/render', 'three'],
    forbiddenGlobals: STORAGE_GLOBALS,
    forbiddenProperties: [],
    forbiddenSyntax: [],
  },
];

/**
 * @typedef {{ regex: string, message: string, samples: ReadonlyArray<string> }} ImportPattern
 * @typedef {{
 *   name: string,
 *   files: string[],
 *   ignores?: string[],
 *   forbiddenImportPatterns: ReadonlyArray<ImportPattern>,
 *   allowed: ReadonlyArray<string>,
 *   forbiddenGlobals: ReadonlyArray<{ name: string, message: string }>,
 *   forbiddenProperties: ReadonlyArray<{ object?: string, property: string, message: string }>,
 *   forbiddenSyntax: ReadonlyArray<{ selector: string, message: string }>,
 * }} Zone
 */

const stripSamples = ({ regex, message }) => ({ regex, message });

/** Property-only bans (no `object`) must omit the key: ESLint's schema may reject undefined. */
const propertyOption = ({ object, property, message }) =>
  object === undefined ? { property, message } : { object, property, message };

/** Maps one zone to a flat-config object, concatenating the shared entries (SD-K-2). */
export function zoneConfig(zone) {
  return {
    name: `strikezone/zone: ${zone.name}`,
    files: zone.files,
    ...(zone.ignores ? { ignores: zone.ignores } : {}),
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...SHARED_IMPORTS, ...zone.forbiddenImportPatterns].map(stripSamples) },
      ],
      'no-restricted-globals': ['error', ...zone.forbiddenGlobals],
      'no-restricted-properties': ['error', ...zone.forbiddenProperties.map(propertyOption)],
      'no-restricted-syntax': ['error', ...SHARED_SYNTAX, ...zone.forbiddenSyntax],
    },
  };
}

/** Applies to every file under src/ before the zones, so unzoned directories get the shared ban. */
export const SRC_BASE = {
  name: 'strikezone/src-base',
  files: ['src/**'],
  rules: {
    'no-restricted-imports': ['error', { patterns: SHARED_IMPORTS.map(stripSamples) }],
  },
};
