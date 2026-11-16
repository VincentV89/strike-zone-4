// Small nav scenes for buildNavGraph tests: a floor, some solids and hand-placed nodes.
import { vec3 } from '@sz/kernel';
import {
  node,
  type MapDefinition,
  type NavLinkDef,
  type NavNodeDef,
  type RouteDef,
  type Solid,
} from '@sz/maps';
import { floor, sceneMap } from '../support/physics-scenes';

export function navScene(opts: {
  readonly nodes: ReadonlyArray<NavNodeDef>;
  readonly links?: ReadonlyArray<NavLinkDef>;
  readonly solids?: ReadonlyArray<Solid>;
  readonly routes?: ReadonlyArray<RouteDef>;
  readonly radius?: number;
  readonly noFloor?: boolean;
}): MapDefinition {
  return {
    ...sceneMap([...(opts.noFloor === true ? [] : [floor()]), ...(opts.solids ?? [])]),
    navNodes: opts.nodes,
    navLinks: opts.links ?? [],
    routes: opts.routes ?? [],
    navAutoLinkRadius: opts.radius ?? 9,
  };
}

/** n × n grid of nodes `g-<i>-<j>` spaced `step` metres apart, starting at the origin. */
export function gridNodes(n: number, step: number): NavNodeDef[] {
  const out: NavNodeDef[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++)
      out.push(node(`g-${String(i)}-${String(j)}`, vec3(i * step, 0, j * step)));
  }
  return out;
}
