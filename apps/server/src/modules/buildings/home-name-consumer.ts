import { HOME_BASE_RULES, parseGameEventPayload } from '@heartpatch/shared';
import type { Transaction } from '../../db/client.js';
import type { GameEvent } from '../../db/game-events.js';
import type { EventConsumer } from '../../jobs/consumers.js';
import { createMapsRepo } from '../maps/repo.js';
import { BUILDING_DATA } from './hearthfire.js';

const BUILDABLE = new Set<string>(HOME_BASE_RULES.buildableKinds);

/**
 * Naming your home's event consumer (#306 PR 0, tech spec §7 "Event
 * consumers"). For each event on a patch (never the Tutorial Glade), in seq
 * order, it keeps the member row's naming counters that `namingGate` reads:
 *
 * - `squishy.captured` (only a battle's befriending appends it; starters,
 *   gifts, trades, rescues and hatches don't) adds one to `caught_count`;
 * - `building.placed` of a buildable kind (`HOME_BASE_RULES.buildableKinds`)
 *   and `fence.built` add the kind to `kinds_built`, once (a set: taking a
 *   building down later keeps it);
 * - `member.left` and `member.removed` start them over, as `archiveMember`
 *   already did in the leave: they're appended in that transaction, after
 *   every event of the old home and before any of a rejoin, so a count this
 *   consumer reaches late never carries over to a fresh home base.
 *
 * Counted here rather than in the battle, build and fence transactions:
 * those hold tiles, buildings and squishies (steps 6–10) and would then
 * write the member row (step 2), the reverse of settling's and the house's
 * order. Exactly once comes from the runner (`jobs/consumers.ts`); migration
 * 0050 back-filled the counts and started this consumer at each patch's head.
 * It writes no game event, so it never takes `maps`. Lock order (tech spec
 * §7): `event_consumers` (step 1), then the player's member row (step 2,
 * one `UPDATE`).
 */
export function createHomeNamingConsumer(): EventConsumer {
  return {
    name: 'home-naming',
    mapKinds: ['multiplayer'],
    handle: async (tx: Transaction, event: GameEvent) => {
      const repo = createMapsRepo(tx);
      switch (event.type) {
        case 'squishy.captured': {
          const { userId } = parseGameEventPayload('squishy.captured', event.payload);
          await repo.countCaught(event.mapId, userId);
          return;
        }
        case 'building.placed': {
          const { userId, building } = parseGameEventPayload('building.placed', event.payload);
          const kind = BUILDING_DATA.get(building.buildingId)?.kind;
          if (kind !== undefined && BUILDABLE.has(kind)) {
            await repo.addKindBuilt(event.mapId, userId, kind);
          }
          return;
        }
        case 'fence.built': {
          const { userId } = parseGameEventPayload('fence.built', event.payload);
          if (BUILDABLE.has('fence')) await repo.addKindBuilt(event.mapId, userId, 'fence');
          return;
        }
        case 'member.left':
        case 'member.removed': {
          const { userId } = parseGameEventPayload(event.type, event.payload);
          await repo.resetNaming(event.mapId, userId);
          return;
        }
        default:
          return;
      }
    },
  };
}
