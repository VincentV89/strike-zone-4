/**
 * World-view factory (SD-AI-4). match-loop builds the BotWorldView only through this function.
 * Every member is a closure over the real port, so bot code cannot reach raycast, resetTick,
 * clearReservations or the rest of the map definition.
 */
import type { PhysicsQuery, Vec3 } from '@sz/kernel';
import type { CoverPoint, MapDefinition, PatrolPoint } from '@sz/maps';
import type { NavGraph, PathBudget } from '@sz/nav';
import type { BotNav, BotSight, BotWorldView, SquadBoard } from './types';

export function createBotSight(query: Pick<PhysicsQuery, 'lineOfSight'>): BotSight {
  return Object.freeze({ lineOfSight: (a: Vec3, b: Vec3) => query.lineOfSight(a, b) });
}

export interface BotWorldDeps {
  readonly query: Pick<PhysicsQuery, 'lineOfSight'>;
  readonly nav: NavGraph;
  readonly budget: PathBudget;
  readonly map: Pick<MapDefinition, 'coverPoints' | 'patrolPoints'>;
  readonly board: SquadBoard;
}

const v = (p: Vec3): Vec3 => Object.freeze({ x: p.x, y: p.y, z: p.z });

function narrowNav(nav: NavGraph): BotNav {
  return Object.freeze({
    nodeCount: nav.nodeCount,
    node: (id) => nav.node(id),
    edges: (id) => nav.edges(id),
    nearestNode: (p) => nav.nearestNode(p),
    findPath: (from, to) => nav.findPath(from, to),
    findFlankPath: (from, target, avoid) => nav.findFlankPath(from, target, avoid),
    reserveRoute: (bot, route) => {
      nav.reserveRoute(bot, route);
    },
    releaseRoute: (bot) => {
      nav.releaseRoute(bot);
    },
  } satisfies BotNav);
}

const coverCopy = (c: CoverPoint): CoverPoint =>
  Object.freeze({ id: c.id, pos: v(c.pos), facing: v(c.facing), crouchOnly: c.crouchOnly });
const patrolCopy = (p: PatrolPoint): PatrolPoint => Object.freeze({ id: p.id, pos: v(p.pos) });

export function createBotWorldView(deps: BotWorldDeps): BotWorldView {
  const budget = deps.budget;
  return Object.freeze({
    sight: createBotSight(deps.query),
    nav: narrowNav(deps.nav),
    budget: Object.freeze({ tryConsume: () => budget.tryConsume() }),
    coverPoints: Object.freeze(deps.map.coverPoints.map(coverCopy)),
    patrolPoints: Object.freeze(deps.map.patrolPoints.map(patrolCopy)),
    board: deps.board,
  });
}
