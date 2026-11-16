// Import-boundary zones as data (decision SD-K-2, business-logic-model import-zone model).
//
// Each zone becomes one flat-config object. Flat config REPLACES the option array of
// no-restricted-imports / -globals / -properties / -syntax for a later matching object,
// so eslint.config.mjs concatenates SHARED_IMPORTS and SHARED_SYNTAX into every zone.
//
// `samples` and `allowed` are test data for test/lint/zones.test.ts and are stripped by
// the mapper. Loosening or removing any entry needs a decision record (SEC-K-06).

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

/** SD-WM-6: network, workers, timers, dynamic code loading and global escapes. */
const IO_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'globalThis',
  'WebAssembly',
].map((name) => ({ name, message: `SD-WM-6: ${name} is not allowed in this layer.` }));

/** maps and nav (L1): pure data and maths, no console at all. */
const WORLD_L1_GLOBALS = [
  ...PURE_GLOBALS,
  { name: 'console', message: 'SD-WM-6: maps and nav report through return values, not console.' },
  ...IO_GLOBALS,
];

const NO_DYNAMIC_IMPORT = [
  { selector: 'ImportExpression', message: 'SD-WM-6: no dynamic import() in this layer.' },
];

const L1_WORLD_SAMPLES = [
  'three',
  '@dimforge/rapier3d-compat',
  '@sz/sim',
  '@sz/physics',
  '@sz/player',
];

/** physics (L3): only console.error remains, for once-per-kind fault reports (SD-WM-3). */
const PHYSICS_PROPERTIES = [
  ...PURE_PROPERTIES,
  ...['log', 'warn', 'info', 'debug', 'trace'].map((property) => ({
    object: 'console',
    property,
    message: 'SD-WM-3: physics reports faults with console.error only.',
  })),
];

// ---- player-movement zones (security-design-player-movement SD-P-1 to SD-P-3) ----

const named = (names, message) => names.map((name) => ({ name, message: `${message} (${name})` }));

/** Output, timer and escape-hatch globals banned in player and input code (SEC-P-14 to SEC-P-16). */
const NO_IO_GLOBAL_NAMES = [
  'console',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
  'Image',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'requestIdleCallback',
  'globalThis',
  'self',
  'top',
  'parent',
  'frames',
  'isFinite',
  'isNaN',
];

const PLAYER_GLOBALS = [
  ...PURE_GLOBALS,
  ...named(
    [...NO_IO_GLOBAL_NAMES, 'eval'],
    'SD-P-4/SEC-P-15: player code has no I/O, timers or coercing globals; use Number.isFinite',
  ),
];

/** DOM handles reach src/input only through createInput(deps) (SD-P-3). */
const INPUT_GLOBALS = named(
  [
    'window',
    'document',
    'navigator',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'caches',
    'location',
    'postMessage',
    'requestAnimationFrame',
    'Date',
    'crypto',
    ...NO_IO_GLOBAL_NAMES,
  ],
  'SEC-P-16: input uses only injected DOM ports, never globals, storage, network or console',
);

const INPUT_SAMPLES = [
  'three',
  '@dimforge/rapier3d-compat',
  '@sz/sim',
  '@sz/nav',
  '@sz/weapons',
  '@sz/kernel/rng',
  '@sz/player/movement',
  'node:fs',
];

/** SD-P-2: input may see @sz/player only through whole-declaration `import type`. */
const PLAYER_TYPE_ONLY = [
  {
    selector: "ImportDeclaration[source.value='@sz/player'][importKind!='type']",
    message: 'SD-P-2: import @sz/player with `import type { ... }` only.',
  },
  {
    selector: "ExportNamedDeclaration[source.value='@sz/player'][exportKind!='type']",
    message: 'SD-P-2: re-export @sz/player types only.',
  },
  {
    selector: "ExportAllDeclaration[source.value='@sz/player']",
    message: 'SD-P-2: no export-all from @sz/player.',
  },
  {
    selector: "ImportExpression[source.value='@sz/player']",
    message: 'SD-P-2: no dynamic import of @sz/player.',
  },
];

/** SD-P-3: members that reach past the narrow ports to the network or the wider DOM. */
const DOM_ESCAPE_MEMBERS = {
  selector:
    'MemberExpression[property.name=/^(defaultView|ownerDocument|createElement|sendBeacon|cookie|location|parentElement|getRootNode)$/]',
  message: 'SD-P-3: input may use only the members declared in src/input/dom/ports.ts.',
};

