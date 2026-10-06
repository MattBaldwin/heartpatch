import { createBattleContent, type BattleContent } from '../../src/battle/content.js';
import { autoplayBattle } from '../../src/battle/engine.js';
import { addXp, evolutionAt, grantedXp, type EvolutionStep } from '../../src/care/growth.js';
import { BATTLE_RULES } from '../../src/data/battle.js';
import { GAME_DATA } from '../../src/data/index.js';
import { GUARDIAN_RULES } from '../../src/data/server/guardian-rules.js';
import { SERVER_GAME_DATA, serverBattleData } from '../../src/data/server/index.js';
import { SPAWN_TABLES } from '../../src/data/server/spawn-tables.js';
import { hexKey, hexNeighbors, type HexKey } from '../../src/hex/index.js';
import { generateMap, type MapTile } from '../../src/mapgen/index.js';
import { deriveSeed } from '../../src/rng/index.js';
import type { BattleSideSetup } from '../../src/schemas/battle.js';
import type { Species } from '../../src/schemas/data/species.js';
import { resolveWildSpawn, type SpawnData } from '../../src/spawns/resolve.js';
import { spawnWindowAt, type SpawnWindow } from '../../src/spawns/window.js';
import { resolveGuardians, type GuardianData } from '../../src/territory/guardians.js';
import type { KidProfile, ProgressionConfig, ProgressionRules } from './progression-config.js';

/*
 * A deterministic day-by-day progression model (design review 2026-10-05,
 * "Longevity"). Two kids of one kind share a generated map. Each day each
 * kid estimates their team's odds against every guardian strength, tries the
 * best-odds tile next to their land while the odds are good and attempts are
 * left, then spends the rest of their battles on wild squishies. Every battle
 * is played by the real engine with AI on both sides, and XP goes through the
 * real growth rules, so the model follows the data: the XP curve, battle XP,
 * guardian and spawn rules, map size and the daily attempts.
 *
 * Not modelled: captures after day 1, care and habitat changes, gathering,
 * the Hollow Man, and challenging the other kid once neutral land runs out.
 */

/** One squishy on a kid's team. */
interface Member {
  readonly id: string;
  speciesId: string;
  level: number;
  xp: number;
}

interface Kid {
  readonly profile: KidProfile;
  readonly slot: number;
  /** The Partner first, then the teammates (the team picker's default order). */
  readonly team: Member[];
}

/** How one kid stands at the end of a day. */
export interface DayRecord {
  readonly day: number;
  readonly partnerLevel: number;
  readonly partnerSpecies: string;
  /** Every team member's level, Partner first. */
  readonly levels: readonly number[];
  /** Tiles the kid owns, home ring included. */
  readonly tiles: number;
  /** Neutral tiles left on the map (shared by both kids). */
  readonly neutralLeft: number;
  /** Neutral tiles left outside Juniper's Gap. */
  readonly neutralLeftOutsideGap: number;
  /** Estimated team win chance (%) by guardian strength, 1 first. */
  readonly odds: readonly number[];
  readonly tileBattles: number;
  readonly wildBattles: number;
  /** XP the Partner got today, after care × habitat. */
  readonly partnerXp: number;
}

export interface KidRun {
  readonly profile: KidProfile;
  readonly slot: number;
  readonly days: readonly DayRecord[];
}

export interface ProgressionRun {
  readonly rules: ProgressionRules;
  readonly seats: number;
  readonly profile: KidProfile;
  /** Neutral tiles on the map at the start. */
  readonly neutral: number;
  readonly kids: readonly KidRun[];
}

/** What every run shares: battle content, species and the spawn and guardian data. */
export interface ModelData {
  readonly content: BattleContent;
  readonly species: ReadonlyMap<string, Species>;
  readonly evolutions: readonly EvolutionStep[];
  readonly guardians: GuardianData;
  readonly spawnTables: SpawnData['tables'];
}

export function modelData(): ModelData {
  const all = [...GAME_DATA.species, ...SERVER_GAME_DATA.secretSpecies];
  const species = new Map(all.map((s) => [s.id, s]));
  return {
    content: createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA), BATTLE_RULES),
    species,
    evolutions: [
      ...all.flatMap((s) =>
        s.evolutions.map((e) => ({ from: s.id, into: e.into, level: e.level })),
      ),
      ...SERVER_GAME_DATA.secretEvolutions,
    ],
    guardians: { rules: GUARDIAN_RULES, species, seasons: GAME_DATA.seasons },
    spawnTables: SPAWN_TABLES,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ordinary terrains the odds estimate samples guardians on, in turn. */
