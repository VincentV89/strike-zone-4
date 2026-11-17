// Adjacency listing and string digest for pinned nav-graph literals (SD-WM-12, BR-WH-27).
// Same format as the Desert pin in test/nav/graph.test.ts, so both maps use one convention.
import type { NavGraph } from '@sz/nav';

/** One line per undirected edge: `a|b|kind|cost`, a < b by node index. */
export function edgeList(g: NavGraph): string[] {
  const out: string[] = [];
  for (let i = 0; i < g.nodeCount; i++) {
    for (const e of g.edges(i))
      if (i < e.to) out.push(`${g.node(i).id}|${g.node(e.to).id}|${e.kind}|${e.cost.toFixed(6)}`);
  }
  return out;
}

/** FNV-1a 32-bit over a string's UTF-16 code units. */
export function fnv1aString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