const PLAYER_INPUT_ZONES = [
  {
    name: 'player (L1)',
    files: ['src/player/**'],
    forbiddenImportPatterns: [
      imp('^(?!@sz/kernel$)[^.]', 'BR-P-01: src/player imports only @sz/kernel.', [
        'three',
        '@dimforge/rapier3d-compat',
        '@sz/sim',
        '@sz/nav',
        '@sz/weapons',
        '@sz/kernel/rng',
        '@sz/input',
        'node:fs',
      ]),
    ],
    allowed: ['@sz/kernel', './motion'],
    forbiddenGlobals: PLAYER_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [],
  },
  {
    name: 'input (L3)',
    files: ['src/input/**'],
    ignores: ['src/input/core/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!(@sz/(kernel|player)|@sz/input/core/[a-z-]+)$)[^.]',
        'SD-P-1: src/input imports only @sz/kernel, @sz/player types and its own core.',
        [...INPUT_SAMPLES, '@sz/input', '@sz/input/dom/bind'],
      ),
    ],
    allowed: ['@sz/kernel', '@sz/player', '@sz/input/core/state', './lock'],
    forbiddenGlobals: INPUT_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [...PLAYER_TYPE_ONLY, DOM_ESCAPE_MEMBERS],
  },
  {
    name: 'input core (L3-pure)',
    files: ['src/input/core/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!@sz/(kernel|player)$)[^.]',
        'SD-P-1: the input core imports only @sz/kernel and @sz/player types.',
        [...INPUT_SAMPLES, '@sz/input/dom/bind'],
      ),
    ],
    allowed: ['@sz/kernel', '@sz/player', './bindings'],
    forbiddenGlobals: [
      ...INPUT_GLOBALS,
      { name: 'performance', message: 'SEC-P-16: the input core is pure (performance).' },
    ],
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [
      ...PLAYER_TYPE_ONLY,
      DOM_ESCAPE_MEMBERS,
      {
        selector:
          'TSTypeReference[typeName.name=/^(Event|KeyboardEvent|MouseEvent|WheelEvent|EventTarget|Document|Window|Element|HTMLElement)$/]',
        message: 'SD-P-3: the input core takes plain values, not DOM types.',
      },
    ],
  },
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

// ---- bot-ai zones (security-design-bot-ai SD-AI-1, SD-AI-2, SD-AI-4, SD-AI-7) ----

/** Both AI zones: no I/O, timers, global escapes, eval or Reflect (SEC-AI-10, R-AI-4). */
const AI_GLOBALS = [
  ...PURE_GLOBALS,
  ...named(
    [...NO_IO_GLOBAL_NAMES, 'eval', 'Reflect'],
    'SD-AI-1: bot-ai has no I/O, timers or global escapes; use Number.isFinite',
  ),
];

/** SD-AI-2: the same four selectors as PLAYER_TYPE_ONLY, for any package. */
function typeOnly(source) {
  return [
    {
      selector: `ImportDeclaration[source.value='${source}'][importKind!='type']`,
      message: `SD-AI-2: import ${source} with \`import type { ... }\` only.`,
    },
    {
      selector: `ExportNamedDeclaration[source.value='${source}'][exportKind!='type']`,
      message: `SD-AI-2: re-export ${source} types only.`,
    },
    {
      selector: `ExportAllDeclaration[source.value='${source}']`,
      message: `SD-AI-2: no export-all from ${source}.`,
    },
    {
      selector: `ImportExpression[source.value='${source}']`,
      message: `SD-AI-2: no dynamic import of ${source}.`,
    },
  ];
}

/** SD-AI-4: members past the narrow world view (actor-mask rays, budget reset, reservation wipe). */
const AI_PORT_ESCAPES = {
  selector: 'MemberExpression[property.name=/^(raycast|resetTick|clearReservations)$/]',
  message:
    'SD-AI-4: bot-ai uses only the members of BotWorldView (no raycast, resetTick or clearReservations).',
};

/** SD-AI-7: bot-ai never creates an event bus or a clock. */
const AI_NO_BUS = {
  selector: 'ImportSpecifier[imported.name=/^(createEventBus|createFixedClock)$/]',
  message: 'SD-AI-7: bot-ai is off the bus; match-loop emits BotStateChanged from transitions.',
};

// ---- match-loop zones (security-design-match-loop SD-ML-1) ----

