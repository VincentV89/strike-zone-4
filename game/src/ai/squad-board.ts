/**
 * SquadBoard (LC-AI-C13, BR-AI-92): per-round cover and patrol claims. One bot per cover point;
 * patrol claims are a score penalty, not a ban. It never holds player data.
 */
import type { ActorId } from '@sz/kernel';
import type { SquadBoard } from './types';

export function createSquadBoard(): SquadBoard {
  const coverByPoint = new Map<string, ActorId>();
  const coverByBot = new Map<ActorId, string>();
  const patrolByBot = new Map<ActorId, string>();

  function releaseCover(bot: ActorId): void {
    const held = coverByBot.get(bot);
    if (held !== undefined) coverByPoint.delete(held);
    coverByBot.delete(bot);
  }

  return {
    claimCover(bot, coverId) {
      const owner = coverByPoint.get(coverId);
      if (owner !== undefined && owner !== bot) return false;
      releaseCover(bot);
      coverByPoint.set(coverId, bot);
      coverByBot.set(bot, coverId);
      return true;
    },
    coverClaimant: (coverId) => coverByPoint.get(coverId),
    claimPatrol(bot, pointId) {
      patrolByBot.set(bot, pointId);
    },
    patrolClaims(pointId, except) {
      let n = 0;
      for (const [bot, p] of patrolByBot) if (p === pointId && bot !== except) n++;
      return n;
    },
    releaseCover,
    releasePatrol(bot) {
      patrolByBot.delete(bot);
    },
    releaseAll(bot) {
      releaseCover(bot);
      patrolByBot.delete(bot);
    },
    clear() {
      coverByPoint.clear();
      coverByBot.clear();
      patrolByBot.clear();
    },
    size: () => ({ cover: coverByPoint.size, patrol: patrolByBot.size }),
  };
}
