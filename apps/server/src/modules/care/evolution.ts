import {
  GAME_DATA,
  HOME_BASE_RULES,
  deriveSeed,
  fuelSpace,
  hashString,
  type FeelingId,
  type HabitatTags,
} from '@heartpatch/shared';
import {
  EVOLUTION_RULES,
  SERVER_GAME_DATA,
  addLean,
  careScore,
  dominantFeeling,
  evolutionForms,
  habitatLeanPoints,
  leanAt,
  rollEvolution,
  startingLean,
  stepForms,
  whisperFor,
  type EvolutionFacts,
  type EvolutionForm,
  type EvolutionRoll,
  type FeelingLean,
  type Whisper,
} from '@heartpatch/shared/server';
import { z } from 'zod';
import type { Executor } from '../../db/client.js';
import { mapLocalTime } from '../../lib/time.js';
import { arenaTimeOfDay } from '../battles/arena.js';
import { createBuildingsRepo } from '../buildings/repo.js';
import { BUILDING_DATA, fireStateAt } from '../buildings/hearthfire.js';
import { seasonsOn } from '../inventory/service.js';
import { createMapsRepo } from '../maps/repo.js';
import { createCareRepo } from './repo.js';

/*
 * Branching evolution on the server (#32, design doc §8). The shared engine
 * is pure; this file gathers what it needs (a squishy's lean and care
 * history, the world as it evolves, the owner's pity) and logs each roll.
 * Secret (CLAUDE.md rule 6): odds, conditions and rolls never leave the
 * server; only a finished whisper line reaches the owner's care sheet.
 */

/** Every evolution with its branch trigger, public before secret (each step's default first). */
export const EVOLUTION_FORMS: readonly EvolutionForm[] = evolutionForms({
  species: [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies],
  secretEvolutions: SERVER_GAME_DATA.secretEvolutions,
  evolutionOdds: SERVER_GAME_DATA.evolutionOdds,
});

/** What a roll's numbers came from, logged with it (tech spec §8 "Content versioning"). */
export const EVOLUTION_CONTENT_HASH = hashString(
  JSON.stringify({
    forms: EVOLUTION_FORMS,
    weights: EVOLUTION_RULES.weights,
    pity: EVOLUTION_RULES.pity,
  }),
);

/** Development and tests only; production refuses to start without `HP_EVOLUTION_SALT`. */
const DEV_SALT = 'heartpatch-dev-evolution-salt';
let salt = DEV_SALT;

/** Sets the secret the roll seeds come from (`buildApp`, from `HP_EVOLUTION_SALT`). */
export function setEvolutionSalt(value: string | undefined): void {
  salt = value ?? DEV_SALT;
}

const FEELING_ORDER: readonly FeelingId[] = GAME_DATA.feelings.map((f) => f.id);

/** The lean columns of a squishy row. */
export interface LeanRow {
  readonly feeling: FeelingId;
  readonly feelingLean: Readonly<Record<string, number>>;
  readonly feelingLeanAt: Date | null;
  readonly habitatSince: Date | null;
  readonly habitatBuildingId: string | null;
}

/**
 * A squishy's lean at `at`: the stored points decayed, plus its habitat's
 * feelings for the hours it has lived there since they were last folded in.
 * A squishy with no lean yet starts with its own feeling's head start.
 * `habitat` is null when it has none or stands watch (housed or on watch).
 */
export function leanOf(row: LeanRow, habitat: HabitatTags | null, at: Date): FeelingLean {
  const stored: FeelingLean = row.feelingLeanAt
    ? { points: row.feelingLean, at: row.feelingLeanAt }
    : // Never written yet: its head start counts from when it moved in, so
      // the habitat time since then isn't lost.
      startingLean(row.feeling, row.habitatSince ?? at, EVOLUTION_RULES);
  let lean = leanAt(stored, at, EVOLUTION_RULES);
  if (habitat && row.habitatSince) {
    const since = Math.max(row.habitatSince.getTime(), stored.at?.getTime() ?? 0);
    const points = habitatLeanPoints((at.getTime() - since) / 3_600_000, EVOLUTION_RULES);
    for (const feeling of habitat.feelings) {
      lean = addLean(lean, feeling, points, at, EVOLUTION_RULES);
    }
  }
  return lean;
}