/** sim, round and stats: no I/O, timers, global escapes, eval, Reflect or WebAssembly (SEC-ML-40). */
const ML_GLOBALS = [
  ...PURE_GLOBALS,
  ...named(
    [...NO_IO_GLOBAL_NAMES, 'eval', 'Reflect', 'WebAssembly'],
    'SEC-ML-40: match-loop has no I/O, timers or global escapes; use Number.isFinite',
  ),
];

/** Each zone has one catch-all import pattern, so every forbidden import reports exactly once. */
const MATCH_LOOP_ZONES = [
  {
    // @sz/physics and @sz/maps pass the pattern; typeOnly() rejects any value use (R-ML-7).
    name: 'simulation (L2)',
    files: ['src/sim/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!(@sz/(kernel|player|weapons|combat|ai|nav|physics|maps)|@sz/ai/perception)$)[^.]',
        'SD-ML-1: sim imports only kernel, player, weapons, combat, ai, ai/perception, nav, and physics/maps types.',
        [
          'three',
          '@dimforge/rapier3d-compat',
          '@sz/round',
          '@sz/app',
          '@sz/render',
          '@sz/persistence',
          '@sz/ui',
          '@sz/kernel/rng',
          '@sz/ai/brain',
          '@sz/stats',
        ],
      ),
    ],
    allowed: [
      '@sz/kernel',
      '@sz/player',
      '@sz/weapons',
      '@sz/combat',
      '@sz/ai',
      '@sz/ai/perception',
      '@sz/nav',
      '@sz/physics',
      '@sz/maps',
      './step',
    ],
    forbiddenGlobals: ML_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [
      ...NO_DYNAMIC_IMPORT,
      ...typeOnly('@sz/physics'),
      ...typeOnly('@sz/maps'),
      AI_NO_BUS,
    ],
  },
  {
    // round never sees bot-ai or physics: seeds and the spawn sight check come from @sz/sim.
    name: 'round (L2)',
    files: ['src/round/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!@sz/(kernel|sim|stats|maps)$)[^.]',
        'SD-ML-1: round imports only kernel, sim, stats and maps.',
        ['@sz/ai', '@sz/physics', '@sz/player', '@sz/combat', '@sz/sim/step', '@sz/app', 'three'],
      ),
    ],
    allowed: ['@sz/kernel', '@sz/sim', '@sz/stats', '@sz/maps', './config'],
    forbiddenGlobals: ML_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [...NO_DYNAMIC_IMPORT, AI_NO_BUS],
  },
  {
    // SEC-ML-43: stats leaves the old domain (L1) zone, which is deleted.
    name: 'stats (L1)',
    files: ['src/stats/**'],
    forbiddenImportPatterns: [
      imp('^(?!@sz/kernel$)[^.]', 'SD-ML-1: stats imports only @sz/kernel.', [
        '@sz/nav',
        '@sz/sim',
        '@sz/weapons',
        '@sz/kernel/rng',
        'three',
      ]),
    ],
    allowed: ['@sz/kernel', './saturate'],
    forbiddenGlobals: ML_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [...NO_DYNAMIC_IMPORT, AI_NO_BUS],
  },
];

// ---- presentation-3d zones (security-design-presentation-3d SD-R-1) ----

/** render and assets: no DOM globals, I/O, timers, clocks or escapes; DOM arrives as ports. */
const RENDER_GLOBALS = uniqueByName([
  ...named(
    [
      'window',
      'document',
      'navigator',
      'location',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'caches',
      'postMessage',
      'requestAnimationFrame',
      'performance',
      'Date',
      'crypto',
      'importScripts',
      ...NO_IO_GLOBAL_NAMES,
      'eval',
      'Function',
      'Reflect',
      'WebAssembly',
    ],
    'SD-R-1/SEC-R-01: render and assets have no DOM globals, I/O, timers, clocks or escapes',
  ),
]);

