// Hybrid deny-list matcher for names and callouts from commercial games (SEC-WM-12,
// SD-WH-2, ADR-WH-6, LC-WH-6), shared by the map content tests and the bot-ai content test
// (SEC-AI-42). Rule (a): every entry must not equal a token or a join of two
// consecutive tokens. Rule (b): entries of 7+ characters must also not appear as a substring
// of the flattened string, which catches compounds such as "oldcatwalks". Short entries are
// token-only, so "Industrial Warehouse" (which contains "dust") passes.
// Known passes, pinned in deny-list.test.ts: single tokens that contain a short entry, such
// as "dustyard" or "tspawnzone" (residual risk R-WH-2).

export const DENY_LIST: ReadonlyArray<string> = Object.freeze([
  'dust',
  'mirage',
  'inferno',
  'nuke',
  'overpass',
  'vertigo',
  'ancient',
  'anubis',
  'longa',
  'shorta',
  'bsite',
  'asite',
  'catwalk',
  'ctspawn',
  'tspawn',
  'banana',
  'middoors',
  'tunnels',
  'assault',
]);

const SUBSTRING_MIN = 7;

/** The pre-ADR-WH-4 flattening: lower case with '-', '_' and whitespace removed. */
export function flatten(s: string): string {
  return s.toLowerCase().replace(/[-_\s]/g, '');
}

/**
 * Splits on camel-case boundaries and non-alphanumerics, lower-cases, strips trailing digits
 * from each token and drops empty tokens. "de_dust2" → ['de', 'dust'], "CTSpawn" → ['ct',
 * 'spawn'], "westCatwalk" → ['west', 'catwalk'].
 */
export function tokens(s: string): string[] {
  const spaced = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase().replace(/[0-9]+$/, ''))
    .filter((t) => t.length > 0);
}

/** The deny-list entries that `s` hits; empty when the string is acceptable. */
export function denyHits(s: string): string[] {
  const toks = tokens(s);
  const words = new Set(toks);
  for (let i = 1; i < toks.length; i++) words.add(`${toks[i - 1] ?? ''}${toks[i] ?? ''}`);
  const flat = flatten(s);
  return DENY_LIST.filter((d) => words.has(d) || (d.length >= SUBSTRING_MIN && flat.includes(d)));
}
