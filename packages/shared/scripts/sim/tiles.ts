import { chooseAiChoice, chooseAiReplacement } from '../../src/battle/ai.js';
import { createBattleContent, type BattleContent } from '../../src/battle/content.js';
import { applyBattleAction, startBattle } from '../../src/battle/engine.js';
import { activeSquishy, type BattleState } from '../../src/battle/state.js';
import { BATTLE_RULES } from '../../src/data/battle.js';
import { GAME_DATA } from '../../src/data/index.js';
import { stancePolicy } from '../../src/data/raids.js';
import { GUARDIAN_RULES } from '../../src/data/server/guardian-rules.js';
import { deriveSeed, Rng, type Seed } from '../../src/rng/index.js';
import type { BattleChoice, BattleSquishySetup } from '../../src/schemas/battle.js';
import type { DefenseStance } from '../../src/schemas/data/raids.js';
import type { Species } from '../../src/schemas/data/species.js';
import { spawnWindowAt } from '../../src/spawns/window.js';
import { resolveGuardians } from '../../src/territory/guardians.js';
import { atWatchLevel, watchFloor } from '../../src/territory/watch-level.js';
import { serverData, speciesForms } from './matchups.js';
import type { TileDefense, TilePrep, TileSimConfig } from './tiles-config.js';

/*
 * `pnpm sim:tiles` (#529): a challenger's team against a rival tile's guards,
 * after any fence part (the breaker sits out, so one fewer fights). The
 * challenger is a stand-in kid (an AI policy on the player's side, like
 * `sim:potions`); posted guards play the owner's stance, the land's guardians
 * standing in play `guardian`, as on the server (`defendingSide`). Guards are
 * lifted to the floor with the real `watchFloor` and `atWatchLevel`. Real
 * engine, real data, seeded: the same data and config always give the same
 * report. Public base forms only, the squishies a Phase 1 kid has, each with
 * its species' element and feeling (on the server a posted guard carries its
 * own, which is its species' unless something changed it).
 */

const BRAVE_BREW = 'brave-brew';
const HEARTY_SOUP = 'hearty-soup';
/** Hearty Soup is sipped the first turn the active squishy is under this % energy. */
const SOUP_BELOW_PERCENT = 50;

export interface TileSimRow {
  readonly stance: DefenseStance;
  readonly prep: string;
  readonly defense: string;
  readonly partnerLevel: number | 'all';
  readonly wins: number;
  readonly battles: number;
}

interface Roster {
  readonly content: BattleContent;
  /** Public base forms: what a kid fields and what a Keeper posts. */
  readonly kids: readonly Species[];
  readonly species: ReadonlyMap<string, Species>;
}

function rosterOf(): Roster {
  const data = serverData();
  const kids = speciesForms(data).base.filter((s) => s.rarity !== 'secret');
  return {
    content: createBattleContent(data, BATTLE_RULES),
    kids,
    species: new Map(data.species.map((s) => [s.id, s])),
  };
}

/** The tile's guards at their own levels, before any floor. */
function guardsOf(
  roster: Roster,
  config: TileSimConfig,
  defense: TileDefense,
  partnerLevel: number,
  seed: Seed,
): BattleSquishySetup[] {
  const { guards } = defense;
  if (guards.kind === 'land') {
    return resolveGuardians(
      {
        seed: deriveSeed(seed, 'guardians'),
        terrain: guards.terrain,
        strength: guards.strength,
        window: spawnWindowAt({ date: config.landDate, hour: 0 }, GUARDIAN_RULES.windowHours),
      },
      { rules: GUARDIAN_RULES, species: roster.species, seasons: GAME_DATA.seasons },
    );
  }
  const rng = Rng.fromSeed(deriveSeed(seed, 'posted'));
  return guards.below.map((below, i) => ({
    id: `guard-${String(i + 1)}`,
    speciesId: rng.pick(roster.kids).id,
    level: Math.max(1, partnerLevel - below),
  }));
}

/**
 * The challenger's fighters: fighter i is picked against guard i (wrapping),
 * the guard it meets first. Ties in the counter score are broken by `rng`.
 */
