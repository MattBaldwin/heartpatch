import { chooseAiChoice } from '../../src/battle/ai.js';
import { createBattleContent, type BattleContent } from '../../src/battle/content.js';
import { applyBattleAction, startBattle } from '../../src/battle/engine.js';
import { effectiveStat } from '../../src/battle/formulas.js';
import { activeSquishy } from '../../src/battle/state.js';
import { BATTLE_RULES } from '../../src/data/battle.js';
import { SPAWN_RULES } from '../../src/data/server/spawn-rules.js';
import { STARTERS } from '../../src/data/starters.js';
import { deriveSeed, Rng } from '../../src/rng/index.js';
import type { BattleChoice } from '../../src/schemas/battle.js';
import type { BattleAiPolicy } from '../../src/schemas/data/battle.js';
import type { Rarity } from '../../src/schemas/data/common.js';
import { serverData, speciesForms } from './matchups.js';

/*
 * `pnpm sim:potions` (#214): how often a lone Partner beats a wild squishy
 * of each rarity, with no potion and with one. The Partner is a starter
 * played by a stand-in kid (an AI policy) on the player's side; the wild
 * squishy plays the real wild AI. Wild levels follow the Partner like
 * spawns do (`SPAWN_RULES.partnerOffset`, each offset equally often, less
 * `rarityLevelDiscount`). Real engine, real data, seeded: the same data and
 * config always give the same report.
 *
 * A potion is a free sip (#403): the Partner drinks along with its move.
 * Faster foes get their own table, since they are where a potion that cost
 * the turn used to lose fights. `--compare` adds the pre-#403 rule (the sip
 * is the whole turn) beside each potion.
 */

/** When the Partner drinks, if at all. */
export type PotionPlan =
  | { readonly key: 'none' }
  /** On the first turn. */
  | {
      readonly key: string;
      readonly item: string;
      readonly when: 'first-turn';
      /** The pre-#403 rule, for comparison: the sip is the whole turn. */
      readonly wholeTurn?: true;
    }
  /** The first turn it starts below `percent`% energy. */
  | {
      readonly key: string;
      readonly item: string;
      readonly when: 'below';
      readonly percent: number;
      readonly wholeTurn?: true;
    };

/** Each potion plan again under the pre-#403 rule (`--compare`), keyed `<key>-whole-turn`. */
export function withWholeTurnPlans(plans: readonly PotionPlan[]): PotionPlan[] {
  return plans.flatMap((plan): PotionPlan[] =>
    'item' in plan ? [plan, { ...plan, key: `${plan.key}-whole-turn`, wholeTurn: true }] : [plan],
  );
}

export interface PotionSimConfig {
  readonly rootSeed: string;
  /** How the stand-in kid picks moves for the Partner. */
  readonly kidPolicy: BattleAiPolicy;
  readonly partnerLevels: readonly number[];
  readonly rarities: readonly Rarity[];
  /** Wild levels around the Partner's; `SPAWN_RULES.partnerOffset` when left out. */
  readonly levelOffset?: { readonly min: number; readonly max: number };
  /** Levels a Partner-matched wild squishy spawns below the roll, by rarity (none ships). */
  readonly rarityLevelDiscount: Partial<Record<Rarity, number>>;
  readonly plans: readonly PotionPlan[];
  /** Battles per starter × wild species × Partner level × level offset × plan. */
  readonly games: number;
}

export const POTION_SIM_CONFIG: PotionSimConfig = {
  rootSeed: 'heartpatch-potion-sim-v1',
  kidPolicy: 'balanced', // TUNE: a kid picks good moves most of the time
  partnerLevels: [5, 10, 20, 30],
  rarities: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
  rarityLevelDiscount: {},
  plans: [
    { key: 'none' },
    { key: 'brave-brew', item: 'brave-brew', when: 'first-turn' },
    { key: 'cozy-cocoa', item: 'cozy-cocoa', when: 'first-turn' },
    { key: 'hearty-soup', item: 'hearty-soup', when: 'below', percent: 50 },
  ],
  games: 40, // TUNE: more games, less noise, slower run
};

