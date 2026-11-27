import { z } from 'zod';
import {
  CARE_RULES,
  COIN_RULES,
  GAME_DATA,
  GROWTH_RULES,
  HEART_COIN_RULES,
  befriendedLevel,
  rareFindTier,
  type PlayerBattleBoss,
  type PublicUser,
  type Species,
} from '@heartpatch/shared';
import {
  SERVER_GAME_DATA,
  baseFormOf,
  bossBefriendChance,
  bossBefriendRoll,
  bossJoinLevel,
  bossWarmthStep,
  type BossEventRules,
} from '@heartpatch/shared/server';
import type { Executor } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { localDayStart } from '../../lib/time.js';
import { createBattlesRepo, type BattleRow } from '../battles/repo.js';
import { HEART_CHARM } from '../battles/service.js';
import { EVOLUTION_STEPS } from '../care/service.js';
import { creditCoins } from '../coins/service.js';
import { creditHeartCoins } from '../heart-coins/service.js';
import { consumeItems } from '../inventory/service.js';
import { requireMember } from '../maps/members.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { barView, triesFrom } from './patch-bar.js';
import {
  createBossRepo,
  type BossBarDbRow,
  type BossEncounterRow,
  type BossRepo,
  type BossWindowRow,
} from './repo.js';

const PLAYER_SIDE = 'a';
const HOUR_MS = 3_600_000;

/** Every species, public and secret: a boss line lives in `SECRET_SPECIES` (#190). */
const SPECIES: ReadonlyMap<string, Species> = new Map(
  [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies].map((s) => [s.id, s]),
);
const nameOf = (speciesId: string) => SPECIES.get(speciesId)?.name ?? 'this squishy';

// Kid-readable messages (style guide §6).
const MESSAGES = {
  notFound: 'We couldn’t find that battle.',
  notBoss: 'Only a BIG squishy can be asked!',
  winFirst: 'Win the battle first, then ask!',
  mixedUp: 'Oops, that ask got mixed up. Try again!',
  haveOne: (name: string) => `You already have a ${name}! 💗`,
  stompedOff: (name: string) => `${name} stomped off for now. It’ll be back next visit!`,
  // Christmas Eve (#37 X2): the asks come with the fall, never "next visit".
  barFirst: 'Fill the patch bar together first, then ask!',
  finishFirst: 'Finish this battle first, then ask!',
  snuggledUp: (name: string) => `${name} is all snuggled up now. Thanks for helping! 💙`,
} as const;

/**
 * One ask, stored on the visit's `boss_encounters.asks` (#190 plan §3) so
 * any answer can be explained and replayed. Server-only: the chance, roll
 * and warmth never reach a client (CLAUDE.md rule 6).
 */
const AskRecordSchema = z.object({
  ask: z.number().int().min(1),
  battleId: z.uuid(),
  at: z.iso.datetime(),
  /** The player's squishies still standing at the win. */
  standing: z.number().int().min(0),
  /** "Not yet"s from this boss kind before this ask (warmth). */
  misses: z.number().int().min(0),
  chance: z.number().int().min(0).max(100),
  roll: z.number().int().min(1).max(100),
  outcome: z.enum(['joined', 'not-yet']),
  squishyId: z.uuid().nullable(),
});
type AskRecord = z.infer<typeof AskRecordSchema>;

const AsksSchema = z.array(AskRecordSchema);

/** This win's asks so far, oldest first. */
function asksOf(encounter: BossEncounterRow | null, battleId: string): AskRecord[] {
  if (!encounter) return [];
  return AsksSchema.parse(encounter.asks).filter((a) => a.battleId === battleId);
}

/** The boss a mini-boss fight was against (its side `b`'s one squishy). */
function bossOf(row: BattleRow) {
  const boss = row.state.sides.b.squishies[0];
  if (!boss) throw new Error(`mini-boss battle ${row.id} has no boss`);
  return boss;
}
const bossSpeciesOf = (row: BattleRow) => bossOf(row).speciesId;

const won = (row: BattleRow) => row.status === 'finished' && row.result?.winner === PLAYER_SIDE;

/** The asks close a while after the win, even once the visit has ended (plan §12). */
const asksOpen = (row: BattleRow, rules: BossEventRules, at: Date) =>
  row.endedAt !== null && at.getTime() < row.endedAt.getTime() + rules.befriend.askHours * HOUR_MS;

/**
 * A Christmas Eve fight's visit and bar (#37 X2), or null for any other
 * fight: a weekly one, or a weekly fight still going when the Eve took over
 * its row (started before the Eve's own opening). Reads only.
 */