const ESTIMATE_TERRAINS = ['meadow', 'forest', 'hills', 'lake'] as const;
const GAP_TERRAIN = 'junipers-gap';
/** Hours of the day the kid looks for wild squishies, in turn (4-hour windows). */
const WILD_HOURS = [8, 12, 16, 18, 21] as const;

function dateOf(config: ProgressionConfig, day: number): string {
  return new Date(Date.parse(`${config.startDate}T12:00:00Z`) + (day - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function teamSide(kid: Kid, config: ProgressionConfig): BattleSideSetup {
  return {
    controller: { type: 'ai', policy: config.kidPolicy },
    squishies: kid.team.map((m) => ({ id: m.id, speciesId: m.speciesId, level: m.level })),
  };
}

/** Plays one battle; returns whether the kid won and the base XP each member earned. */
function play(
  data: ModelData,
  kid: Kid,
  config: ProgressionConfig,
  opponent: BattleSideSetup,
  seed: string,
): { won: boolean; xp: Map<string, number> } {
  const { state } = autoplayBattle(data.content, {
    seed,
    sides: { a: teamSide(kid, config), b: opponent },
  });
  if (state.phase.type !== 'over') throw new Error('autoplay always finishes');
  const { result } = state.phase;
  const xp = new Map(result.xp.filter((a) => a.side === 'a').map((a) => [a.squishyId, a.xp]));
  return { won: result.winner === 'a', xp };
}

/** Grants battle XP to the members who joined, through the real growth rules. */
function grant(
  data: ModelData,
  kid: Kid,
  rules: ProgressionRules,
  xp: ReadonlyMap<string, number>,
): number {
  let partnerXp = 0;
  for (const member of kid.team) {
    const base = xp.get(member.id);
    if (base === undefined) continue;
    const gained = grantedXp(base, kid.profile.xpPercent);
    if (member === kid.team[0]) partnerXp += gained;
    const next = addXp(member, gained, rules.growth);
    member.level = next.level;
    member.xp = next.xp;
    for (let step = evolutionAt(member.speciesId, member.level, data.evolutions); step;) {
      member.speciesId = step.into;
      step = evolutionAt(member.speciesId, member.level, data.evolutions);
    }
  }
  return partnerXp;
}

/** The team's estimated win chance (%) against each guardian strength today. */
function estimateOdds(
  data: ModelData,
  kid: Kid,
  config: ProgressionConfig,
  window: SpawnWindow,
  day: number,
): number[] {
  return data.guardians.rules.strengths.map(({ strength }) => {
    let wins = 0;
    for (let i = 0; i < config.estimateGames; i++) {
      const terrain =
        strength >= 5 ? GAP_TERRAIN : (ESTIMATE_TERRAINS[i % ESTIMATE_TERRAINS.length] as string);
      const seed = deriveSeed(config.rootSeed, 'odds', kid.profile.id, kid.slot, day, strength, i);
      const guardians = resolveGuardians(
        { seed: deriveSeed(seed, 'team'), terrain, strength, window },
        data.guardians,
      );
      const opponent: BattleSideSetup = {
        controller: { type: 'ai', policy: 'guardian' },
        squishies: guardians,
      };
      if (play(data, kid, config, opponent, deriveSeed(seed, 'battle')).won) wins += 1;
    }
    return Math.floor((wins * 100) / config.estimateGames);
  });
}

/** Runs two kids of one kind on one map for `config.days` days. */
export function runProgression(
  data: ModelData,
  config: ProgressionConfig,
  rules: ProgressionRules,
  profile: KidProfile,
  seats: number,
): ProgressionRun {
  const map = generateMap(GAME_DATA, { seed: config.mapSeed, playerCount: seats });
  const tiles = map.tiles;
  const kids: Kid[] = [0, 1].map((slot) => ({
    profile,
    slot,
    team: [
      { id: 'partner', speciesId: config.partner, level: 1, xp: 0 },
      ...config.teammates.map((speciesId, i) => {
        const level = config.teammateLevel;
        return { id: `friend-${String(i + 1)}`, speciesId, level, xp: 0 };
      }),
    ],
  }));
  // Owner by tile: a kid's slot, or null. Empty seats' home rings can never be taken.
  const owner = new Map<HexKey, number | null>();
  for (const t of tiles)
    owner.set(hexKey(t), t.homeSlot !== null && t.homeSlot < 2 ? t.homeSlot : null);
  const neutralTiles = tiles.filter((t) => t.homeSlot === null);
  const neutralLeft = () => neutralTiles.filter((t) => owner.get(hexKey(t)) === null);

  const records: DayRecord[][] = kids.map(() => []);
  for (let day = 1; day <= config.days; day++) {
    const date = dateOf(config, day);
    const guardianWindow = spawnWindowAt({ date, hour: 12 }, GUARDIAN_RULES.windowHours);
    const odds = kids.map((kid) => estimateOdds(data, kid, config, guardianWindow, day));
    const tileBattles = kids.map(() => 0);
    const partnerXp = kids.map(() => 0);
    const triedToday = new Set<HexKey>();
    const doneWithTiles = kids.map(() => false);

    // Tile tries, taking turns so both kids race for the same land.
    for (let attempt = 0; attempt < rules.attemptsPerDay; attempt++) {
      kids.forEach((kid, k) => {
        if (doneWithTiles[k] || (tileBattles[k] ?? 0) >= profile.battlesPerDay) return;
        const mine = new Set(tiles.filter((t) => owner.get(hexKey(t)) === k).map(hexKey));
        const target = neutralLeft()
          .filter((t) => !triedToday.has(hexKey(t)))
          .filter((t) => hexNeighbors(t).some((n) => mine.has(hexKey(n))))
          .map((t) => ({ t, odds: odds[k]?.[(t.guardianStrength ?? 1) - 1] ?? 0 }))
          .sort(
            (x, y) => y.odds - x.odds || (x.t.guardianStrength ?? 1) - (y.t.guardianStrength ?? 1),
          )[0];
        if (!target || target.odds < config.tryTileAt) {
          doneWithTiles[k] = true;
          return;
        }
        const { t } = target;
        triedToday.add(hexKey(t));
        const guardians = resolveGuardians(
          {
            seed: deriveSeed(config.mapSeed, 'guardian', t.q, t.r, guardianWindow.id),
            terrain: t.terrain,
            strength: t.guardianStrength,
            window: guardianWindow,
          },
          data.guardians,
        );
        const seed = deriveSeed(config.rootSeed, 'tile', profile.id, k, day, attempt);
        const opponent: BattleSideSetup = {
          controller: { type: 'ai', policy: 'guardian' },
          squishies: guardians,
        };
        const { won, xp } = play(data, kid, config, opponent, seed);
        partnerXp[k] = (partnerXp[k] ?? 0) + grant(data, kid, rules, xp);
        tileBattles[k] = (tileBattles[k] ?? 0) + 1;
        if (won) owner.set(hexKey(t), k);
      });
    }

    // Wild battles with the rest of the day's battles.
    kids.forEach((kid, k) => {
      const spawnData: SpawnData = {
        tables: data.spawnTables,
        species: data.species,
        seasons: GAME_DATA.seasons,
        rules: rules.spawn,
      };
      const land = tiles.filter((t) => owner.get(hexKey(t)) === k);
      const wild = profile.battlesPerDay - (tileBattles[k] ?? 0);
      for (let i = 0; i < wild; i++) {
        const hour = WILD_HOURS[i % WILD_HOURS.length] as number;
        const window = spawnWindowAt({ date, hour }, rules.spawn.windowHours);
        const partnerLevel = kid.team[0]?.level ?? null;
        let spawn = null;
        for (let j = 0; spawn === null; j++) {
          if (j > 1000) throw new Error(`no wild squishy on ${profile.id}'s land`);
          const tile = land[(i + j) % land.length] as MapTile;
          const seed = deriveSeed(config.rootSeed, 'wild', profile.id, k, day, i, j);
          spawn = resolveWildSpawn(
            { seed, terrain: tile.terrain, window, partnerLevel },
            spawnData,
          );
        }
        const opponent: BattleSideSetup = {
          controller: { type: 'ai', policy: 'wild' },
          squishies: [{ id: 'wild-1', speciesId: spawn.speciesId, level: spawn.level }],
        };
        const seed = deriveSeed(config.rootSeed, 'wild-battle', profile.id, k, day, i);
        const { xp } = play(data, kid, config, opponent, seed);
        partnerXp[k] = (partnerXp[k] ?? 0) + grant(data, kid, rules, xp);
      }
      const left = neutralLeft();
      records[k]?.push({
        day,
        partnerLevel: kid.team[0]?.level ?? 0,
        partnerSpecies: kid.team[0]?.speciesId ?? '',
        levels: kid.team.map((m) => m.level),
        tiles: tiles.filter((t) => owner.get(hexKey(t)) === k).length,
        neutralLeft: left.length,
        neutralLeftOutsideGap: left.filter((t) => t.terrain !== GAP_TERRAIN).length,
        odds: odds[k] ?? [],
        tileBattles: tileBattles[k] ?? 0,
        wildBattles: wild,
        partnerXp: partnerXp[k] ?? 0,
      });
    });
  }
  return {
    rules,
    seats,
    profile,
    neutral: neutralTiles.length,
    kids: kids.map((kid, k) => ({ profile, slot: kid.slot, days: records[k] ?? [] })),
  };
}