/**
 * The lean columns to write for `lean`, brought up to `at`. A housed
 * squishy's habitat time is folded in up to `at` too, so it counts on from
 * there; that also starts the count for one housed before #32, whose
 * `habitat_since` was never set.
 */
export function leanColumns(lean: FeelingLean, at: Date, housed: boolean) {
  return {
    feelingLean: { ...lean.points },
    feelingLeanAt: lean.at ?? at,
    ...(housed ? { habitatSince: at } : {}),
  };
}

/** Feeling points for one care action at full value (none for a lesser one). */
export function careLean(actionId: string, full: boolean) {
  return full ? (EVOLUTION_RULES.lean.care[actionId] ?? null) : null;
}

export const WIN_LEAN = EVOLUTION_RULES.lean.win;
export const NIGHT_WATCH_LEAN = EVOLUTION_RULES.lean.nightWatch;

/**
 * Adds `points` of `feeling` to these squishies' leans (folding in habitat
 * time), in the caller's transaction and under its squishy locks.
 */
export async function addLeanTo(
  tx: Executor,
  rows: readonly (LeanRow & { id: string; habitat: HabitatTags | null })[],
  feeling: FeelingId,
  points: number,
  at: Date,
): Promise<void> {
  for (const row of rows) {
    const lean = addLean(leanOf(row, row.habitat, at), feeling, points, at, EVOLUTION_RULES);
    await createCareRepo(tx).setLean(row.id, leanColumns(lean, at, row.habitatBuildingId !== null));
  }
}

/** What the world looks like for the owner as their squishy evolves. */
async function factsFor(
  tx: Executor,
  mapId: string,
  ownerUserId: string,
  at: Date,
): Promise<EvolutionFacts> {
  const map = await createMapsRepo(tx).findMap(mapId);
  const timeZone = map?.timeZone ?? 'UTC';
  const local = mapLocalTime(at, timeZone);
  const fires = (await createBuildingsRepo(tx).listOnMap(mapId)).filter(
    (b) => b.ownerUserId === ownerUserId && b.kind === 'hearthfire',
  );
  const lit = fires.filter((b) => fireStateAt(b.fuelledThrough, at, timeZone).lit);
  const fireFull = lit.some((b) => {
    const fire = BUILDING_DATA.get(b.buildingId);
    return (
      fire?.kind === 'hearthfire' && fuelSpace(fire, b.fuelledThrough, local, HOME_BASE_RULES) === 0
    );
  });
  return {
    time: arenaTimeOfDay(local),
    seasons: seasonsOn(at, timeZone),
    firesLit: [...new Set(lit.map((b) => b.buildingId))].sort(),
    fireFull,
  };
}

/** The part of a logged roll pity reads; a row that doesn't parse counts no misses. */
const LoggedMissesSchema = z.object({ aimedMisses: z.array(z.string()) });

/**
 * Aimed misses per branch for this player (#32 pity): logged rolls, newest
 * first, where the branch was aimed at but missed, back to the last time
 * they got it. Rows from before #32 have no roll and never count.
 */
async function pityFor(
  tx: Executor,
  userId: string,
  branches: readonly string[],
): Promise<Record<string, number>> {
  if (branches.length === 0) return {};
  const rows = await createCareRepo(tx).rollsOf(userId, PITY_LOOKBACK);
  const pity: Record<string, number> = {};
  for (const branch of branches) {
    let misses = 0;
    for (const row of rows) {
      if (row.into === branch) break;
      const missed = LoggedMissesSchema.safeParse(row.roll).data?.aimedMisses ?? [];
      if (missed.includes(branch)) misses += 1;
    }
    if (misses > 0) pity[branch] = misses;
  }
  return pity;
}

/** Enough logged rolls to see past any pity count (it's certain after a few). */
const PITY_LOOKBACK = 200;

/** A logged roll as `squishy_evolutions.roll` stores it. */
export type LoggedRoll = EvolutionRoll & { readonly contentHash: string };