async function eveFightOf(
  repo: BossRepo,
  row: Pick<BattleRow, 'mapId' | 'startedAt'>,
  rules: BossEventRules,
): Promise<{ window: BossWindowRow; bar: BossBarDbRow } | null> {
  if (!rules.christmasEve) return null;
  const window = await repo.visitOf(row.mapId, row.startedAt);
  if (window?.kind !== 'christmas-eve') return null;
  const bar = await repo.findBar(window.mapId, window.windowId);
  if (!bar || row.startedAt < bar.opensAt) return null;
  return { window, bar };
}

/**
 * The Christmas Eve asks (#37 X2, owner answer 2): `fallAsks` per Keeper
 * per visit, once the bar fell and their thanks is paid, open
 * `befriend.askHours` from that thanks. Any finished Eve fight of theirs
 * can carry an ask; the asks are counted across the visit.
 */
function eveAsksOpen(encounter: BossEncounterRow, rules: BossEventRules, at: Date): boolean {
  if (!encounter.thankedAt) return false;
  return at.getTime() < encounter.thankedAt.getTime() + rules.befriend.askHours * HOUR_MS;
}

export interface BefriendResult {
  outcome: AskRecord['outcome'];
  squishyId: string | null;
}

/** What the route answers, plus what the service needs to publish a fresh yes. */
export interface BefriendAnswer extends BefriendResult {
  mapId: string;
  /** True when this call made the ask (false for a stored answer replayed). */
  fresh: boolean;
}

/**
 * Asks a beaten boss to be your friend (#190 plan §3): one transaction in
 * tech spec §7 order. The battle (step 5), then the visit's row and the bond
 * with this boss kind (5e), then the charms (11, `boss-befriend`; too few and
 * nothing is written), then the roll. A yes inserts the base form (no
 * squishy lock), marks it caught (`species_seen`, 11), pays `capture` coins
 * (12) and appends `squishy.captured` and `squishy.celebrated` (`maps`, 13);
 * a "not yet" warms the bond up. An ask already made returns its stored answer.
 */
