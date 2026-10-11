import {
  addXp,
  BATTLE_RULES,
  CARE_RULES,
  careCoins,
  careGain,
  contentmentAfterCare,
  contentmentAt,
  evolvingMeter,
  GAME_DATA,
  grantedXp,
  GROWTH_RULES,
  moodFor,
  statsAtLevel,
  xpMultiplier,
  xpProgress,
  type EvolvingMeter,
  type CareAction,
  type CareListResponse,
  type CareResponse,
  type CareSquishy,
  type ElementId,
  type FeelingId,
  type EvolutionStep,
  type HabitatTags,
  type PublicUser,
  type Species,
} from '@heartpatch/shared';
import { EVOLUTION_RULES, SERVER_GAME_DATA, addLean } from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import type { GameEvent, NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import { assertAllowedText } from '../../lib/filter.js';
import type { Clock } from '../../lib/time.js';
import { accountDay, creditCoins } from '../coins/service.js';
import { createInventoryRepo } from '../inventory/repo.js';
import { consumeItems } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createMapsRepo } from '../maps/repo.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { wornAccessories } from '../wardrobe/accessories.js';
import {
  WIN_LEAN,
  careLean,
  formsAt,
  leanColumns,
  leanOf,
  rollStep,
  whisperOf,
  type LoggedRoll,
} from './evolution.js';
import { createCareRepo, type CareRepo, type CareSquishyRow } from './repo.js';

/*
 * Care, contentment, levels and evolution (#19, design doc §7–8, DECISIONS
 * G). Contentment is stored as its value at the last care action plus when
 * that was, and worked out on read (CLAUDE.md rule 4). Care actions count per
 * squishy per account day for diminishing returns; Patch Coins from care are
 * capped per account per day, computed here and paid out by `creditCoins`
 * (#45) in the same transaction.
 * Battle XP goes through `applyXp`: care × habitat multiplier, levels, and
 * Phase 1's level-based evolution to the single next form.
 */

const CARE_ACTIONS = new Map<string, CareAction>(GAME_DATA.careActions.map((a) => [a.id, a]));
/** Only care this recent can still be debounced (`cooldownSeconds`), so older rows aren't read. */
const DEBOUNCE_MS = Math.max(0, ...GAME_DATA.careActions.map((a) => a.cooldownSeconds)) * 1000;
const debounceSince = (at: Date) => new Date(at.getTime() - DEBOUNCE_MS);
const PUBLIC_SPECIES = new Map(GAME_DATA.species.map((s) => [s.id, s]));
const SECRET_SPECIES = new Map(SERVER_GAME_DATA.secretSpecies.map((s) => [s.id, s]));
const speciesOf = (id: string): Species | undefined =>
  PUBLIC_SPECIES.get(id) ?? SECRET_SPECIES.get(id);

/**
 * Every evolution, public ones first (`Species.evolutions`, on public and
 * secret species), then the server-only ones into secret forms. The target
 * of a secret one is never sent before it happens (CLAUDE.md rule 6).
 */
export const EVOLUTION_STEPS: readonly EvolutionStep[] = [
  ...[...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies].flatMap((s) =>
    s.evolutions.map((e) => ({ from: s.id, into: e.into, level: e.level })),
  ),
  ...SERVER_GAME_DATA.secretEvolutions,
];

/**
 * Progress toward a squishy's next evolution (#205). Null on a top form or
 * when a secret form comes next: nothing about a secret evolution leaves the
 * server (CLAUDE.md rule 6).
 */
export function evolvingOf(squishy: {
  speciesId: string;
  level: number;
  xp: number;
  joinedLevel: number | null;
}): EvolvingMeter | null {
  return evolvingMeter(squishy, EVOLUTION_STEPS, (id) => PUBLIC_SPECIES.has(id), GROWTH_RULES);
}

/** Habitat tags by building content id (#18 data). */
const HABITAT_TAGS = new Map<string, HabitatTags>(
  GAME_DATA.buildings.flatMap((b) => (b.kind === 'habitat' ? [[b.id, b.tags] as const] : [])),
);

/** Evolution chains can't loop (data checks), so this only guards against bad data. */
const MAX_EVOLUTIONS_AT_ONCE = 4;

// Kid-readable messages (style guide §6).
const MESSAGES = {
  unknownAction: "We don't know that kind of care.",
  noSquishy: "We couldn't find that squishy.",
  inHollow: 'That squishy is in the Hollow right now. Rescue them first!',
  inTrade: 'That squishy is waiting at a trading post right now. 📬',
  tooSoon: (name: string) => `${name} needs a tiny moment. Try again soon!`,
} as const;

