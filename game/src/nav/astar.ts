/**
 * A* over the nav graph (BR-WM-41): binary min-heap, straight-line heuristic (admissible
 * because every edge cost is at least its 3D length), closed set so each node is expanded
 * at most once, ties broken by lower f and then lower NodeId for determinism.
 */
import { distance, type Vec3 } from '@sz/kernel';
import type { NavEdge, NodeId } from './types';

export interface SearchGraph {
  readonly nodeCount: number;
  pos(id: NodeId): Vec3;
  edges(id: NodeId): ReadonlyArray<NavEdge>;
}

/** Multiplier applied to an edge's cost; must be ≥ 1 to keep the heuristic admissible. */
export type CostFactor = (edge: NavEdge) => number;

export interface SearchStats {
  pops: number;
}

interface HeapItem {
  readonly f: number;
  readonly node: NodeId;
}

function less(a: HeapItem, b: HeapItem): boolean {
  return a.f < b.f || (a.f === b.f && a.node < b.node);
}

function push(heap: HeapItem[], item: HeapItem): void {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const p = heap[parent] as HeapItem;
    if (!less(item, p)) break;
    heap[i] = p;
    i = parent;
  }
  heap[i] = item;
}

function pop(heap: HeapItem[]): HeapItem | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (top === undefined || last === undefined || heap.length === 0) return top;
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    let best = last;
    const left = heap[l];
    const right = heap[r];
    if (left && less(left, best)) {
      m = l;
      best = left;
    }
    if (right && less(right, best)) m = r;
    if (m === i) break;
    heap[i] = heap[m] as HeapItem;
    i = m;
  }
  heap[i] = last;
  return top;
}

function rebuild(cameFrom: Int32Array, goal: NodeId): NodeId[] {
  const out: NodeId[] = [];
  for (let n = goal; n !== -1; n = cameFrom[n] ?? -1) out.push(n);
  return out.reverse();
}

/** Node sequence from start to goal inclusive, or null when unreachable. */
export function astar(
  g: SearchGraph,
  start: NodeId,
  goal: NodeId,
  factor: CostFactor = () => 1,
  stats?: SearchStats,
): NodeId[] | null {
  const n = g.nodeCount;
  if (!(start >= 0 && start < n && goal >= 0 && goal < n)) return null;
  const best = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const goalPos = g.pos(goal);
  const heap: HeapItem[] = [];
  best[start] = 0;
  push(heap, { f: distance(g.pos(start), goalPos), node: start });
  for (let item = pop(heap); item; item = pop(heap)) {
    const cur = item.node;
    if (closed[cur] === 1) continue;
    closed[cur] = 1;
    if (stats) stats.pops++;
    if (cur === goal) return rebuild(cameFrom, goal);
    const gCur = best[cur] ?? Infinity;
    for (const e of g.edges(cur)) {
      if (closed[e.to] === 1) continue;
      const cand = gCur + e.cost * Math.max(1, factor(e));
      if (cand < (best[e.to] ?? Infinity)) {
        best[e.to] = cand;
        cameFrom[e.to] = cur;
        push(heap, { f: cand + distance(g.pos(e.to), goalPos), node: e.to });
      }
    }
  }
  return null;
}