export async function befriendBoss(
  db: Executor,
  rules: BossEventRules,
  user: PublicUser,
  battleId: string,
  ask: number,
  at: Date,
): Promise<BefriendAnswer> {
  const found = await createBattlesRepo(db).findBattle(battleId);
  if (!found || found.playerUserId !== user.id) throw new AppError('NOT_FOUND', MESSAGES.notFound);
  await requireMember(db, user, found.mapId);
  return createBossRepo(db).transaction(async (boss, tx) => {
    const battles = createBattlesRepo(tx);
    const row = await battles.lockBattle(battleId);
    if (!row) throw new AppError('NOT_FOUND', MESSAGES.notFound);
    const battleRowId = row.id;
    if (row.kind !== 'miniboss') throw new AppError('CONFLICT', MESSAGES.notBoss);
    const { mapId } = row;
    // Christmas Eve (#37 X2): the asks come from the fall, win or lose, and
    // are the visit's (not one win's); the weekly "win first" never applies.
    const eveFight = await eveFightOf(boss, row, rules);
    let encounter: BossEncounterRow | null;
    if (eveFight) {
      if (row.status !== 'finished') throw new AppError('CONFLICT', MESSAGES.finishFirst);
      encounter = await boss.lockEncounter(mapId, user.id, eveFight.window.windowId);
      if (!encounter?.thankedAt || eveFight.bar.state !== 'fell') {
        throw new AppError('CONFLICT', MESSAGES.barFirst);
      }
    } else {
      if (!won(row)) throw new AppError('CONFLICT', MESSAGES.winFirst);
      encounter = await boss.lockWonEncounter(mapId, user.id, row.id);
      if (!encounter) throw new AppError('CONFLICT', MESSAGES.winFirst);
    }
    const visitRow = encounter;
    // Every ask on this visit's row (earlier wins' too), parsed once.
    const stored = AsksSchema.parse(visitRow.asks);
    // The asks that count against this ask: the win's, or the whole Eve visit's.
    const asks = eveFight ? stored : stored.filter((a) => a.battleId === row.id);
    // A double tap: the ask was made, so its answer stands (nothing more spent).
    const made = asks.find((a) => a.ask === ask);
    if (made) return { outcome: made.outcome, squishyId: made.squishyId, mapId, fresh: false };

    const bossSpecies = bossSpeciesOf(row);
    const baseSpecies = baseFormOf(bossSpecies, EVOLUTION_STEPS);
    const bond = await boss.lockBond(mapId, user.id, bossSpecies);
    if (bond.befriendedAt !== null) {
      throw new AppError('CONFLICT', MESSAGES.haveOne(nameOf(baseSpecies)));
    }
    if (eveFight) {
      const limit = rules.christmasEve?.fallAsks ?? 0;
      if (asks.length >= limit || !eveAsksOpen(visitRow, rules, at)) {
        throw new AppError('CONFLICT', MESSAGES.snuggledUp(nameOf(bossSpecies)));
      }
    } else if (asks.length >= rules.befriend.asksPerWin || !asksOpen(row, rules, at)) {
      throw new AppError('CONFLICT', MESSAGES.stompedOff(nameOf(bossSpecies)));
    }
    if (ask !== asks.length + 1) throw new AppError('CONFLICT', MESSAGES.mixedUp);

    await consumeItems(
      tx,
      { mapId, userId: user.id },
      { [HEART_CHARM]: rules.befriend.charmsPerAsk },
      'boss-befriend',
      row.id,
      at,
    );

    const standing = row.state.sides.a.squishies.filter((s) => s.energy > 0).length;
    const chance = bossBefriendChance(rules.befriend, standing, bond.misses);
    // The patch's seed is server-only; the battle's is sent once the fight ends.
    // A patch without one (hand-authored) can't hide the roll, so it can't be asked.
    const patchSeed = (await boss.findMap(mapId))?.seed;
    if (!patchSeed) throw new Error(`map ${mapId} has no seed for a boss befriend roll`);
    const roll = bossBefriendRoll(row.seed, patchSeed, ask);
    let squishyId: string | null = null;
    if (roll <= chance) {
      const spawns = createSpawnsRepo(tx);
      const partner = (await spawns.partnerLevel(mapId, user.id)) ?? 1;
      const fought = bossOf(row);
      const friend = await battles.insertSquishy({
        mapId,
        ownerUserId: user.id,
        speciesId: baseSpecies,
        element: SPECIES.get(baseSpecies)?.element ?? fought.element,
        feeling: fought.feeling,
        level: befriendedLevel(
          baseSpecies,
          bossJoinLevel(rules.befriend, partner),
          EVOLUTION_STEPS,
          GROWTH_RULES,
        ),
        contentment: CARE_RULES.startContentment,
        at,
      });
      squishyId = friend.id;
      await spawns.markCaught(mapId, user.id, baseSpecies, at);
      await boss.befriended(mapId, user.id, bossSpecies, friend.id, at);
      await boss.setAsks(mapId, user.id, visitRow.windowId, [...stored, record('joined')]);
      const credit = { userId: user.id, refId: row.id, source: 'capture' as const, mapId, at };
      await creditCoins(tx, { ...credit, amount: COIN_RULES.capture.wild });
      await creditHeartCoins(tx, { ...credit, amount: HEART_COIN_RULES.capture.wild });
      await boss.appendEvent({
        mapId,
        type: 'squishy.captured',
        actorUserId: user.id,
        payload: {
          battleId: row.id,
          userId: user.id,
          squishyId: friend.id,
          speciesId: friend.speciesId,
          level: friend.level,
        },
      });
      // The patch line (#391): its name only to members who have met it.
      const rarity = SPECIES.get(baseSpecies)?.rarity;
      if (rarity && rarity !== 'secret' && rareFindTier(rarity)?.patchLine) {
        await boss.appendEvent({
          mapId,
          type: 'squishy.celebrated',
          actorUserId: user.id,
          payload: {
            battleId: row.id,
            userId: user.id,
            speciesId: baseSpecies,
            rarity,
            metBy: await spawns.seenBy(mapId, baseSpecies),
          },
        });
      }
    } else {
      await boss.addMiss(mapId, user.id, bossSpecies);
      await boss.setAsks(mapId, user.id, visitRow.windowId, [...stored, record('not-yet')]);
    }
    return { outcome: squishyId ? 'joined' : 'not-yet', squishyId, mapId, fresh: true };

    function record(outcome: AskRecord['outcome']): AskRecord {
      return AskRecordSchema.parse({
        ask,
        battleId: battleRowId,
        at: at.toISOString(),
        standing,
        misses: bond.misses,
        chance,
        roll,
        outcome,
        squishyId,
      });
    }
  });
}

/**
 * A mini-boss fight's extras for its Keeper (`PlayerBattle.boss`, #190 plan
 * §1), or undefined for any other battle. Reads only; never the odds or the
 * misses (warmth goes out as a coarse 0–4 step).
 */
