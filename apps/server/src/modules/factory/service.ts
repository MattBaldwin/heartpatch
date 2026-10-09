import {
  affordableRuns,
  BATTLE_RULES,
  craftSecondsFor,
  FACTORY_RULES,
  factoryDone,
  factoryDoneAtMs,
  factoryNextAtMs,
  factoryQueues,
  GAME_DATA,
  inSeason,
  needMoreText,
  recipePageKey,
  shortfall,
  timesItems,
  type FactoryQueueResponse,
  type InventoryResponse,
  type ItemCounts,
  type Landed,
  type PublicUser,
  type StartFactoryQueueRequest,
  type StopFactoryQueueResponse,
} from '@heartpatch/shared';
import type { Executor } from '../../db/client.js';
import type { NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { createBattlesRepo } from '../battles/repo.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { createInventoryRepo, type ItemOwner } from '../inventory/repo.js';
import {
  consumeItems,
  createInventoryService,
  grantItems,
  lockGrantRows,
  recipeBookPage,
  requirePageOpen,
  seasonsOn,
} from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createFactoryRepo, type BatchRow } from './repo.js';
import { timing } from './view.js';

/*
 * The Crafting Factory (#294, owner decisions 2026-10-08): batches of the
 * pot's recipes that go on while the kid is away. A batch is one recipe,
 * `total` runs paid up front (capped at what the bag can pay for, in the same
 * transaction: CLAUDE.md rule 7), one finishing every `item_seconds`. Nothing
 * ticks (rule 4): settling banks what's made (`settleBatches`), so the bag
 * fills as things finish. Stopping keeps what's made and gives back
 * everything not finished, the one in progress too. The pot stays as it is.
 *
 * Lock order (tech spec §7): the member row (step 2, one command at a time
 * per player), the Factory's building row, then its batches in id order
 * (step 8, after any craft), then every inventory row it banks, refunds or
 * spends (step 11, one `lockGrantRows`), then `maps`.
 */

const RECIPES = new Map(GAME_DATA.recipes.map((r) => [r.id, r]));
const BUILDINGS = new Map(GAME_DATA.buildings.map((b) => [b.id, b]));
const SEASON_NAMES = new Map(GAME_DATA.seasons.map((s) => [s.id, s.name]));

// Kid-readable messages (style guide §6).
const MESSAGES = {
  noMap: "We couldn't find that patch.",
  unknownRecipe: "We don't know that recipe.",
  noFactory: 'Build a Crafting Factory at home first!',
  full: 'Your Factory is busy! A spot frees up when a batch finishes.',
  outOfSeason: (season: string) => `That recipe only works around ${season}!`,
  noBatch: "We couldn't find that batch.",
  ended: "That batch isn't running any more!",
} as const;

/** Why batches end, as events say it. `left` is stored as `taken-down`. */
export type BatchStop = 'stopped' | 'taken-down' | 'left';

/** What happens to one batch now: the new things it made, anything coming back, and whether it ends. */
export interface BatchPlan {
  readonly row: BatchRow;
  readonly done: number;
  readonly bank: ItemCounts;
  readonly refund: ItemCounts;
  /** Null: still going. */
  readonly end: 'done' | BatchStop | null;
}

const isEmpty = (items: ItemCounts) => Object.keys(items).length === 0;

/**
 * How many are made by `at`, never fewer than are banked already: a command
 * reads its clock before it waits for the member lock, so one that waited
 * can come in with an older `at` than the settle that went first. Counting
 * back would bank things twice and refund runs already banked.
 */
const madeBy = (row: BatchRow, at: Date): number =>
  Math.max(row.banked, factoryDone(timing(row), at.getTime()));

/** A settle: bank what's made since last time; a finished batch ends. */
export function settlePlan(row: BatchRow, at: Date): BatchPlan {
  const done = madeBy(row, at);
  return {
    row,
    done,
    bank: timesItems(row.output, done - row.banked),
    refund: {},
    end: done >= row.total ? 'done' : null,
  };
}

/** Stopping: bank what's made, give back every run not finished (owner decision 2026-10-08). */
export function stopPlan(row: BatchRow, at: Date, reason: BatchStop): BatchPlan {
  const kept = madeBy(row, at);
  const refunded = row.total - kept;
  return {
    row,
    done: kept,
    bank: timesItems(row.output, kept - row.banked),
    refund: timesItems(row.inputs, refunded),
    end: kept >= row.total ? 'done' : reason,
  };
}

/** Every inventory grant these plans make, for one `lockGrantRows` before any of them. */
export const planGrants = (plans: readonly BatchPlan[]) =>
  plans.flatMap((p) => [
    { userId: p.row.userId, items: p.bank },
    { userId: p.row.userId, items: p.refund },
  ]);

