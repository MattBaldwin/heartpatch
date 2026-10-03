import {
  advanceTutorial,
  isStarterSpecies,
  parseGameEventPayload,
  TUTORIAL_STEPS,
  type TutorialStep,
} from '@heartpatch/shared';
import type { Transaction } from '../../db/client.js';
import type { GameEvent } from '../../db/game-events.js';
import type { EventConsumer } from '../../jobs/consumers.js';
import type { Clock } from '../../lib/time.js';
import { appendGrowthEvents, applyXp } from '../care/service.js';
import { createTutorialTxRepo, type TutorialTxRepo } from './repo.js';
import { grantSeedlingScarf, partnerLineOf, xpToEvolve } from './rewards.js';

/** Grants account-level rewards inside the consumer's transaction. */
export type GrantRewards = (
  tx: Transaction,
  reward: { userId: string; mapId: string; at: Date },
) => Promise<void>;

export interface TutorialConsumerOptions {
  clock?: Clock;
  /** Tests swap the steps. */
  steps?: readonly TutorialStep[];
  /** Tests watch the rewards; defaults to `grantCompletionRewards`. */
  grantRewards?: GrantRewards;
}

/**
 * Account-level rewards for the tutorial (design doc §26, tech spec §7):
 * the Seedling Scarf, once per account (a per-player `ref_id`). Called when
 * the step that needs the scarf comes up and again on finishing, so a run
 * that somehow skipped the first still gets it; the second call stores
 * nothing. The First Patch milestone (#44) reads `users.tutorial_completed_at`,
 * the first completion, which the consumer sets once and replays never move.
 */
const grantCompletionRewards: GrantRewards = async (tx, { userId, mapId, at }) => {
  await grantSeedlingScarf(tx, userId, mapId, at);
};

/** A step that waits for the player to change clothes needs the scarf to wear. */
const wantsScarf = (step: TutorialStep | null): boolean =>
  step?.completeOn.eventType === 'outfit.changed';

/** A step that waits for an evolution: battles during it help the Partner grow. */
const wantsEvolution = (step: TutorialStep | undefined): boolean =>
  step?.completeOn.eventType === 'squishy.evolved';

/**
 * The tutorial step engine's event consumer (tech spec §7). For each event on
 * a tutorial map, in seq order: if it completes the player's current step
 * (`completeOn` in the step data), move them to the next step, or finish the
 * tutorial after the last one, and append `tutorial.advanced` so the client
 * hears it live. Exactly-once comes from the runner (`jobs/consumers.ts`).
 *
 * The beats the step data can't say (#24):
 * - finishing the befriend step on a starter's `squishy.captured` stores that
 *   species as the player's Partner (`users.partner_species_id`), which the
 *   starter pick on a patch pre-selects;
 * - reaching the wardrobe step grants the Seedling Scarf to put on;
 * - a battle that ends during the evolve step gives the Partner the XP to
 *   reach its next form (design doc §26 step 11), whose `squishy.evolved`
 *   then finishes the step.
 *
 * Lock order (tech spec §7): `event_consumers`, the player's `users` row,
 * then squishies and `species_seen` (care's `applyXp`), `maps` last.
 */
export function createTutorialConsumer(options: TutorialConsumerOptions = {}): EventConsumer {
  const steps = options.steps ?? TUTORIAL_STEPS;
  const now = options.clock ?? (() => new Date());
  const grantRewards = options.grantRewards ?? grantCompletionRewards;

  /** Grows the run's Partner to its next form, with care's growth events. */
  const evolvePartner = async (
    repo: TutorialTxRepo,
    tx: Transaction,
    event: GameEvent,
    partnerSpeciesId: string | null,
  ) => {
    const ended = parseGameEventPayload('battle.ended', event.payload);
    if (ended.reason === 'no-contest') return;
    const line = partnerLineOf(partnerSpeciesId);
    const partner = await repo.findPartner(event.mapId, ended.userId, line);
    const xp = partner ? xpToEvolve(partner) : 0;
    if (!partner || xp === 0) return;
    const growth = await applyXp(tx, partner.id, xp, now());
    if (growth) await appendGrowthEvents(repo.appendEvent, [growth]);
  };

  return {
    name: 'tutorial',
    mapKinds: ['tutorial'],
    handle: async (tx: Transaction, event: GameEvent) => {
      if (event.type === 'tutorial.advanced') return; // our own; never completes a step
      const repo = createTutorialTxRepo(tx);
      const player = await repo.lockMapPlayer(event.mapId);
      if (player?.tutorialStep == null) return; // an old run, or the tutorial is over

      const advance = advanceTutorial(steps, player.tutorialStep, event, player.userId);
      if (!advance) {
        const current = steps.find((s) => s.id === player.tutorialStep);
        if (
          wantsEvolution(current) &&
          event.type === 'battle.ended' &&
          event.actorUserId === player.userId
        ) {
          await evolvePartner(repo, tx, event, player.partnerSpeciesId);
        }
        return;
      }
      const at = now();
      if (event.type === 'squishy.captured') {
        const captured = parseGameEventPayload('squishy.captured', event.payload);
        // Only a starter can be a Partner (the starter pick offers no other).
        if (isStarterSpecies(captured.speciesId)) {
          await repo.setPartnerSpecies(player.userId, captured.speciesId);
        }
      }
      if (advance.next) {
        await repo.setStep(player.userId, advance.next.id);
        if (wantsScarf(advance.next)) {
          await grantRewards(tx, { userId: player.userId, mapId: event.mapId, at });
        }
      } else {
        // The account row is locked, so this is the one first completion.
        await repo.complete(player.userId, player.tutorialCompletedAt ?? at);
        await grantRewards(tx, { userId: player.userId, mapId: event.mapId, at });
      }
      await repo.appendEvent({
        mapId: event.mapId,
        type: 'tutorial.advanced',
        actorUserId: null,
        payload: { completedStepId: advance.completed.id, stepId: advance.next?.id ?? null },
      });
    },
  };
}
