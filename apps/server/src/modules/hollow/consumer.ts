import type { EventConsumer } from '../../jobs/consumers.js';
import type { HollowService } from './service.js';

/**
 * Settles rescue expeditions (#21) when their battle ends (tech spec §7 event
 * consumers): a win brings the squishy home from the Hollow and grants the
 * day's Heartdust; a loss or no contest leaves it waiting there. Exactly once
 * per battle: the runner applies each event once, and the rescue row is
 * settled under its own lock.
 */
export function createHollowConsumer(service: Pick<HollowService, 'settleRescue'>): EventConsumer {
  return {
    name: 'hollow',
    // The Hollow Man takes nothing on tutorial maps, so there's nobody to rescue there.
    mapKinds: ['multiplayer'],
    handle: (tx, event) => service.settleRescue(tx, event),
  };
}
