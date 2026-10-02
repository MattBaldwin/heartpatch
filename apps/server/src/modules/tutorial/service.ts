import {
  firstTutorialStep,
  TUTORIAL_LAYOUT,
  TUTORIAL_STEPS,
  type PublicUser,
  type TutorialLayout,
  type TutorialState,
  type TutorialStep,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createMapsRepo } from '../maps/repo.js';
import { createTutorialRepo, type TutorialProgress, type TutorialTxRepo } from './repo.js';

export interface TutorialService {
  /** Where the player is: what the client resumes from after quitting. */
  state: (user: PublicUser) => Promise<TutorialState>;
  /** Starts the tutorial, or returns the run already going (`created: false`). */
  start: (user: PublicUser) => Promise<{ tutorial: TutorialState; created: boolean }>;
  /** A fresh run from the first step, any time (design doc §26: replay from Settings). */
  replay: (user: PublicUser) => Promise<TutorialState>;
  /** Ends any run. Only after finishing once (design doc §26). */
  skip: (user: PublicUser) => Promise<TutorialState>;
  /** The player read a talk-only step; the step engine completes it. */
  acknowledge: (user: PublicUser, stepId: string) => Promise<void>;
}

export interface TutorialServiceOptions {
  db: Executor;
  /** `HP_TUTORIAL_REQUIRED` (decision A); reported to the client. */
  tutorialRequired: boolean;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** Tests swap the steps and layout. */
  steps?: readonly TutorialStep[];
  layout?: TutorialLayout;
}

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noAccount: 'Please log in to keep playing.',
  alreadyDone: "You've already finished with Sprout! You can replay it from Settings.",
  skipFirst: 'Finish your first adventure with Sprout, then you can skip it.',
  notStarted: "Let's start your adventure with Sprout first!",
  movedOn: 'Sprout has already moved on. Take a look!',
  tryItFirst: 'Sprout wants you to give that one a try!',
} as const;

function toState(
  progress: TutorialProgress,
  runMapId: string | null,
  required: boolean,
): TutorialState {
  const running = progress.tutorialStep !== null && runMapId !== null;
  return {
    status: running ? 'in-progress' : progress.tutorialCompletedAt ? 'completed' : 'not-started',
    stepId: running ? progress.tutorialStep : null,
    mapId: running ? runMapId : null,
    completedAt: progress.tutorialCompletedAt?.toISOString() ?? null,
    required,
  };
}

export function createTutorialService(options: TutorialServiceOptions): TutorialService {
  const { db, tutorialRequired } = options;
  const steps = options.steps ?? TUTORIAL_STEPS;
  const layout = options.layout ?? TUTORIAL_LAYOUT;
  const now = options.clock ?? (() => new Date());
  /** After commit only (apps/server/README.md, "Live sync"). */
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };
  const store = createTutorialRepo(db);

  const lock = async (repo: TutorialTxRepo, user: PublicUser) => {
    const player = await repo.lockPlayer(user.id);
    if (!player) throw new AppError('UNAUTHENTICATED', MESSAGES.noAccount);
    return player;
  };

  /** Archives the player's live run, if any, so its events no longer count. */
  const endRun = async (repo: TutorialTxRepo, tx: Executor, user: PublicUser) => {
    const mapId = await repo.currentRun(user.id);
    if (mapId) await createMapsRepo(tx).archiveMember(mapId, user.id);
  };

  /**
   * Makes the Tutorial Glade for the player and puts them on the first step
   * (tech spec §7: a normal map row, `kind = 'tutorial'`, one member). Run
   * under `lock`, after `endRun`.
   */
  const newRun = async (
    repo: TutorialTxRepo,
    tx: Executor,
    user: PublicUser,
    timeZone: string,
  ): Promise<string> => {
    const maps = createMapsRepo(tx);
    const map = await repo.insertTutorialMap({ name: layout.name, timeZone });
    await maps.upsertMember({
      mapId: map.id,
      userId: user.id,
      role: 'owner',
      homeSlot: 0,
      joinedAt: now(),
    });
    await maps.insertTiles(map.id, layout.tiles);
    await maps.claimHomeTiles(map.id, 0, user.id);
    await repo.setStep(user.id, firstTutorialStep(steps).id);
    await repo.appendEvent({
      mapId: map.id,
      type: 'map.created',
      actorUserId: user.id,
      payload: {
        name: layout.name,
        timeZone,
        pvpMode: 'off',
        maxPlayers: 1,
        homeSlot: 0,
        heartSeed: layout.heartSeed,
      },
    });
    return map.id;
  };

  const state = async (user: PublicUser): Promise<TutorialState> => {
    const [progress, runMapId] = await Promise.all([
      store.progress(user.id),
      store.currentRun(user.id),
    ]);
    if (!progress) throw new AppError('UNAUTHENTICATED', MESSAGES.noAccount);
    return toState(progress, runMapId, tutorialRequired);
  };

  return {
    state,

    start: async (user) => {
      const created = await store.transaction(async (repo, tx) => {
        const player = await lock(repo, user);
        const running = await repo.currentRun(user.id);
        if (player.tutorialStep !== null && running !== null) return null;
        if (player.tutorialCompletedAt !== null) {
          throw new AppError('CONFLICT', MESSAGES.alreadyDone);
        }
        await endRun(repo, tx, user);
        return newRun(repo, tx, user, player.timeZone);
      });
      if (created) published(created);
      return { tutorial: await state(user), created: created !== null };
    },

    replay: async (user) => {
      const mapId = await store.transaction(async (repo, tx) => {
        const player = await lock(repo, user);
        await endRun(repo, tx, user);
        return newRun(repo, tx, user, player.timeZone);
      });
      published(mapId);
      return state(user);
    },

    skip: async (user) => {
      await store.transaction(async (repo, tx) => {
        const player = await lock(repo, user);
        if (player.tutorialCompletedAt === null) {
          throw new AppError('FORBIDDEN', MESSAGES.skipFirst);
        }
        await endRun(repo, tx, user);
        await repo.setStep(user.id, null);
      });
      return state(user);
    },

    acknowledge: async (user, stepId) => {
      const mapId = await store.transaction(async (repo) => {
        const player = await lock(repo, user);
        const running = await repo.currentRun(user.id);
        if (player.tutorialStep === null || running === null) {
          throw new AppError('CONFLICT', MESSAGES.notStarted);
        }
        // Only the current step, and only one that's finished by reading it:
        // gameplay steps complete on the real module's event (rule 1).
        if (stepId !== player.tutorialStep) throw new AppError('CONFLICT', MESSAGES.movedOn);
        const step = steps.find((s) => s.id === stepId);
        if (step?.completeOn.eventType !== 'tutorial.acknowledged') {
          throw new AppError('FORBIDDEN', MESSAGES.tryItFirst);
        }
        await repo.appendEvent({
          mapId: running,
          type: 'tutorial.acknowledged',
          actorUserId: user.id,
          payload: { stepId },
        });
        return running;
      });
      published(mapId);
    },
  };
}
