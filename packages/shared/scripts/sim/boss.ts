import { createBattleContent, type BattleContent } from '../../src/battle/content.js';
import { autoplayBattle } from '../../src/battle/engine.js';
import { BATTLE_RULES } from '../../src/data/battle.js';
import { GAME_DATA } from '../../src/data/index.js';
import { serverBattleData } from '../../src/data/server/battle-data.js';
import { BOSS_EVENTS } from '../../src/data/server/boss-events.js';
import { SERVER_GAME_DATA } from '../../src/data/server/index.js';
import { deriveSeed, Rng } from '../../src/rng/index.js';
import type { BattleSetup, BattleSquishySetup } from '../../src/schemas/battle.js';
import type { BossBagEntry } from '../../src/schemas/data/boss-events.js';
import { hiddenUntilSeen, type Species } from '../../src/schemas/data/species.js';
import type { BossSimConfig, BossTeamShape } from './boss-config.js';

/*
 * `pnpm sim:boss` (#190, plan §9): how often a team beats a mini-boss in
 * the team format. Each cell (team shape × boss × level bonus) plays
 * `games` seeded AI-vs-AI battles; teams are drawn per game from the public
 * base forms, grown to the form they'd be at their level.
 */

export interface BossCell {
  readonly shape: string;
  readonly boss: string;
  readonly bonus: number;
  readonly games: number;
  /** Team wins, a whole percent (rounded down). */
  readonly winPercent: number;
  /** The median fight, in rounds. */
  readonly medianRounds: number;
}

export interface BossGate {
  readonly name: string;
  readonly value: string;
  readonly pass: boolean;
}

/**
 * The data a server battle uses (public plus secret species and moves, so
 * the real bosses can fight), with the shipped battle rules (`team`, `boss`).
 */
export function bossContent(): BattleContent {
  return createBattleContent(serverBattleData(GAME_DATA, SERVER_GAME_DATA), BATTLE_RULES);
}

const byId = (a: Species, b: Species) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Species some other species grows into. */
function grownInto(species: readonly Species[]): Set<string> {
  return new Set(species.flatMap((s) => s.evolutions.map((e) => e.into)));
}

/** Stand-in bosses: grown-ups (grown into, growing no further) of `count` different elements. */
export function standInBosses(content: BattleContent, count: number): Species[] {
  const all = [...content.species.values()];
  const into = grownInto(all);
  const picked: Species[] = [];
  for (const s of all.filter((x) => into.has(x.id) && x.evolutions.length === 0).sort(byId)) {
    if (picked.length < count && !picked.some((p) => p.element === s.element)) picked.push(s);
  }
  return picked;
}

/**
 * The bosses to fight: the visiting bag's boss forms (#234) when it holds
 * any, else `count` stand-ins.
 */
export function simBosses(
  content: BattleContent,
  count: number,
  bag: readonly BossBagEntry[] = BOSS_EVENTS.bag,
): Species[] {
  if (bag.length === 0) return standInBosses(content, count);
  return bag.map((entry) => {
    const boss = content.species.get(entry.speciesId);
    if (!boss) throw new Error(`the boss bag's "${entry.speciesId}" is not a species`);
    return boss;
  });
}

/** The form a base form has grown into by `level`. */
function formAt(content: BattleContent, baseId: string, level: number): string {
  let id = baseId;
  for (;;) {
    const next = content.species.get(id)?.evolutions.find((e) => e.level <= level);
    if (!next) return id;
    id = next.into;
  }
}

/** The matchup multiplier of `attacker`'s element into `defender`'s. */
const into = (content: BattleContent, attacker: Species, defender: Species) =>
  content.elementMatrix[attacker.element][defender.element];

/** Base forms a team can draw from for `mix` against `boss`. */
function pool(content: BattleContent, boss: Species, mix: BossTeamShape['mix']): Species[] {
  const all = [...content.species.values()];
  const into_ = grownInto(all);
  // A Keeper's team: public base forms (never a secret or a boss line).
  const base = all.filter((s) => !into_.has(s.id) && !hiddenUntilSeen(s)).sort(byId);
  if (mix === 'good') return base.filter((s) => into(content, s, boss) > 1);
  if (mix === 'bad') return base.filter((s) => into(content, boss, s) > 1);
  return base;
}

