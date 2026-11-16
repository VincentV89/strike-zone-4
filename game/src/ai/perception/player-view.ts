/**
 * Player view for the radar (LC-AI-04, BR-AI-21). Each call checks only the bots whose index
 * falls in this tick's stagger slot, with one ray each, so at 20 bots it casts at most 4 rays.
 */
import { angleBetween, dirFromYawPitch, distance, vec3, type ActorId } from '@sz/kernel';
import { finiteNum, finiteVec } from './guards';
import { PERCEPTION_RULES } from './rules';
import type { PlayerView, SightPort, ViewedBot } from './types';

function validView(v: PlayerView): boolean {
  return finiteVec(v.eye) && finiteNum(v.yaw) && finiteNum(v.hFovRad);
}

export function updateViewMemo(
  memo: Map<ActorId, boolean>,
  view: PlayerView,
  bots: ReadonlyArray<ViewedBot>,
  sight: SightPort,
  tick: number,
): number {
  if (!Number.isInteger(tick) || tick < 0 || !validView(view)) return 0;
  const period = PERCEPTION_RULES.staggerPeriod;
  const forward = dirFromYawPitch(view.yaw, 0);
  let rays = 0;
  bots.forEach((bot, i) => {
    if ((tick + i) % period !== 0) return;
    if (!view.alive || !bot.alive || !finiteVec(bot.chest)) {
      memo.set(bot.id, false);
      return;
    }
    const d = vec3(bot.chest.x - view.eye.x, 0, bot.chest.z - view.eye.z);
    const inside =
      distance(view.eye, bot.chest) <= PERCEPTION_RULES.playerViewRangeM &&
      angleBetween(d, forward) <= view.hFovRad / 2;
    if (!inside) {
      memo.set(bot.id, false);
      return;
    }
    rays++;
    memo.set(bot.id, sight.lineOfSight(view.eye, bot.chest));
  });
  return rays;
}