/** The squishy as a roll needs it. */
export interface RollSquishy extends LeanRow {
  readonly id: string;
  readonly mapId: string;
  readonly ownerUserId: string;
  readonly contentmentSum: number;
  readonly contentmentSamples: number;
}

/**
 * Rolls between a step's forms (#32) in the caller's transaction. The seed
 * is `deriveSeed(salt, squishyId, from, level)`: one roll per squishy and
 * step, so nothing can reroll it, and the salt keeps it unguessable.
 */
export async function rollStep(
  tx: Executor,
  squishy: RollSquishy,
  habitat: HabitatTags | null,
  forms: readonly EvolutionForm[],
  at: Date,
): Promise<LoggedRoll> {
  const step = forms[0];
  if (!step) throw new RangeError('rollStep needs at least one form');
  const lean = leanOf(squishy, habitat, at);
  const branches = forms.filter((f) => f.trigger).map((f) => f.into);
  const roll = rollEvolution(
    deriveSeed(salt, squishy.id, step.from, step.level),
    forms,
    {
      dominant: dominantFeeling(lean, squishy.feeling, FEELING_ORDER),
      careScore: careScore(squishy.contentmentSum, squishy.contentmentSamples),
      facts: await factsFor(tx, squishy.mapId, squishy.ownerUserId, at),
      pity: await pityFor(tx, squishy.ownerUserId, branches),
    },
    EVOLUTION_RULES,
  );
  return { ...roll, contentHash: EVOLUTION_CONTENT_HASH };
}

/** The forms a squishy's species can become at `level` (empty: it doesn't evolve yet). */
export const formsAt = (speciesId: string, level: number) =>
  stepForms(speciesId, level, EVOLUTION_FORMS);

/**
 * The care sheet's whisper (#32): from half the evolving meter, what's
 * shaping its next evolution. Null without a meter (a top form, or a secret
 * form next) or without a branch.
 */
export function whisperOf(
  squishy: LeanRow & { readonly speciesId: string; readonly name: string },
  habitat: HabitatTags | null,
  evolvingPercent: number | null,
  at: Date,
): Whisper | null {
  const forms = stepForms(squishy.speciesId, 100, EVOLUTION_FORMS);
  if (forms.length < 2) return null;
  const lean = leanOf(squishy, habitat, at);
  return whisperFor(
    {
      name: squishy.name,
      evolvingPercent,
      dominant: dominantFeeling(lean, squishy.feeling, FEELING_ORDER),
    },
    forms,
    EVOLUTION_RULES,
  );
}

/**
 * Folds a housed squishy's habitat time into its lean (#32) before it moves
 * out or to another habitat, so the time it lived there isn't lost. Under
 * the caller's squishy lock.
 */
export async function foldHabitatLean(tx: Executor, squishyId: string, at: Date): Promise<void> {
  const repo = createCareRepo(tx);
  const row = await repo.findSquishy(squishyId);
  if (!row?.habitatBuildingId || row.onWatch || !row.habitatSince) return;
  const buildingId = (await repo.habitatBuildingIds([row.habitatBuildingId])).get(
    row.habitatBuildingId,
  );
  const habitat = BUILDING_DATA.get(buildingId ?? '');
  if (habitat?.kind !== 'habitat') return;
  const lean = leanOf(row, habitat.tags, at);
  await repo.setLean(squishyId, leanColumns(lean, at, true));
}

/**
 * Squishies standing watch when night falls lean Spooky (#32). Under the
 * nightfall's squishy locks; a guard has no habitat to fold (housed or on
 * watch, not both).
 */
export async function addNightWatchLean(
  tx: Executor,
  squishyIds: readonly string[],
  at: Date,
): Promise<void> {
  const repo = createCareRepo(tx);
  for (const id of squishyIds) {
    const row = await repo.findSquishy(id);
    if (!row) continue;
    await addLeanTo(
      tx,
      [{ ...row, habitat: null }],
      NIGHT_WATCH_LEAN.feeling,
      NIGHT_WATCH_LEAN.points,
      at,
    );
  }
}