export function bossSetup(
  content: BattleContent,
  config: BossSimConfig,
  shape: BossTeamShape,
  boss: Species,
  bonus: number,
  game: number,
): BattleSetup {
  const seed = deriveSeed(config.seed, shape.key, boss.id, bonus, game);
  const rng = Rng.fromSeed(deriveSeed(seed, 'team'));
  const choices = pool(content, boss, shape.mix);
  const team: BattleSquishySetup[] = shape.levelsBelow.map((below, slot) => {
    const level = Math.max(1, config.level + bonus - below);
    const base = choices[rng.int(0, choices.length - 1)];
    if (!base) throw new Error(`no ${shape.mix} team members against ${boss.id}`);
    return { id: `a:${String(slot)}`, speciesId: formAt(content, base.id, level), level };
  });
  return {
    seed,
    format: { a: team.length as 1 | 2 | 3, b: 1 },
    sides: {
      a: { controller: { type: 'ai', policy: config.policy }, squishies: team },
      b: {
        controller: { type: 'ai', policy: 'guardian' },
        squishies: [{ id: 'b:boss', speciesId: boss.id, level: config.level, boss: true }],
      },
    },
  };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export function runBossSim(
  config: BossSimConfig,
  content = bossContent(),
  bag: readonly BossBagEntry[] = BOSS_EVENTS.bag,
): BossCell[] {
  const cells: BossCell[] = [];
  const bosses = simBosses(content, config.bosses, bag);
  for (const shape of config.shapes) {
    for (const boss of bosses) {
      for (const bonus of config.levelBonuses) {
        let wins = 0;
        const rounds: number[] = [];
        for (let game = 0; game < config.games; game++) {
          const { state } = autoplayBattle(
            content,
            bossSetup(content, config, shape, boss, bonus, game),
          );
          if (state.phase.type === 'over' && state.phase.result.winner === 'a') wins += 1;
          rounds.push(state.turn);
        }
        cells.push({
          shape: shape.key,
          boss: boss.id,
          bonus,
          games: config.games,
          winPercent: Math.floor((wins * 100) / config.games),
          medianRounds: median(rounds),
        });
      }
    }
  }
  return cells;
}

/** The plan's gates (§9), read off the cells. */
export function bossGates(cells: readonly BossCell[], config: BossSimConfig): BossGate[] {
  const [first] = config.shapes;
  const balanced = cells.filter((c) => c.shape === first?.key && c.bonus === 0);
  const lone = cells.filter((c) => c.shape === 'team of 1' && c.bonus === 0);
  const over = cells.filter((c) => c.shape === first?.key && c.bonus === 5);
  const g = config.gates;
  const rates = balanced.map((c) => c.winPercent);
  const all = (list: readonly BossCell[], ok: (c: BossCell) => boolean) =>
    list.length > 0 && list.every(ok);
  const show = (list: readonly BossCell[], pick: (c: BossCell) => number) =>
    list.map((c) => `${c.boss} ${String(pick(c))}`).join(', ');
  return [
    {
      name: `team of 3 at level wins ${String(g.balanced[0])}–${String(g.balanced[1])}%`,
      value: show(balanced, (c) => c.winPercent),
      pass: all(balanced, (c) => c.winPercent >= g.balanced[0] && c.winPercent <= g.balanced[1]),
    },
    {
      name: `team of 1 at level wins under ${String(g.loneUnder)}%`,
      value: show(lone, (c) => c.winPercent),
      pass: all(lone, (c) => c.winPercent < g.loneUnder),
    },
    {
      name: `team of 3, 5 levels over, wins ${String(g.overAtLeast)}%+`,
      value: show(over, (c) => c.winPercent),
      pass: all(over, (c) => c.winPercent >= g.overAtLeast),
    },
    {
      name: `median fight ${String(g.medianRounds[0])}–${String(g.medianRounds[1])} rounds`,
      value: show(balanced, (c) => c.medianRounds),
      pass: all(
        balanced,
        (c) => c.medianRounds >= g.medianRounds[0] && c.medianRounds <= g.medianRounds[1],
      ),
    },
    {
      name: `bosses within ${String(g.bossSpread)} points of each other`,
      value: `${String(Math.max(...rates) - Math.min(...rates))} points`,
      pass: rates.length > 0 && Math.max(...rates) - Math.min(...rates) <= g.bossSpread,
    },
  ];
}

export function renderBossSim(
  cells: readonly BossCell[],
  gates: readonly BossGate[],
  config: BossSimConfig,
  bag: readonly BossBagEntry[] = BOSS_EVENTS.bag,
): string {
  const who =
    bag.length > 0
      ? "the visiting bag's bosses (`BOSS_EVENTS.bag`)"
      : 'stand-in bosses (grown-ups flagged `boss`)';
  const lines = [
    '# Mini-boss team battles (`pnpm sim:boss`, #190)',
    '',
    `${String(config.games)} seeded games per cell; Partner and boss at level ${String(config.level)}; ${who}. Soft gate: it reports and never fails the build.`,
    '',
    '| Team | Boss | Levels over | Win % | Median rounds |',
    '| --- | --- | ---: | ---: | ---: |',
    ...cells.map(
      (c) =>
        `| ${c.shape} | ${c.boss} | +${String(c.bonus)} | ${String(c.winPercent)} | ${String(c.medianRounds)} |`,
    ),
    '',
    '| Gate | Value | Result |',
    '| --- | --- | --- |',
    ...gates.map((g) => `| ${g.name} | ${g.value} | ${g.pass ? 'PASS' : 'FAIL'} |`),
    '',
  ];
  return lines.join('\n');
}
