import { chooseAiChoice } from '../../src/battle/ai.js';
import { createBattleContent, type BattleContent } from '../../src/battle/content.js';
import { applyBattleAction, startBattle } from '../../src/battle/engine.js';
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
 */

/** When the Partner drinks, if at all. */
export type PotionPlan =
  | { readonly key: 'none' }
  /** On the first turn. */
  | { readonly key: string; readonly item: string; readonly when: 'first-turn' }
  /** The first turn it starts below `percent`% energy. */
  | {
      readonly key: string;
      readonly item: string;
      readonly when: 'below';
      readonly percent: number;
    };

export interface PotionSimConfig {
  readonly rootSeed: string;
  /** How the stand-in kid picks moves for the Partner. */
  readonly kidPolicy: BattleAiPolicy;
  readonly partnerLevels: readonly number[];
  readonly rarities: readonly Rarity[];
  /**
   * Levels a Partner-matched wild squishy spawns below the roll, by rarity.
   * Mirrors #211's server-only `SPAWN_RULES.rarityLevelDiscount` until it lands.
   */
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
  rarityLevelDiscount: { rare: 1, epic: 2, legendary: 2, secret: 2 },
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
}

/** The Partner's choice this turn: the planned potion once, else the stand-in kid's pick. */
function kidChoice(
  content: BattleContent,
  state: ReturnType<typeof startBattle>,
  plan: PotionPlan,
  policy: BattleAiPolicy,
  rng: Rng,
): BattleChoice {
  if (plan.key !== 'none' && 'item' in plan && !state.sides.a.itemsUsed.includes(plan.item)) {
    const me = activeSquishy(state, 'a');
    const due = plan.when === 'first-turn' || me.energy * 100 < me.stats.hp * plan.percent;
    if (due) return { type: 'item', item: plan.item };
  }
  return chooseAiChoice(content, state, 'a', policy, rng);
}

/** Plays one battle to the end; true if the Partner won. */
function playOne(
  content: BattleContent,
  config: PotionSimConfig,
  partner: { speciesId: string; level: number },
  wild: { speciesId: string; level: number },
  plan: PotionPlan,
  seed: string,
): boolean {
  const kidRng = Rng.fromSeed(deriveSeed(seed, 'kid'));
  let state = startBattle(content, {
    seed,
    sides: {
      a: { controller: { type: 'player' }, squishies: [{ id: 'partner', ...partner }] },
      b: { controller: { type: 'ai', policy: 'wild' }, squishies: [{ id: 'wild', ...wild }] },
    },
  });
  while (state.phase.type !== 'over') {
    const a = kidChoice(content, state, plan, config.kidPolicy, kidRng);
    state = applyBattleAction(content, state, { type: 'turn', choices: { a } });
  }
  return state.phase.result.winner === 'a';
}

export function runPotionSim(config: PotionSimConfig): {
  rows: PotionSimRow[];
  contentHash: string;
  wildCounts: Partial<Record<Rarity, number>>;
} {
  const data = serverData();
  const content = createBattleContent(data, BATTLE_RULES);
  const { base } = speciesForms(data);
  const offset = SPAWN_RULES.partnerOffset ?? { min: 0, max: 0 };
  const rows: PotionSimRow[] = [];
  const wildCounts: Partial<Record<Rarity, number>> = {};
  for (const rarity of config.rarities) {
    const wilds = base.filter((s) => s.rarity === rarity);
    wildCounts[rarity] = wilds.length;
    for (const plan of config.plans) {
      let allWins = 0;
      let allBattles = 0;
      for (const partnerLevel of config.partnerLevels) {
        let wins = 0;
        let battles = 0;
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
                if (
                  playOne(
                    content,
                    config,
                    { speciesId: starter, level: partnerLevel },
                    { speciesId: wild.id, level },
                    plan,
                    seed,
                  )
                ) {
                  wins += 1;
                }
                battles += 1;
              }
            }
          }
        }
        rows.push({ rarity, plan: plan.key, partnerLevel, wins, battles });
        allWins += wins;
        allBattles += battles;
      }
      rows.push({
        rarity,
        plan: plan.key,
        partnerLevel: 'all',
        wins: allWins,
        battles: allBattles,
      });
    }
  }
  return { rows, contentHash: content.contentHash, wildCounts };
}

const pct = (wins: number, battles: number) =>
  battles === 0 ? '–' : `${((wins * 100) / battles).toFixed(0)}%`;

/** The report: one table per Partner level and an overall one, rarity × plan. */
export function renderPotionReport(
  result: ReturnType<typeof runPotionSim>,
  config: PotionSimConfig,
): string {
  const levels: (number | 'all')[] = ['all', ...config.partnerLevels];
  const cell = (rarity: Rarity, plan: string, level: number | 'all') => {
    const row = result.rows.find(
      (r) => r.rarity === rarity && r.plan === plan && r.partnerLevel === level,
    );
    return row ? pct(row.wins, row.battles) : '–';
  };
  const lines = [
    '# Potion sim (#214)',
    '',
    `Content hash \`${result.contentHash}\`. A lone starter Partner, played by the \`${config.kidPolicy}\` policy, against every wild base form of a rarity. Wild levels: Partner level ${String(SPAWN_RULES.partnerOffset?.min ?? 0)} to +${String(SPAWN_RULES.partnerOffset?.max ?? 0)}, less the rarity discount (${Object.entries(
      config.rarityLevelDiscount,
    )
      .map(([r, n]) => `${r} ${String(n)}`)
      .join(
        ', ',
      )}). Brave Brew and Cozy Cocoa are drunk on turn 1; Hearty Soup the first turn below half energy. Win rate (draws count as not winning).`,
    '',
  ];
  for (const level of levels) {
    lines.push(level === 'all' ? '## All Partner levels' : `## Partner level ${String(level)}`, '');
    lines.push(
      `| Wild rarity (species) | ${config.plans.map((p) => p.key).join(' | ')} |`,
      `|---|${config.plans.map(() => '---:').join('|')}|`,
    );
    for (const rarity of config.rarities) {
      lines.push(
        `| ${rarity} (${String(result.wildCounts[rarity] ?? 0)}) | ${config.plans
          .map((p) => cell(rarity, p.key, level))
          .join(' | ')} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