/**
 * Applies batch plans inside the caller's transaction: grants (ledger reason
 * `factory`, against the batch), `banked` moved on, finished or stopped
 * batches ended. The caller has locked the batches and every inventory row
 * (`planGrants`). Returns the events to append last and what landed.
 */
export async function applyBatchPlans(
  tx: Executor,
  plans: readonly BatchPlan[],
  at: Date,
): Promise<{ events: NewGameEvent[]; landed: Landed[] }> {
  const repo = createFactoryRepo(tx);
  const events: NewGameEvent[] = [];
  const landed: Landed[] = [];
  for (const { row, done, bank, refund, end } of plans) {
    const owner = { mapId: row.mapId, userId: row.userId };
    if (!isEmpty(bank)) await grantItems(tx, owner, bank, 'factory', row.id);
    if (!isEmpty(refund)) await grantItems(tx, owner, refund, 'factory', row.id);
    if (done === row.banked && end === null) continue;
    await repo.setBanked(
      row.id,
      done,
      end === null
        ? null
        : end === 'done'
          ? { at: new Date(factoryDoneAtMs(timing(row))), reason: 'done' }
          : { at, reason: end === 'left' ? 'taken-down' : end },
    );
    if (done > row.banked) {
      landed.push({ kind: 'factory', items: bank, recipeId: row.recipeId });
      events.push({
        mapId: row.mapId,
        type: 'factory.crafted',
        actorUserId: row.userId,
        payload: {
          queueId: row.id,
          userId: row.userId,
          recipeId: row.recipeId,
          count: done - row.banked,
          items: bank,
        },
      });
    }
    if (end !== null && end !== 'done') {
      events.push({
        mapId: row.mapId,
        type: 'factory.stopped',
        actorUserId: end === 'left' ? null : row.userId,
        payload: {
          queueId: row.id,
          userId: row.userId,
          recipeId: row.recipeId,
          kept: done,
          refunded: refund,
          reason: end,
        },
      });
    }
  }
  return { events, landed };
}

/**
 * Settling's part (owner decision 2026-10-06, finished things go straight
 * to the bag): locks my batches still going (step 8, after the craft) and
 * plans each. The caller adds `planGrants` to its own `lockGrantRows`, then
 * `applyBatchPlans`. `due` is when each one still going next finishes.
 */
export async function planSettleBatches(
  tx: Executor,
  owner: ItemOwner,
  at: Date,
): Promise<{ plans: BatchPlan[]; due: number[] }> {
  const rows = await createFactoryRepo(tx).lockRunning(owner);
  const plans = rows.map((row) => settlePlan(row, at));
  const due = rows.flatMap((row) => {
    const next = factoryNextAtMs(timing(row), at.getTime());
    return next === null ? [] : [next];
  });
  return { plans, due };
}

export interface FactoryService {
  /** Starts a batch of one recipe, as many as asked (or the most the bag allows). */
  start: (
    user: PublicUser,
    mapId: string,
    request: StartFactoryQueueRequest,
  ) => Promise<FactoryQueueResponse>;
  /** Stops a batch: what's made is kept, the rest comes back. */
  stop: (user: PublicUser, mapId: string, batchId: string) => Promise<StopFactoryQueueResponse>;
  /** Dev/test only: my batches finish now (e2e skips the wait). The bag, as the inventory. */
  devReady: (user: PublicUser, mapId: string) => Promise<InventoryResponse>;
}

export interface FactoryServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