const RENDER_SYNTAX = [
  ...NO_DYNAMIC_IMPORT,
  ...typeOnly('@sz/sim'),
  ...typeOnly('@sz/maps'),
  ...typeOnly('@sz/assets'),
  AI_NO_BUS,
  {
    selector: 'ImportDeclaration[source.value=/^three/] > ImportNamespaceSpecifier',
    message: 'SD-R-1: import named members from three (tree-shaking, API bans).',
  },
  {
    selector:
      "ImportDeclaration[source.value='three'] > ImportSpecifier[imported.name=/(Loader|LoadingManager)$|^(Cache|PCFSoftShadowMap|VSMShadowMap|WebGPURenderer|setConsoleFunction)$/]",
    message:
      'SEC-R-02/ADR-R-6/SEC-R-16: no loaders, removed shadow types, WebGPU or console hooks.',
  },
  {
    selector:
      'MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML|createElement|createElementNS|createContextualFragment|srcdoc|defaultView|ownerDocument|getRootNode|parentElement|cookie|sendBeacon|setAnimationLoop|readPixels)$/]',
    message:
      'SEC-R-09: render uses only the injected canvas; no DOM creation, escape members or pixel readback.',
  },
  {
    selector: 'Literal[value=/debug_renderer_info/i]',
    message: 'SEC-R-15: never query GPU vendor or renderer strings.',
  },
  {
    selector: 'TryStatement',
    message: 'NFR-R-R5: bugs propagate to app-shell; the only conversion is runStep().',
  },
];