export interface CareService {
  /** My active squishies on this map, as their care sheets show them. */
  list: (user: PublicUser, mapId: string) => Promise<CareListResponse>;
  /** One care action (feed, pet or play) on one of my squishies. */
  care: (
    user: PublicUser,
    mapId: string,
    squishyId: string,
    actionId: string,
  ) => Promise<CareResponse>;
  /** The owner saw a squishy's evolution celebrated. */
  seen: (user: PublicUser, mapId: string, squishyId: string) => Promise<CareListResponse>;
  /**
   * The owner renamed a squishy (#20): `nickname` is already trimmed by
   * `NicknameSchema`, or null for the species name again.
   */
  rename: (
    user: PublicUser,
    mapId: string,
    squishyId: string,
    nickname: string | null,
  ) => Promise<CareListResponse>;
}

export interface CareServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
}

const nameOf = (row: Pick<CareSquishyRow, 'nickname' | 'speciesId'>) =>
  row.nickname ?? speciesOf(row.speciesId)?.name ?? 'Your squishy';

/** Contentment at `at` (shared `contentmentAt` over the stored columns). */
const contentmentOf = (row: CareSquishyRow, at: Date) =>
  contentmentAt(
    { contentment: row.contentmentAtLastCare, lastCaredAt: row.lastCaredAt },
    at,
    CARE_RULES,
  );

/** The tags of a squishy's habitat, or null when it has none (or it isn't a habitat). */
async function habitatTagsFor(
  repo: CareRepo,
  rows: readonly CareSquishyRow[],
): Promise<Map<string, HabitatTags>> {
  const ids = [...new Set(rows.flatMap((r) => (r.habitatBuildingId ? [r.habitatBuildingId] : [])))];
  const buildingIds = await repo.habitatBuildingIds(ids);
  const tags = new Map<string, HabitatTags>();
  for (const [rowId, buildingId] of buildingIds) {
    const habitat = HABITAT_TAGS.get(buildingId);
    if (habitat) tags.set(rowId, habitat);
  }
  return tags;
}

/**
 * The habitat whose tags count for a squishy's XP, or null. A squishy on
 * watch gets none: housed or on watch, not both (owner decision 2026-10-03).
 */
const habitatOf = (
  tags: ReadonlyMap<string, HabitatTags>,
  row: CareSquishyRow,
): HabitatTags | null => (row.onWatch ? null : (tags.get(row.habitatBuildingId ?? '') ?? null));

/** Stats at a level; a species dropped from the data shows the smallest stats rather than failing. */
const MISSING_BASE_STATS = { hp: 1, attack: 1, defense: 1, speed: 1 };

/** What `applyXp` did to one squishy. */
export interface Growth {
  squishyId: string;
  mapId: string;
  ownerUserId: string;
  /** XP actually granted: base × the care and habitat multiplier. */
  xp: number;
  multiplier: number;
  fromLevel: number;
  level: number;
  totalXp: number;
  /** Each form it grew into, in order (usually none); `branch`: a branch form, not the default (#32). */
  evolutions: { fromSpeciesId: string; intoSpeciesId: string; branch: boolean }[];
  /**
   * The evolving meter's percent before and after this XP (#205), for the
   * results card; null where it shows no meter. After is null for one that
   * evolved: the evolution celebration takes over.
   */
  evolvingBefore: number | null;
  evolvingAfter: number | null;
}

/**
 * Grants battle XP to one squishy inside the caller's transaction (the
 * battles module, under its squishy row locks): `baseXp` × the care and
 * habitat multiplier (floor 1.0×, cap 3×; neglected squishies still get the
 * base, design doc §7), then levels from the XP curve and Phase 1 evolution
 * to the single next form at its level (design doc §8). Writes no events:
 * call `appendGrowthEvents` after the caller's own event. Null if there's no
 * such squishy. `plain`: grant `baseXp` as it is, with no care or habitat
 * multiplier (Training Grounds XP, owner decision 2026-10-06: XP per hour).
 */
