/**
 * Composition-time binding of the event bus to the audio adapter
 * (business-logic-model-game-audio W5). Lives in core (not the barrel) so it
 * counts toward coverage.
 */
import type { ActorId, DomainEvent, EventBus, Unsubscribe } from '@sz/kernel';
import { cuesForEvent } from './router';
import type { AudioAdapter, PlayOptions } from './types';

/**
 * Subscribes once with subscribeAll. The subscription survives bus.clear() on
 * restart (BR-K-26). Router throws are not swallowed (SD-A-7).
 */
export function bindAudioToEvents(
  bus: EventBus<DomainEvent>,
  audio: Pick<AudioAdapter, 'play'>,
  playerId: ActorId,
): Unsubscribe {
  return bus.subscribeAll((e) => {
    for (const r of cuesForEvent(e, playerId)) {
      const opts: PlayOptions = {
        ...(r.gainScale !== undefined ? { gainScale: r.gainScale } : {}),
        ...(r.key !== undefined ? { key: r.key } : {}),
      };
      audio.play(r.cue, r.at, opts);
    }
  });
}
