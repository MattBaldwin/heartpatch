import { advanceTutorial, TUTORIAL_STEPS, type TutorialStep } from '@heartpatch/shared';
import type { Transaction } from '../../db/client.js';
import type { GameEvent } from '../../db/game-events.js';
import type { EventConsumer } from '../../jobs/consumers.js';
import type { Clock } from '../../lib/time.js';
import { createTutorialTxRepo, type TutorialTxRepo } from './repo.js';

/** Grants account-level rewards inside the consumer's transaction (through `repo`). */
export type GrantRewards = (repo: TutorialTxRepo, userId: string) => Promise<void>;

export interface TutorialConsumerOptions {
  clock?: Clock;
  /** Tests swap the steps. */
  steps?: readonly TutorialStep[];
  /** Tests watch the rewards; defaults to `grantCompletionRewards`. */
  grantRewards?: GrantRewards;
}

/**
 * Account-level rewards for finishing the tutorial (design doc §26, tech spec
 * §7). Called once, in the transaction that first sets
 * `users.tutorial_completed_at`, so a retry or a replay never grants twice.
 */
const grantCompletionRewards: GrantRewards = () => {
  // TODO(#44): grant the "First Patch" milestone (needs milestone_progress / milestone_rewards).
  // TODO(#43): grant the account-bound Seedling Scarf (needs clothing_owned).
  // TODO(#14, #24): remember the Partner species for new maps (needs capture first).
  return Promise.resolve();
};

/**
 * The tutorial step engine's event consumer (tech spec §7). For each event on
 * a tutorial map, in seq order: if it completes the player's current step
 * (`completeOn` in the step data), move them to the next step, or finish the
 * tutorial after the last one, and append `tutorial.advanced` so the client
 * hears it live. Exactly-once comes from the runner (`jobs/consumers.ts`).
 */
export function createTutorialConsumer(options: TutorialConsumerOptions = {}): EventConsumer {
  const steps = options.steps ?? TUTORIAL_STEPS;
  const now = options.clock ?? (() => new Date());
  const grantRewards = options.grantRewards ?? grantCompletionRewards;

  return {
    name: 'tutorial',
    mapKinds: ['tutorial'],
    handle: async (tx: Transaction, event: GameEvent) => {
      if (event.type === 'tutorial.advanced') return; // our own; never completes a step
      const repo = createTutorialTxRepo(tx);
      const player = await repo.lockMapPlayer(event.mapId);
      if (player?.tutorialStep == null) return; // an old run, or the tutorial is over

      const advance = advanceTutorial(steps, player.tutorialStep, event, player.userId);
      if (!advance) return;
      if (advance.next) {
        await repo.setStep(player.userId, advance.next.id);
      } else {
        // The account row is locked, so this is the one first completion.
        await repo.complete(player.userId, player.tutorialCompletedAt ?? now());
        if (player.tutorialCompletedAt === null) {
          await grantRewards(repo, player.userId);
        }
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