export async function applyXp(
  tx: Executor,
  squishyId: string,
  baseXp: number,
  at: Date,
  options: { plain?: boolean; won?: boolean } = {},
): Promise<Growth | null> {
  const repo = createCareRepo(tx);
  const row = await repo.lockSquishy(squishyId);
  if (!row) return null;
  const habitat = habitatOf(await habitatTagsFor(repo, [row]), row);
  const multiplier =
    options.plain === true ? 100 : xpMultiplier(contentmentOf(row, at), habitat, row, GROWTH_RULES);
  const xp = grantedXp(baseXp, multiplier);
  const next = addXp({ level: row.level, xp: row.xp }, xp, GROWTH_RULES);

  // A win leans it Brave (#32); the lean is folded in before any roll reads it.
  let lean = leanOf(row, habitat, at);
  if (options.won === true) {
    lean = addLean(lean, WIN_LEAN.feeling, WIN_LEAN.points, at, EVOLUTION_RULES);
  }
  const housed = row.habitatBuildingId !== null;
  const leanRow = { ...row, ...leanColumns(lean, at, housed) };

  let speciesId = row.speciesId;
  let element: ElementId = row.element;
  let feeling: FeelingId = row.feeling;
  const evolutions: Growth['evolutions'] = [];
  const rolls: (LoggedRoll | null)[] = [];
  for (let i = 0; i < MAX_EVOLUTIONS_AT_ONCE; i += 1) {
    const forms = formsAt(speciesId, next.level);
    if (forms.length === 0) break;
    // A step with branches rolls (#32); a single form needs no roll.
    const roll =
      forms.length > 1
        ? await rollStep(
            tx,
            {
              ...leanRow,
              feeling,
              contentmentSum: row.careSum,
              contentmentSamples: row.careSamples,
            },
            habitat,
            forms,
            at,
          )
        : null;
    const into = speciesOf(roll?.pick ?? forms[0]?.into ?? '');
    if (!into) break;
    const branch = roll?.branch ?? false;
    evolutions.push({ fromSpeciesId: speciesId, intoSpeciesId: into.id, branch });
    rolls.push(roll);
    speciesId = into.id;
    element = into.element;
    // The default form keeps its own feeling; a branch form takes the
    // branch's, because it grew into it (owner decision 2026-10-10, #32).
    if (branch) feeling = into.feeling;
  }

  await repo.setGrowth(row.id, {
    xp: next.xp,
    level: next.level,
    speciesId,
    element,
    ...(feeling !== row.feeling ? { feeling } : {}),
    ...leanColumns(lean, at, housed),
    // A row the previous release wrote has no joining level: its first XP
    // pins it at the level it had, so its meter stops restarting (#205).
    ...(row.joinedLevel === null ? { joinedLevel: row.level } : {}),
  });
  for (const [i, evolution] of evolutions.entries()) {
    const roll = rolls[i] ?? null;
    await repo.insertEvolution({
      mapId: row.mapId,
      squishyId: row.id,
      userId: row.ownerUserId,
      ...evolution,
      roll: roll ? (JSON.parse(JSON.stringify(roll)) as Record<string, unknown>) : null,
      level: next.level,
      evolvedAt: at,
    });
    // Its new form is a friend too: the catalog gets its card (and its row, if secret).
    await createSpawnsRepo(tx).markCaught(row.mapId, row.ownerUserId, evolution.intoSpeciesId, at);
  }
  return {
    squishyId: row.id,
    mapId: row.mapId,
    ownerUserId: row.ownerUserId,
    xp,
    multiplier,
    fromLevel: row.level,
    level: next.level,
    totalXp: next.xp,
    evolutions,
    evolvingBefore: evolvingOf(row)?.percent ?? null,
    evolvingAfter:
      evolutions.length > 0
        ? null
        : (evolvingOf({ ...row, level: next.level, xp: next.xp })?.percent ?? null),
  };
}

/** Appends a game event in the caller's transaction (a module's `repo.appendEvent`). */
export type AppendEvent = <T extends NewGameEvent['type']>(
  event: NewGameEvent<T>,
) => Promise<GameEvent>;

/** `squishy.leveled` and `squishy.evolved` for what `applyXp` did, in the caller's transaction. */
export async function appendGrowthEvents(
  appendEvent: AppendEvent,
  growths: readonly Growth[],
): Promise<void> {
  for (const event of growthEvents(growths)) await appendEvent(event);
}

/** The `squishy.leveled` and `squishy.evolved` events for what `applyXp` did, in order. */
export function growthEvents(growths: readonly Growth[]): NewGameEvent[] {
  const events: NewGameEvent[] = [];
  for (const g of growths) {
    if (g.level > g.fromLevel) {
      events.push({
        mapId: g.mapId,
        type: 'squishy.leveled',
        actorUserId: g.ownerUserId,
        payload: {
          userId: g.ownerUserId,
          squishyId: g.squishyId,
          fromLevel: g.fromLevel,
          level: g.level,
          xp: g.totalXp,
        },
      });
    }
    for (const evolution of g.evolutions) {
      events.push({
        mapId: g.mapId,
        type: 'squishy.evolved',
        actorUserId: g.ownerUserId,
        payload: { userId: g.ownerUserId, squishyId: g.squishyId, ...evolution, level: g.level },
      });
    }
  }
  return events;
}