export interface PotionSimRow {
  readonly rarity: Rarity;
  readonly plan: string;
  readonly partnerLevel: number | 'all';
  readonly wins: number;
  readonly battles: number;
  /** The battles against a foe faster than the Partner, and the Partner's wins in them. */
  readonly fasterWins: number;
  readonly fasterBattles: number;
}

/**
 * The Partner's choice this turn: the stand-in kid's pick, with the planned
 * potion sipped along once it's due (#403). The kid always picks first, so
 * every plan meets the same rolls.
 */
function kidChoice(
  content: BattleContent,
  state: ReturnType<typeof startBattle>,
  plan: PotionPlan,
  policy: BattleAiPolicy,
  rng: Rng,
): BattleChoice {
  const pick = chooseAiChoice(content, state, 'a', policy, rng);
  if (plan.key !== 'none' && 'item' in plan && !state.sides.a.itemsUsed.includes(plan.item)) {
    const me = activeSquishy(state, 'a');
    const due = plan.when === 'first-turn' || me.energy * 100 < me.stats.hp * plan.percent;
    if (due && plan.wholeTurn) return { type: 'item', item: plan.item };
    // A lone Partner only ever moves; anything else waits for the next turn.
    if (due && pick.type === 'move') return { ...pick, item: plan.item };
  }
  return pick;
}

/** Plays one battle to the end: did the Partner win, and was the foe faster? */
function playOne(
  content: BattleContent,
  config: PotionSimConfig,
  partner: { speciesId: string; level: number },
  wild: { speciesId: string; level: number },
  plan: PotionPlan,
  seed: string,
): { won: boolean; faster: boolean } {
  const kidRng = Rng.fromSeed(deriveSeed(seed, 'kid'));
  let state = startBattle(content, {
    seed,
    sides: {
      a: { controller: { type: 'player' }, squishies: [{ id: 'partner', ...partner }] },
      b: { controller: { type: 'ai', policy: 'wild' }, squishies: [{ id: 'wild', ...wild }] },
    },
  });
  const speed = (side: 'a' | 'b') =>
    effectiveStat(activeSquishy(state, side), 'speed', content.rules);
  const faster = speed('b') > speed('a');
  while (state.phase.type !== 'over') {
    const a = kidChoice(content, state, plan, config.kidPolicy, kidRng);
    state = applyBattleAction(content, state, { type: 'turn', choices: { a } });
  }
  return { won: state.phase.result.winner === 'a', faster };
}

export function runPotionSim(config: PotionSimConfig): {
  rows: PotionSimRow[];
  contentHash: string;
  wildCounts: Partial<Record<Rarity, number>>;
} {
  const data = serverData();
  const content = createBattleContent(data, BATTLE_RULES);
  const { base } = speciesForms(data);
  const offset = levelOffsetOf(config);
  const rows: PotionSimRow[] = [];
  const wildCounts: Partial<Record<Rarity, number>> = {};
  for (const rarity of config.rarities) {
    const wilds = base.filter((s) => s.rarity === rarity);
    wildCounts[rarity] = wilds.length;
    for (const plan of config.plans) {
      const all = { wins: 0, battles: 0, fasterWins: 0, fasterBattles: 0 };
      for (const partnerLevel of config.partnerLevels) {
        const tally = { wins: 0, battles: 0, fasterWins: 0, fasterBattles: 0 };
        for (const starter of STARTERS.speciesIds) {
          for (const wild of wilds) {
            for (let shift = offset.min; shift <= offset.max; shift++) {
              const level = Math.max(
                1,
                partnerLevel + shift - (config.rarityLevelDiscount[rarity] ?? 0),
              );
              for (let i = 0; i < config.games; i++) {
                const seed = deriveSeed(config.rootSeed, starter, wild.id, partnerLevel, shift, i);
                // Every plan meets the same seeds, so plans differ only by the potion.
                const { won, faster } = playOne(
                  content,
                  config,
                  { speciesId: starter, level: partnerLevel },
                  { speciesId: wild.id, level },
                  plan,
                  seed,
                );
                tally.wins += won ? 1 : 0;
                tally.battles += 1;
                if (faster) {
                  tally.fasterWins += won ? 1 : 0;
                  tally.fasterBattles += 1;
                }
              }
            }
          }
        }
        rows.push({ rarity, plan: plan.key, partnerLevel, ...tally });
        all.wins += tally.wins;
        all.battles += tally.battles;
        all.fasterWins += tally.fasterWins;
        all.fasterBattles += tally.fasterBattles;
      }
      rows.push({ rarity, plan: plan.key, partnerLevel: 'all', ...all });
    }
  }
  return { rows, contentHash: content.contentHash, wildCounts };
}