function fightersOf(
  roster: Roster,
  prep: TilePrep,
  guards: readonly BattleSquishySetup[],
  count: number,
  level: number,
  rng: Rng,
): BattleSquishySetup[] {
  const { elementMatrix, feelingMatrix } = roster.content;
  return Array.from({ length: count }, (_, i) => {
    let pool = roster.kids;
    const guard = guards[i % guards.length];
    const target = guard && roster.species.get(guard.speciesId);
    if (prep.counter !== 'none' && target) {
      const score = (s: Species) =>
        feelingMatrix[s.feeling][guard.feeling ?? target.feeling] *
        (prep.counter === 'full' ? elementMatrix[s.element][guard.element ?? target.element] : 1);
      const best = Math.max(...pool.map(score));
      pool = pool.filter((s) => score(s) === best);
    }
    return { id: `kid-${String(i + 1)}`, speciesId: rng.pick(pool).id, level };
  });
}

/** The kid's choice: the stand-in's pick, with a potion sipped along once it's due (#403). */
function kidChoice(
  content: BattleContent,
  state: BattleState,
  config: TileSimConfig,
  prep: TilePrep,
  rng: Rng,
): BattleChoice {
  const pick = chooseAiChoice(content, state, 'a', config.kidPolicy, rng);
  // A sip rides along with a move; a swap waits for the next turn.
  if (!prep.potions || pick.type !== 'move') return pick;
  const used = state.sides.a.itemsUsed;
  const me = activeSquishy(state, 'a');
  if (!used.includes(HEARTY_SOUP) && me.energy * 100 < me.stats.hp * SOUP_BELOW_PERCENT) {
    return { ...pick, item: HEARTY_SOUP };
  }
  if (!used.includes(BRAVE_BREW)) return { ...pick, item: BRAVE_BREW };
  return pick;
}

/** Plays one challenge's guard fight to the end: did the challenger win? */
function playOne(
  roster: Roster,
  config: TileSimConfig,
  stance: DefenseStance,
  prep: TilePrep,
  defense: TileDefense,
  partnerLevel: number,
  seed: Seed,
): boolean {
  const { content } = roster;
  const guards = guardsOf(roster, config, defense, partnerLevel, seed);
  const floor =
    config.partnerBonus === null
      ? null
      : watchFloor(partnerLevel, { partnerBonus: config.partnerBonus });
  const fighters = fightersOf(
    roster,
    prep,
    guards,
    config.teamSize - (defense.fenced ? 1 : 0),
    Math.max(1, partnerLevel - prep.levelsUnder),
    Rng.fromSeed(deriveSeed(seed, 'team', prep.counter)),
  );
  const kidRng = Rng.fromSeed(deriveSeed(seed, 'kid'));
  let state = startBattle(content, {
    seed,
    sides: {
      a: { controller: { type: 'player' }, squishies: fighters },
      b: {
        controller: {
          type: 'ai',
          policy: defense.guards.kind === 'land' ? 'guardian' : stancePolicy(stance),
        },
        squishies: atWatchLevel(guards, floor),
      },
    },
  });
  while (state.phase.type !== 'over') {
    state = applyBattleAction(
      content,
      state,
      state.phase.type === 'replace'
        ? {
            type: 'replace',
            side: 'a',
            slot: chooseAiReplacement(content, state, 'a', config.kidPolicy, kidRng),
          }
        : { type: 'turn', choices: { a: kidChoice(content, state, config, prep, kidRng) } },
    );
  }
  return state.phase.result.winner === 'a';
}

const guardsKey = ({ guards }: TileDefense) =>
  guards.kind === 'land'
    ? `land:${guards.terrain}:${String(guards.strength)}`
    : `posted:${guards.below.join(',')}`;

export function runTileSim(config: TileSimConfig): { rows: TileSimRow[]; contentHash: string } {
  const roster = rosterOf();
  const rows: TileSimRow[] = [];
  for (const stance of config.stances) {
    for (const defense of config.defenses) {
      for (const prep of config.preps) {
        const all = { wins: 0, battles: 0 };
        for (const partnerLevel of config.partnerLevels) {
          const tally = { wins: 0, battles: 0 };
          for (let i = 0; i < config.games; i++) {
            // Every stance and prep meets the same guards and rolls, and an
            // open and a fenced tile the same guards, so cells differ only by
            // the stance, the prep or the fence.
            const seed = deriveSeed(config.rootSeed, guardsKey(defense), partnerLevel, i);
            const won = playOne(roster, config, stance, prep, defense, partnerLevel, seed);
            tally.wins += won ? 1 : 0;
            tally.battles += 1;
          }
          rows.push({ stance, prep: prep.key, defense: defense.key, partnerLevel, ...tally });
          all.wins += tally.wins;
          all.battles += tally.battles;
        }
        rows.push({ stance, prep: prep.key, defense: defense.key, partnerLevel: 'all', ...all });
      }
    }
  }
  return { rows, contentHash: roster.content.contentHash };
}