export async function bossBattleView(
  db: Executor,
  rules: BossEventRules,
  row: BattleRow,
  at: Date,
): Promise<PlayerBattleBoss | undefined> {
  if (row.kind !== 'miniboss') return undefined;
  const repo = createBossRepo(db);
  const window = await repo.visitOf(row.mapId, row.startedAt);
  if (!window) return undefined;
  const map = await repo.findMap(row.mapId);
  const out = at < window.opensAt || at >= window.endsAt;
  // Tries keyed by window (#37 X2, `triesFrom`): the Eve's own from its opening.
  const day = map ? localDayStart(at, map.timeZone) : at;
  const from = await triesFrom(db, window);
  const used =
    map && !out
      ? await repo.triesSince(row.mapId, row.playerUserId, from > day ? from : day)
      : rules.triesPerDay;
  const bossSpecies = bossSpeciesOf(row);
  const bond = await repo.findBond(row.mapId, row.playerUserId, bossSpecies);
  const eveFight = await eveFightOf(repo, row, rules);
  const base = {
    eventWindow: { id: window.windowId, endsAt: window.endsAt.toISOString() },
    triesLeftToday: Math.max(0, rules.triesPerDay - used),
    charmsPerAsk: rules.befriend.charmsPerAsk,
    // The friend who joins is the line's base form (#820), named on the cards.
    baseName: nameOf(baseFormOf(bossSpecies, EVOLUTION_STEPS)),
    // A coarse step for the hearts, never the misses or the odds (rule 6).
    warmth: bossWarmthStep(rules.befriend, bond?.misses ?? 0),
    // Christmas Eve (#37 X2): the bar this fight chips; never who chipped.
    ...(eveFight ? { patchBar: barView(eveFight.bar, at) } : {}),
  };
  if (eveFight) {
    // The fall's asks (owner answer 2), win or lose, once its thanks is paid.
    if (row.status !== 'finished' || eveFight.bar.state !== 'fell') {
      return { ...base, asksLeft: 0, befriend: 'none' };
    }
    const visitRow = await repo.findEncounter(row.mapId, row.playerUserId, window.windowId);
    if (!visitRow?.thankedAt) return { ...base, asksLeft: 0, befriend: 'none' };
    const asks = AsksSchema.parse(visitRow.asks);
    if (asks.some((a) => a.outcome === 'joined')) {
      return { ...base, asksLeft: 0, befriend: 'joined' };
    }
    if (bond?.befriendedAt) return { ...base, asksLeft: 0, befriend: 'have-one' };
    const limit = rules.christmasEve?.fallAsks ?? 0;
    const asksLeft = eveAsksOpen(visitRow, rules, at) ? Math.max(0, limit - asks.length) : 0;
    return { ...base, asksLeft, befriend: asks.length === 0 ? 'offer' : 'not-yet' };
  }
  if (!won(row)) return { ...base, asksLeft: 0, befriend: 'none' };
  const encounter = await repo.findWonEncounter(row.mapId, row.playerUserId, row.id);
  // A win no visit holds (a weekly fight won after the Eve took over its row,
  // #37 X1): nothing to ask, as `befriendBoss` would refuse it.
  if (!encounter) return { ...base, asksLeft: 0, befriend: 'none' };
  const asks = asksOf(encounter, row.id);
  if (asks.some((a) => a.outcome === 'joined')) return { ...base, asksLeft: 0, befriend: 'joined' };
  if (bond?.befriendedAt) return { ...base, asksLeft: 0, befriend: 'have-one' };
  const asksLeft = asksOpen(row, rules, at)
    ? Math.max(0, rules.befriend.asksPerWin - asks.length)
    : 0;
  return { ...base, asksLeft, befriend: asks.length === 0 ? 'offer' : 'not-yet' };
}

/** Has this Keeper's win on this visit been answered with a yes (`BossVisit.state` `friend`)? */
export function joinedOn(encounter: BossEncounterRow | null, kind = 'weekly'): boolean {
  if (!encounter) return false;
  // A Christmas Eve visit's yes is the fall's (#37 X2): no win is marked,
  // and the asks are the visit's (a conversion clears the weekly ones).
  if (kind === 'christmas-eve' && !encounter.wonBattleId) {
    return AsksSchema.parse(encounter.asks).some((a) => a.outcome === 'joined');
  }
  if (!encounter.wonBattleId) return false;
  return asksOf(encounter, encounter.wonBattleId).some((a) => a.outcome === 'joined');
}