const levelOffsetOf = (config: PotionSimConfig) =>
  config.levelOffset ?? SPAWN_RULES.partnerOffset ?? { min: 0, max: 0 };

const pct = (wins: number, battles: number) =>
  battles === 0 ? '–' : `${((wins * 100) / battles).toFixed(0)}%`;

/** The report: one table per Partner level and an overall one, rarity × plan. */
export function renderPotionReport(
  result: ReturnType<typeof runPotionSim>,
  config: PotionSimConfig,
): string {
  const levels: (number | 'all')[] = ['all', ...config.partnerLevels];
  const rowOf = (rarity: Rarity, plan: string, level: number | 'all') =>
    result.rows.find((r) => r.rarity === rarity && r.plan === plan && r.partnerLevel === level);
  const cell = (rarity: Rarity, plan: string, level: number | 'all') => {
    const row = rowOf(rarity, plan, level);
    return row ? pct(row.wins, row.battles) : '–';
  };
  const fasterCell = (rarity: Rarity, plan: string) => {
    const row = rowOf(rarity, plan, 'all');
    return row ? pct(row.fasterWins, row.fasterBattles) : '–';
  };
  const table = (cellOf: (rarity: Rarity, plan: string) => string) => [
    `| Wild rarity (species) | ${config.plans.map((p) => p.key).join(' | ')} |`,
    `|---|${config.plans.map(() => '---:').join('|')}|`,
    ...config.rarities.map(
      (rarity) =>
        `| ${rarity} (${String(result.wildCounts[rarity] ?? 0)}) | ${config.plans
          .map((p) => cellOf(rarity, p.key))
          .join(' | ')} |`,
    ),
    '',
  ];
  const offset = levelOffsetOf(config);
  const discount = Object.entries(config.rarityLevelDiscount)
    .map(([r, n]) => `${String(n)} for ${r}`)
    .join(', ');
  const lines = [
    '# Potion sim (#214)',
    '',
    `Content hash \`${result.contentHash}\`. A lone starter Partner, played by the \`${config.kidPolicy}\` policy, against every wild base form of a rarity. Wild levels: Partner level ${String(offset.min)} to ${String(offset.max)}${discount ? `, less ${discount}` : ''}. Brave Brew and Cozy Cocoa are sipped on turn 1; Hearty Soup the first turn below half energy. A sip is free (#403): the Partner still makes its move that turn${config.plans.some((p) => 'wholeTurn' in p) ? '; `-whole-turn` plans use the pre-#403 rule, where the sip was the whole turn' : ''}. Win rate (draws count as not winning).`,
    '',
  ];
  for (const level of levels) {
    lines.push(level === 'all' ? '## All Partner levels' : `## Partner level ${String(level)}`, '');
    lines.push(...table((rarity, plan) => cell(rarity, plan, level)));
    if (level === 'all') {
      lines.push('## Faster foes, all Partner levels', '');
      lines.push(
        'Only the battles where the wild squishy is faster than the Partner, so it bumps first every turn.',
        '',
      );
      lines.push(...table(fasterCell));
    }
  }
  return lines.join('\n');
}