/** Win rate in whole percent, or null with no battles. */
const rate = (row: TileSimRow | undefined) =>
  row && row.battles > 0 ? Math.round((row.wins * 100) / row.battles) : null;

/**
 * Cells whose win rate under another stance moves more than `points` from
 * the first stance's (the default), all Partner levels together.
 */
export function stanceShifts(
  result: ReturnType<typeof runTileSim>,
  config: TileSimConfig,
  points: number,
): { stance: DefenseStance; defense: string; prep: string; from: number; to: number }[] {
  const [first, ...others] = config.stances;
  const at = (stance: DefenseStance, defense: string, prep: string) =>
    rate(
      result.rows.find(
        (r) =>
          r.stance === stance &&
          r.defense === defense &&
          r.prep === prep &&
          r.partnerLevel === 'all',
      ),
    );
  if (first === undefined) return [];
  return others.flatMap((stance) =>
    config.defenses.flatMap(({ key: defense }) =>
      config.preps.flatMap(({ key: prep }) => {
        const from = at(first, defense, prep);
        const to = at(stance, defense, prep);
        return from !== null && to !== null && Math.abs(to - from) > points
          ? [{ stance, defense, prep, from, to }]
          : [];
      }),
    ),
  );
}

/** Stance shifts bigger than this many points are flagged (#529 plan §3). */
export const STANCE_SHIFT_POINTS = 10;

/** The report: one defense × prep table per stance and Partner level, then the stance shifts. */
export function renderTileReport(
  result: ReturnType<typeof runTileSim>,
  config: TileSimConfig,
): string {
  const cell = (stance: DefenseStance, defense: string, prep: string, level: number | 'all') => {
    const value = rate(
      result.rows.find(
        (r) =>
          r.stance === stance &&
          r.defense === defense &&
          r.prep === prep &&
          r.partnerLevel === level,
      ),
    );
    return value === null ? '–' : `${String(value)}%`;
  };
  const table = (stance: DefenseStance, level: number | 'all') => [
    `| defense | ${config.preps.map((p) => p.key).join(' | ')} |`,
    `|---|${config.preps.map(() => '---:').join('|')}|`,
    ...config.defenses.map(
      (d) =>
        `| ${d.key} | ${config.preps.map((p) => cell(stance, d.key, p.key, level)).join(' | ')} |`,
    ),
    '',
  ];
  const floor =
    config.partnerBonus === null
      ? 'No guard level floor (before #529)'
      : `Guards fight at least at the Partner level + ${String(config.partnerBonus)} (\`guardLevel.partnerBonus\`)`;
  const lines = [
    '# Tiles sim (#529)',
    '',
    `Content hash \`${result.contentHash}\`. ${floor}. A challenger's team of ${String(config.teamSize)} public base forms at the defender's Partner level (${config.partnerLevels.join(', ')}), played by the \`${config.kidPolicy}\` policy, against a rival tile's guards; a fenced tile's breaker sits out, so one fewer fights. Posted guards play the stance; the land's guardians always play \`guardian\`. ${String(config.games * config.partnerLevels.length)} battles per cell. Challenger win rate (draws count as not winning).`,
    '',
  ];
  for (const stance of config.stances) {
    lines.push(`## Stance ${stance}, all Partner levels`, '', ...table(stance, 'all'));
  }
  const shifts = stanceShifts(result, config, STANCE_SHIFT_POINTS);
  if (config.stances.length > 1) {
    lines.push(`## Cells that move more than ${String(STANCE_SHIFT_POINTS)} points by stance`, '');
    lines.push(
      ...(shifts.length === 0
        ? ['None.']
        : shifts.map(
            (s) => `- ${s.stance}, ${s.defense}, ${s.prep}: ${String(s.from)}% → ${String(s.to)}%`,
          )),
      '',
    );
  }
  for (const stance of config.stances) {
    for (const level of config.partnerLevels) {
      lines.push(
        `## Stance ${stance}, Partner level ${String(level)}`,
        '',
        ...table(stance, level),
      );
    }
  }
  return lines.join('\n');
}
