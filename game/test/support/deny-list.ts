// Hybrid deny-list matcher (ADR-WH-6, LC-WH-6), shared by the map content tests and the bot-ai
// content test (SEC-AI-42). Names and callouts from commercial games must not appear.
//
// Matching: every entry is compared for equality against single tokens and two-token joins
// (tokens split on non-alphanumerics and camel case, trailing digits stripped). Entries of 7+
// characters are also checked as substrings of the flattened string, which catches compounds
// such as "oldcatwalks" without flagging "Industrial Warehouse" for "dust".

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

export function tokens(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.replace(/\d+$/, ''))
    .filter((t) => t.length > 0);
}

/** Deny-list entries that `s` matches; empty when the string is clean. */
export function denyHits(s: string): string[] {
  const toks = tokens(s);
  const joins = toks.slice(1).map((t, i) => `${toks[i] ?? ''}${t}`);
  const words = new Set([...toks, ...joins]);
  const flat = s.toLowerCase().replace(/[-_\s]/g, '');
  return DENY_LIST.filter((d) => words.has(d) || (d.length >= SUBSTRING_MIN && flat.includes(d)));
}
