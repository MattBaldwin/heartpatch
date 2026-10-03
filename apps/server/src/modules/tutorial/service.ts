import {
  addDays,
  CARE_RULES,
  firstTutorialStep,
  GAME_DATA,
  HOME_BASE_RULES,
  tonightOf,
  TUTORIAL_LAYOUT,
  TUTORIAL_SETUP,
  TUTORIAL_STEPS,
  type LocalDate,
  type PublicUser,
  type TutorialLayout,
  type TutorialSetup,
  type TutorialState,
  type TutorialStep,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { mapLocalTime, type Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { grantItems } from '../inventory/service.js';
import { createMapsRepo } from '../maps/repo.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import {
  createTutorialRepo,
  type PartnerRow,
  type TutorialProgress,
  type TutorialTxRepo,
} from './repo.js';
import { grantSeedlingScarf, PARTNER_LINE } from './rewards.js';

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
  /**
   * Night falls on the Glade now (design doc §26 step 10): only on the step
   * that waits for it. The Hollow Man takes nothing here (`tutorialOverrides`).
   */
  nightfall: (user: PublicUser) => Promise<void>;
  /**
   * Dev/test only (`HP_DEV_SQUISHY_GRANTS`): moves the run going straight to
   * `stepId`, as the step engine would (with the scarf if that step needs it).
   */
  devJump: (user: PublicUser, stepId: string) => Promise<TutorialState>;
}

/** Runs one night on a map (the Hollow's `runNightfall`); null if it already ran. */
export type RunNightfall = (mapId: string, night: LocalDate) => Promise<unknown>;

export interface TutorialServiceOptions {
  db: Executor;
  /** `HP_TUTORIAL_REQUIRED` (decision A); reported to the client. */
  tutorialRequired: boolean;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** The Hollow's nightfall, for the Glade's scripted night (step 10). */
  runNightfall?: RunNightfall;
  /** Tests swap the steps, layout and setup. */
  steps?: readonly TutorialStep[];
  layout?: TutorialLayout;
  setup?: TutorialSetup;
}

/** Safety: the scripted night looks this many nights ahead for one that hasn't come. */
const NIGHTS_AHEAD = 30;

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noAccount: 'Please log in to keep playing.',
  alreadyDone: "You've already finished with Sprout! You can replay it from Settings.",
  skipFirst: 'Finish your first adventure with Sprout, then you can skip it.',
  notStarted: "Let's start your adventure with Sprout first!",
  movedOn: 'Sprout has already moved on. Take a look!',
  tryItFirst: 'Sprout wants you to give that one a try!',
  notNightYet: "It's not time for night yet. Let's finish this step first!",
} as const;

const speciesById = new Map(GAME_DATA.species.map((s) => [s.id, s]));

function toState(
  progress: TutorialProgress,
  runMapId: string | null,
  required: boolean,
  partner: PartnerRow | null,
): TutorialState {
  const running = progress.tutorialStep !== null && runMapId !== null;
  return {
    status: running ? 'in-progress' : progress.tutorialCompletedAt ? 'completed' : 'not-started',
    stepId: running ? progress.tutorialStep : null,
    mapId: running ? runMapId : null,
    completedAt: progress.tutorialCompletedAt?.toISOString() ?? null,
    required,
    partner:
      running && partner
        ? { squishyId: partner.id, speciesId: partner.speciesId, nickname: partner.nickname }
        : null,
  };
}

export function createTutorialService(options: TutorialServiceOptions): TutorialService {
  const { db, tutorialRequired } = options;
  const steps = options.steps ?? TUTORIAL_STEPS;
  const layout = options.layout ?? TUTORIAL_LAYOUT;
  const setup = options.setup ?? TUTORIAL_SETUP;
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
    // The Glade friend who plays the first battle, and Sprout's little bag
    // (#24): the player has no squishy yet, and nothing in the Glade carries over.
    const helper = speciesById.get(setup.helper.speciesId);
    if (!helper) throw new Error(`tutorial helper ${setup.helper.speciesId} is not a species`);
    const at = now();
    await createBattlesRepo(tx).insertSquishy({
      mapId: map.id,
      ownerUserId: user.id,
      speciesId: helper.id,
      element: helper.element,
      feeling: helper.feeling,
      level: setup.helper.level,
      contentment: CARE_RULES.startContentment,
      at,
    });
    await grantItems(tx, { mapId: map.id, userId: user.id }, setup.bag, 'tutorial', map.id);
    await createSpawnsRepo(tx).markCaught(map.id, user.id, helper.id, at);
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
    const partner =
      runMapId && progress.tutorialStep !== null
        ? await store.findPartner(runMapId, user.id, PARTNER_LINE)
        : null;
    return toState(progress, runMapId, tutorialRequired, partner);
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

    devJump: async (user, stepId) => {
      const target = steps.find((s) => s.id === stepId);
      if (!target) throw new AppError('NOT_FOUND', MESSAGES.movedOn);
      const mapId = await store.transaction(async (repo, tx) => {
        const player = await lock(repo, user);
        const running = await repo.currentRun(user.id);
        if (player.tutorialStep === null || running === null) {
          throw new AppError('CONFLICT', MESSAGES.notStarted);
        }
        await repo.setStep(user.id, target.id);
        if (target.completeOn.eventType === 'outfit.changed') {
          await grantSeedlingScarf(tx, user.id, running, now());
        }
        // The client follows `tutorial.advanced` from the step on screen.
        await repo.appendEvent({
          mapId: running,
          type: 'tutorial.advanced',
          actorUserId: null,
          payload: { completedStepId: player.tutorialStep, stepId: target.id },
        });
        return running;
      });
      published(mapId);
      return state(user);
    },

    nightfall: async (user) => {
      const run = await store.transaction(async (repo) => {
        const player = await lock(repo, user);
        const running = await repo.currentRun(user.id);
        if (player.tutorialStep === null || running === null) {
          throw new AppError('CONFLICT', MESSAGES.notStarted);
        }
        const step = steps.find((s) => s.id === player.tutorialStep);
        if (step?.completeOn.eventType !== 'hollow.nightfall') {
          throw new AppError('CONFLICT', MESSAGES.notNightYet);
        }
        return { mapId: running, timeZone: player.timeZone };
      });
      // The next night that hasn't come yet falls now (its own transaction,
      // like the scheduled job; the night's row makes a double tap harmless).
      // The step engine finishes the step on its `hollow.nightfall`.
      let night = tonightOf(mapLocalTime(now(), run.timeZone), HOME_BASE_RULES);
      for (let i = 0; i < NIGHTS_AHEAD; i++, night = addDays(night, 1)) {
        if (await options.runNightfall?.(run.mapId, night)) return;
      }
      throw new AppError('CONFLICT', MESSAGES.notNightYet);
    },
  };
}