export function createCareService(options: CareServiceOptions): CareService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const store = createCareRepo(db);
  const published = (mapId: string) => {
    void options.publish?.(mapId);
  };

  /** Everything the care sheets show, read through `repo` (inside or outside a transaction). */
  async function careView(
    repo: CareRepo,
    tx: Executor,
    mapId: string,
    userId: string,
    at: Date,
  ): Promise<CareListResponse> {
    // The account's day, for diminishing returns and the coin cap.
    const day = await accountDay(tx, userId, at);
    const rows = await repo.listActive(mapId, userId);
    const ids = rows.map((r) => r.id);
    const [habitats, counts, lastCare, coinsToday, unseen, items, worn] = await Promise.all([
      habitatTagsFor(repo, rows),
      repo.countCareOn(ids, day),
      repo.lastCare(ids, debounceSince(at)),
      repo.coinsOn(userId, day),
      repo.unseenEvolutions(ids),
      createInventoryRepo(tx).list({ mapId, userId }),
      wornAccessories(tx, userId, ids),
    ]);

    // Species rows the client can't have: secret forms the player owns, or
    // just grew out of (DECISIONS, secret species: they've met these).
    const wanted = new Set(rows.map((r) => r.speciesId));
    for (const e of unseen.values()) wanted.add(e.fromSpeciesId).add(e.intoSpeciesId);
    const speciesDefs = [...wanted].flatMap((id) => {
      const secret = PUBLIC_SPECIES.has(id) ? undefined : SECRET_SPECIES.get(id);
      return secret ? [secret] : [];
    });

    const squishies = rows.map((row): CareSquishy => {
      const contentment = contentmentOf(row, at);
      const habitat = habitatOf(habitats, row);
      const caredToday = counts.get(row.id) ?? 0;
      const nextCareAt: Record<string, string> = {};
      for (const [action, when] of lastCare.get(row.id) ?? []) {
        const cooldown = CARE_ACTIONS.get(action)?.cooldownSeconds ?? 0;
        const ready = when.getTime() + cooldown * 1000;
        if (ready > at.getTime()) nextCareAt[action] = new Date(ready).toISOString();
      }
      const evolution = unseen.get(row.id);
      const base = speciesOf(row.speciesId)?.baseStats ?? MISSING_BASE_STATS;
      const progress = xpProgress(row, GROWTH_RULES);
      return {
        id: row.id,
        speciesId: row.speciesId,
        element: row.element,
        feeling: row.feeling,
        nickname: row.nickname,
        level: row.level,
        xp: row.xp,
        xpIntoLevel: progress.intoLevel,
        xpToNext: progress.toNext,
        evolving: evolvingOf(row),
        stats: statsAtLevel(base, row.level, BATTLE_RULES),
        contentment,
        mood: moodFor(contentment, CARE_RULES),
        xpBonusPercent: xpMultiplier(contentment, habitat, row, GROWTH_RULES),
        habitatId: row.habitatBuildingId,
        caredToday,
        fullCareLeft: Math.max(0, CARE_RULES.fullActionsPerDay - caredToday),
        nextCareAt,
        newEvolution: evolution
          ? {
              fromSpeciesId: evolution.fromSpeciesId,
              intoSpeciesId: evolution.intoSpeciesId,
              level: evolution.level,
              at: evolution.evolvedAt.toISOString(),
              ...(evolution.branch ? { branch: true } : {}),
            }
          : null,
        accessory: worn.get(row.id) ?? null,
        whisper: whisperOf(
          { ...row, name: nameOf(row) },
          habitat,
          evolvingOf(row)?.percent ?? null,
          at,
        ),
      };
    });
    return { squishies, speciesDefs, items, coinsToday, now: at.toISOString() };
  }

  /** One of my active squishies on this map, locked until commit. */
  async function lockMine(
    repo: CareRepo,
    user: PublicUser,
    mapId: string,
    squishyId: string,
  ): Promise<CareSquishyRow> {
    const row = await repo.lockSquishy(squishyId);
    if (!row || row.mapId !== mapId || row.ownerUserId !== user.id) {
      throw new AppError('NOT_FOUND', MESSAGES.noSquishy);
    }
    if (row.state === 'in-trade') throw new AppError('CONFLICT', MESSAGES.inTrade);
    if (row.state !== 'active') throw new AppError('CONFLICT', MESSAGES.inHollow);
    return row;
  }

  return {
    list: async (user, mapId) => {
      await requireMember(db, user, mapId);
      return careView(store, db, mapId, user.id, now());
    },

    care: async (user, mapId, squishyId, actionId) => {
      const action = CARE_ACTIONS.get(actionId);
      if (!action) throw new AppError('VALIDATION_FAILED', MESSAGES.unknownAction);
      const at = now();
      const reply = await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        // The account first: the daily coin cap spans every squishy and patch.
        await createMapsRepo(tx).lockUser(user.id);
        const row = await lockMine(repo, user, mapId, squishyId);

        // A short debounce, so one stroke or a double tap counts once.
        const last = (await repo.lastCare([row.id], debounceSince(at))).get(row.id)?.get(action.id);
        if (last && at.getTime() - last.getTime() < action.cooldownSeconds * 1000) {
          throw new AppError('CONFLICT', MESSAGES.tooSoon(nameOf(row)));
        }

        const day = await accountDay(tx, user.id, at);
        const today = (await repo.countCareOn([row.id], day)).get(row.id) ?? 0;
        const gain = careGain(action, today, CARE_RULES);
        const coins = careCoins(gain, await repo.coinsOn(user.id, day), CARE_RULES);
        const contentment = contentmentAfterCare(
          { contentment: row.contentmentAtLastCare, lastCaredAt: row.lastCaredAt },
          at,
          gain.contentment,
          CARE_RULES,
        );
        const careId = await repo.insertCare({
          mapId,
          userId: user.id,
          squishyId: row.id,
          action: action.id,
          day,
          gained: gain.contentment,
          full: gain.full,
          coins,
          caredAt: at,
        });
        // Feeding costs Treats, ledgered against this care action. Short: CONFLICT, nothing changes.
        if (action.cost) {
          await consumeItems(tx, { mapId, userId: user.id }, action.cost, 'care', careId);
        }
        // Pays out exactly what the care log records (#45), once per action.
        // After the inventory rows and before the event (tech spec §7).
        await creditCoins(tx, {
          source: 'care',
          refId: careId,
          userId: user.id,
          mapId,
          amount: coins,
          at,
        });
        await repo.setContentment(row.id, contentment, at);
        // A full-value action shapes how it feels and its care history (#32);
        // lesser ones don't, so tapping all day can't steer an evolution.
        const lean = careLean(action.id, gain.full);
        if (gain.full) {
          const habitat = habitatOf(await habitatTagsFor(repo, [row]), row);
          const current = leanOf(row, habitat, at);
          await repo.setCareHistory(row.id, {
            ...leanColumns(
              lean ? addLean(current, lean.feeling, lean.points, at, EVOLUTION_RULES) : current,
              at,
              row.habitatBuildingId !== null,
            ),
            careSum: row.careSum + contentment,
            careSamples: row.careSamples + 1,
          });
        }
        const mood = moodFor(contentment, CARE_RULES);
        await repo.appendEvent({
          mapId,
          type: 'squishy.cared',
          actorUserId: user.id,
          payload: {
            userId: user.id,
            squishyId: row.id,
            action: action.id,
            contentment,
            gained: gain.contentment,
            full: gain.full,
            coins,
            day,
            mood,
          },
        });
        return {
          ...(await careView(repo, tx, mapId, user.id, at)),
          result: {
            action: action.id,
            squishyId: row.id,
            contentmentGained: gain.contentment,
            full: gain.full,
            coins,
          },
        };
      });
      published(mapId);
      return reply;
    },

    seen: async (user, mapId, squishyId) =>
      store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        const row = await repo.lockSquishy(squishyId);
        if (!row || row.mapId !== mapId || row.ownerUserId !== user.id) {
          throw new AppError('NOT_FOUND', MESSAGES.noSquishy);
        }
        const at = now();
        await repo.markEvolutionsSeen(row.id, at);
        return careView(repo, tx, mapId, user.id, at);
      }),

    rename: async (user, mapId, squishyId, nickname) => {
      // Every nickname passes the text filter before it's stored (CLAUDE.md rule 9).
      if (nickname !== null) assertAllowedText(nickname, 'name');
      const at = now();
      const { reply, changed } = await store.transaction(async (repo, tx) => {
        await requireMember(tx, user, mapId);
        const row = await lockMine(repo, user, mapId, squishyId);
        const renamed = row.nickname !== nickname;
        if (renamed) {
          await repo.setNickname(row.id, nickname);
          await repo.appendEvent({
            mapId,
            type: 'squishy.updated',
            actorUserId: user.id,
            payload: { userId: user.id, squishyId: row.id, nickname, fromNickname: row.nickname },
          });
        }
        return { reply: await careView(repo, tx, mapId, user.id, at), changed: renamed };
      });
      if (changed) published(mapId);
      return reply;
    },
  };
}
