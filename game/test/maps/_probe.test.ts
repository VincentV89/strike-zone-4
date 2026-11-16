import { it } from 'vitest';
import { industrialWarehouse as map } from '@sz/maps';
import { buildNavGraph } from '@sz/nav';
import { createBoxWorldQuery } from '../support/box-world-query';
import { edgeList, fnv1aString } from '../support/nav-digest';
it('probe', () => {
  const q = createBoxWorldQuery(map);
  const g = buildNavGraph(map, q);
  if (!g.ok) throw new Error('x');
  const e = edgeList(g.value);
  console.log('PIN', g.value.nodeCount, e.length, fnv1aString(e.join('\n')), 'queries', q.calls.raycast + q.calls.lineOfSight);
  // main floor <-> side aisle connectivity without the corridor/bays
  const name = (i: number) => g.value.node(i).id;
  const start = g.value.nodeByName('aisle-w-3')!;
  const seen = new Set([start]); const qu = [start];
  for (let i = 0; i < qu.length; i++) for (const ed of g.value.edges(qu[i]!)) { const n = name(ed.to); if (/^(west|bay)/.test(n)) continue; if (!seen.has(ed.to)) { seen.add(ed.to); qu.push(ed.to); } }
  console.log('aisle-w reach w/o corridor+bays', [...seen].map(name).filter((n) => /^main|floor/.test(n)).length);
});
