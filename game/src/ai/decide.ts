/**
 * decide (LC-AI-10, LC-AI-11): runs at 10 Hz per bot. Walks the TRANSITIONS rows of the current
 * state in order, enters the first row whose guard passes, then runs the state's upkeep.
 */
import { EMPTY_PERCEPTS, type BotPercepts } from '@sz/ai/perception';
import type { BotStateName } from '@sz/kernel';
import {
  emptyFollower,
  followPath,
  freshContext,
  freshStuck,
  releaseClaims,
  type BotBrain,
  type Phase,
} from './brain';
import { buildContext, markHandled, type DecideContext } from './context';
import { GUARDS, type Plan } from './fsm-guards';
import { finiteNum, usableSelf } from './input-guards';
import { holdDecision } from './intent-bounds';
import { AI_RULES } from './rules';
import { upkeep } from './states';
import { rowsFrom } from './transitions';
import type { BotDecision, BotSelfView, BotTransition, BotWorldView, TransitionRow } from './types';

const FIRST_PHASE: Readonly<Record<BotStateName, Phase>> = Object.freeze({
  patrol: 'choose',
  investigate: 'travel',
  engage: 'fighting',
  'take-cover': 'moving',
  flank: 'moving',
  retreat: 'moving',
  dead: 'holding',
});

const SPEED: Readonly<Record<BotStateName, number>> = Object.freeze({
  patrol: AI_RULES.walkSpeed,
  investigate: AI_RULES.runSpeed,
  engage: AI_RULES.strafeSpeed,
  'take-cover': AI_RULES.runSpeed,
  flank: AI_RULES.runSpeed,
  retreat: AI_RULES.runSpeed,
  dead: 0,
});

function exitState(brain: BotBrain, world: BotWorldView): void {
  if (brain.state === 'flank') world.nav.releaseRoute(brain.id);
  if (brain.state === 'take-cover' || brain.state === 'retreat') world.board.releaseCover(brain.id);
  if (brain.state === 'patrol') world.board.releasePatrol(brain.id);
}

function enter(
  brain: BotBrain,
  row: TransitionRow,
  plan: Plan,
  world: BotWorldView,
  now: number,
): BotTransition {
  const from = brain.state;
  if (row.to === 'dead') releaseClaims(brain, world);
  else exitState(brain, world);
  brain.state = row.to;
  brain.stateSince = now;
  brain.enteredCounts[row.to]++;
  brain.ctx = { ...freshContext(), phase: FIRST_PHASE[row.to] };
  brain.goal = plan.goal;
  brain.follower = emptyFollower();
  brain.stuck = freshStuck(now);
  if (plan.points) followPath(brain, plan.points, SPEED[row.to], now);
  if (plan.failed === true) brain.follower.failed = true;
  if (plan.targetAt !== undefined) brain.ctx.targetAt = plan.targetAt;
  if (plan.coverId !== undefined) world.board.claimCover(brain.id, plan.coverId);
  if (plan.route !== undefined && plan.route !== null) {
    world.nav.reserveRoute(brain.id, plan.route);
    brain.lastFlankRoute = plan.route;
  }
  if (plan.lowHealthRetreat === true) brain.retreatedLowHealth = true;
  return Object.freeze({ from, to: row.to, guard: row.guard, at: now });
}

/** A new sighting samples a fresh reaction time, one draw (BR-AI-53). */
function refreshReaction(brain: BotBrain, c: DecideContext): void {
  const seen = c.seen;
  if (seen === undefined || brain.reaction.forSince === seen.since) return;
  brain.reaction.forSince = seen.since;
  brain.reaction.sec = brain.rng.range(brain.params.reactionMinSec, brain.params.reactionMaxSec);
}

function runRows(
  brain: BotBrain,
  c: DecideContext,
  world: BotWorldView,
): BotTransition | undefined {
  for (const row of rowsFrom(brain.state)) {
    if (!row.urgent && c.now - brain.stateSince < AI_RULES.minDwellSec) {
      c.dwellBlocked = true;
      continue;
    }
    const plan = GUARDS.get(row.guard)?.(brain, c, world) ?? null;
    if (plan !== null) return enter(brain, row, plan, world, c.now);
  }
  return undefined;
}

/**
 * One decision for one bot. Never throws: a dead brain or an unusable input returns a hold
 * decision with no transition (BR-AI-43, BR-AI-83).
 */
export function decide(
  brain: BotBrain,
  percepts: BotPercepts | undefined,
  self: BotSelfView,
  world: BotWorldView,
  now: number,
): BotDecision {
  if (brain.state === 'dead') return holdDecision('dead');
  if (!finiteNum(now) || !usableSelf(self)) return holdDecision(brain.state);
  const c = buildContext(brain, percepts ?? EMPTY_PERCEPTS, self, now);
  refreshReaction(brain, c);
  const transition = runRows(brain, c, world);
  const wishes = upkeep(brain, c, world);
  markHandled(brain, c);
  const decision: BotDecision = Object.freeze({
    state: brain.state,
    ...(brain.goal ? { goal: brain.goal.pos } : {}),
    ...(brain.aim.aimAt ? { aimAt: brain.aim.aimAt } : {}),
    wantFire: wishes.wantFire,
    wantReload: wishes.wantReload,
    ...(transition ? { transition } : {}),
  });
  brain.decision = decision;
  return decision;
}