export function createFactoryService(options: FactoryServiceOptions): FactoryService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createFactoryRepo(db);
  const bag = (tx: Executor, user: PublicUser, mapId: string, at: Date) =>
    createInventoryService({ db: tx, clock: () => at }).get(user, mapId);

  /** One command for one player: the member row first (step 2), then `run`. */
  async function command<T>(
    user: PublicUser,
    mapId: string,
    run: (ctx: {
      repo: Parameters<Parameters<typeof store.transaction>[0]>[0];
      tx: Executor;
      at: Date;
      timeZone: string;
    }) => Promise<T>,
  ): Promise<T> {
    const at = now();
    const result = await store.transaction(async (repo, tx) => {
      const { map } = await requireMember(tx, user, mapId);
      if (!(await createMapsRepo(tx).lockMember(map.id, user.id))) {
        throw new AppError('NOT_FOUND', MESSAGES.noMap);
      }
      return run({ repo, tx, at, timeZone: map.timeZone });
    });
    void options.publish?.(mapId);
    return result;
  }

  return {
    start: (user, mapId, request) => {
      const recipe = RECIPES.get(request.recipeId);
      if (!recipe) throw new AppError('NOT_FOUND', MESSAGES.unknownRecipe);
      return command(user, mapId, async ({ repo, tx, at, timeZone }) => {
        const owner = { mapId, userId: user.id };
        // Only in season to start; a batch started in season finishes after (owner decision 2026-10-08).
        if (!inSeason(recipe, new Set(seasonsOn(at, timeZone)))) {
          const season = SEASON_NAMES.get(recipe.season ?? '') ?? 'its season';
          throw new AppError('CONFLICT', MESSAGES.outOfSeason(season));
        }
        // A sealed recipe book page can't be made here either (owner decision 2026-10-05).
        const page = recipeBookPage(recipePageKey(recipe.id));
        if (page) await requirePageOpen(tx, user.id, page);
        const found = await repo.findFactory(owner);
        const factory = found ? await createBuildingsRepo(tx).lockBuilding(found.id) : null;
        if (!factory || factory.ownerUserId !== user.id || factory.mapId !== mapId) {
          throw new AppError('CONFLICT', MESSAGES.noFactory);
        }
        // Finished batches land first and free their spots.
        const plans = (await repo.lockRunning(owner)).map((row) => settlePlan(row, at));
        const going = plans.filter((p) => p.end === null).length;
        if (going >= factoryQueues(BUILDINGS.get(factory.buildingId), factory.level)) {
          throw new AppError('CONFLICT', MESSAGES.full);
        }
        await lockGrantRows(tx, mapId, [
          ...planGrants(plans),
          { userId: user.id, items: recipe.inputs },
        ]);
        const banked = await applyBatchPlans(tx, plans, at);
        // As many as asked, capped at what the bag can pay for (CLAUDE.md rule 7).
        const have = await createInventoryRepo(tx).lockItems(owner, Object.keys(recipe.inputs));
        const asked = request.count === 'max' ? FACTORY_RULES.maxBatch : request.count;
        const runs = affordableRuns(have, recipe.inputs, Math.min(asked, FACTORY_RULES.maxBatch));
        // Can't pay for one: the usual "You need 1 more Treats first!".
        if (runs === 0) {
          throw new AppError(
            'CONFLICT',
            needMoreText(shortfall(have, recipe.inputs), GAME_DATA.resources),
          );
        }
        // Quicker with the right squishy on the team as it starts, fixed for
        // the whole batch (owner decision 2026-10-08). A plain read: no squishy locks.
        const team = recipe.fasterWith
          ? await createBattlesRepo(tx).listTeam(mapId, user.id, BATTLE_RULES.teamSize)
          : [];
        const itemSeconds = craftSecondsFor(
          recipe,
          team.map((s) => s.element),
        );
        const batch = await repo.insertBatch({
          ...owner,
          buildingId: factory.id,
          recipeId: recipe.id,
          total: runs,
          itemSeconds,
          output: { [recipe.output.resource]: recipe.output.quantity },
          inputs: recipe.inputs,
          startedAt: at,
        });
        await consumeItems(tx, owner, timesItems(recipe.inputs, runs), 'factory', batch.id);
        for (const event of banked.events) await repo.appendEvent(event);
        await repo.appendEvent({
          mapId,
          type: 'factory.started',
          actorUserId: user.id,
          payload: {
            queueId: batch.id,
            userId: user.id,
            recipeId: recipe.id,
            total: runs,
            doneAt: new Date(at.getTime() + runs * itemSeconds * 1000).toISOString(),
          },
        });
        return { ...(await bag(tx, user, mapId, at)), queue: { id: batch.id, total: runs } };
      });
    },

    stop: (user, mapId, batchId) =>
      command(user, mapId, async ({ repo, tx, at }) => {
        const row = await repo.lockBatch(batchId);
        if (!row || row.mapId !== mapId || row.userId !== user.id) {
          throw new AppError('NOT_FOUND', MESSAGES.noBatch);
        }
        if (row.endedAt) throw new AppError('CONFLICT', MESSAGES.ended);
        const plan = stopPlan(row, at, 'stopped');
        await lockGrantRows(tx, mapId, planGrants([plan]));
        const { events } = await applyBatchPlans(tx, [plan], at);
        for (const event of events) await repo.appendEvent(event);
        return {
          ...(await bag(tx, user, mapId, at)),
          kept: plan.done,
          refunded: plan.refund,
        };
      }),

    devReady: async (user, mapId) => {
      const at = now();
      await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        await repo.makeBatchesReady({ mapId, userId: user.id }, at);
      });
      return createInventoryService({ db, clock: () => at }).get(user, mapId);
    },
  };
}