const RENDER_ZONES = [
  {
    name: 'render and assets (L3)',
    files: ['src/render/**', 'src/assets/**'],
    ignores: ['src/render/core/**', 'src/assets/core/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!(@sz/(kernel|weapons|sim|maps|assets)|three|three/addons/utils/BufferGeometryUtils\\.js|@sz/(render|assets)/core/[a-z-]+)$)[^.]',
        'SD-R-1: render/assets import only kernel, weapons, three (+BufferGeometryUtils), core modules, and sim/maps/assets types.',
        [
          'three/webgpu',
          'three/tsl',
          'three/addons',
          'three/addons/loaders/GLTFLoader.js',
          'three/examples/jsm/x.js',
          'three/src/math/Matrix4.js',
          '@sz/physics',
          '@sz/round',
          '@sz/ai',
          '@sz/ui',
          '@sz/audio',
          '@sz/kernel/rng',
          'fflate',
          'meshoptimizer',
          '@tweenjs/tween.js',
          '@dimforge/rapier3d-compat',
        ],
      ),
    ],
    allowed: [
      '@sz/kernel',
      '@sz/weapons',
      '@sz/sim',
      '@sz/maps',
      '@sz/assets',
      'three',
      'three/addons/utils/BufferGeometryUtils.js',
      '@sz/render/core/pool',
      './x',
    ],
    forbiddenGlobals: RENDER_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: RENDER_SYNTAX,
  },
  {
    // Must come after the parent zone: it repeats every parent entry (flat config replaces arrays).
    name: 'render/assets core (L3-pure)',
    files: ['src/render/core/**', 'src/assets/core/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!(@sz/(kernel|weapons|sim|maps)|@sz/(render|assets)/core/[a-z-]+)$)[^.]',
        'SD-R-1: core is three-free; it imports only kernel, weapons, core modules and sim/maps types.',
        [
          'three',
          'three/addons/utils/BufferGeometryUtils.js',
          '@sz/assets',
          '@sz/render/gl/renderer',
          '@sz/physics',
          '@sz/kernel/rng',
        ],
      ),
    ],
    allowed: [
      '@sz/kernel',
      '@sz/weapons',
      '@sz/sim',
      '@sz/maps',
      '@sz/assets/core/rig-parts',
      './x',
    ],
    forbiddenGlobals: RENDER_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [
      ...RENDER_SYNTAX,
      {
        selector:
          'TSTypeReference[typeName.name=/^(HTMLCanvasElement|HTMLElement|OffscreenCanvas|WebGL2RenderingContext|WebGLRenderingContext|Document|Window|ImageData|CanvasRenderingContext2D)$/]',
        message: 'SD-R-1: core has no DOM or GL types.',
      },
    ],
  },
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
    // ADR-WC-7: own zone, not in domain (L1), so no file matches two zones. One pattern bans
    // every non-relative import except @sz/kernel; it subsumes the old shared L1 list (which would
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
    // SD-AI-1: one catch-all import pattern, so each forbidden import reports exactly once.
    name: 'perception (L1)',
    files: ['src/ai/perception/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!(@sz/(kernel|player)|@sz/ai/perception/[a-z-]+)$)[^.]',
        'SD-AI-1/dec-perception-gateway: perception imports only @sz/kernel and @sz/player types.',
        [
          '@sz/ai',
          '@sz/ai/brain',
          '@sz/combat',
          '@sz/physics',
          '@sz/sim',
          '@sz/nav',
          '@sz/kernel/rng',
          'three',
          '@dimforge/rapier3d-compat',
        ],
      ),
    ],
    allowed: ['@sz/kernel', '@sz/player', '@sz/ai/perception/types', './memory'],
    forbiddenGlobals: AI_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [...NO_DYNAMIC_IMPORT, ...PLAYER_TYPE_ONLY, AI_PORT_ESCAPES, AI_NO_BUS],
  },
  {
    name: 'bot-ai (L1, no-cheat)',
    files: ['src/ai/**'],
    ignores: ['src/ai/perception/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!(@sz/(kernel|nav|weapons|maps)|@sz/ai/perception)$)[^.]',
        'req-bot-no-cheat/SD-AI-1: bot-ai learns about the player only through perception (BotPercepts).',
        [
          '@sz/player',
          '@sz/combat',
          '@sz/combat/damage',
          '@sz/physics',
          '@sz/sim',
          '@sz/ai/perception/sense',
          '@sz/maps/desert-compound',
          '@sz/kernel/rng',
          'three',
          '@dimforge/rapier3d-compat',
          '@sz/audio',
        ],
      ),
    ],
    allowed: ['@sz/kernel', '@sz/ai/perception', '@sz/nav', '@sz/weapons', '@sz/maps', './brain'],
    forbiddenGlobals: AI_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: [...NO_DYNAMIC_IMPORT, ...typeOnly('@sz/maps'), AI_PORT_ESCAPES, AI_NO_BUS],
  },
  ...MATCH_LOOP_ZONES,
  {
    name: 'maps (L1)',
    files: ['src/maps/**'],
    forbiddenImportPatterns: [
      imp('^(?!@sz/kernel$)[^.]', 'BR-WM-06: map-catalog imports only @sz/kernel.', [
        ...L1_WORLD_SAMPLES,
        '@sz/nav',
        '@sz/kernel/rng',
      ]),
    ],
    allowed: ['@sz/kernel', './types'],
    forbiddenGlobals: WORLD_L1_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: NO_DYNAMIC_IMPORT,
  },
  {
    name: 'nav (L1)',
    files: ['src/nav/**'],
    forbiddenImportPatterns: [
      imp(
        '^(?!@sz/(kernel|maps)$)[^.]',
        'BR-WM-06: navigation imports only @sz/kernel and @sz/maps.',
        [...L1_WORLD_SAMPLES, '@sz/kernel/rng', '@sz/maps/types'],
      ),
    ],
    allowed: ['@sz/kernel', '@sz/maps', './types'],
    forbiddenGlobals: WORLD_L1_GLOBALS,
    forbiddenProperties: PURE_PROPERTIES,
    forbiddenSyntax: NO_DYNAMIC_IMPORT,
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
      imp(
        '^@sz/(nav|player|weapons|combat|ai|perception|stats)(/|$)',
        'SD-WM-6: physics must not import domain gameplay or navigation.',
        ['@sz/nav', '@sz/player', '@sz/combat', '@sz/ai'],
      ),
      imp('^@dimforge/rapier3d-compat/', 'SD-WM-10: import Rapier through its package root only.', [
        '@dimforge/rapier3d-compat/dist/rapier.mjs',
      ]),
      imp('^@dimforge/rapier3d$', 'SD-WM-10: use the compat build (inlined WASM, no fetch).', [
        '@dimforge/rapier3d',
      ]),
      KERNEL_DEEP,
    ],
    allowed: ['@sz/kernel', '@sz/maps', '@dimforge/rapier3d-compat'],
    forbiddenGlobals: [
      ...BROWSER_GLOBALS,
      { name: 'Date', message: 'BR-WM-71: the adapter takes dt from the caller.' },
      { name: 'crypto', message: 'SEC-K-07: no randomness in the adapter.' },
      ...IO_GLOBALS,
    ],
    forbiddenProperties: PHYSICS_PROPERTIES,
    forbiddenSyntax: [
      {
        selector: "ImportExpression:not([source.value='@dimforge/rapier3d-compat'])",
        message: 'SD-WM-10: the only dynamic import in physics is Rapier itself.',
      },
    ],
  },
  ...RENDER_ZONES,
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
    name: 'diagnostics (L3)',
    files: ['src/diagnostics/**'],
    forbiddenImportPatterns: [THREE, RAPIER, APP, KERNEL_DEEP],
    allowed: ['@sz/kernel'],
    forbiddenGlobals: STORAGE_GLOBALS,
    forbiddenProperties: [],
    forbiddenSyntax: [],
  },
  ...PLAYER_INPUT_ZONES,
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
    allowed: ['@sz/kernel', '@sz/round', '@sz/render', 'three', '@sz/player', '@sz/input'],
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
