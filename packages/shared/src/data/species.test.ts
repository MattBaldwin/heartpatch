import { describe, expect, it } from 'vitest';
import { createBattleContent } from '../battle/content.js';
import { autoplayBattle } from '../battle/engine.js';
import { RaritySchema } from '../schemas/data/common.js';
import { ElementIdSchema, FeelingIdSchema } from '../schemas/data/elements.js';
import type { Species } from '../schemas/data/species.js';
import { BATTLE_RULES } from './battle.js';
import { GAME_DATA } from './index.js';
import { GUARDIAN_RULES } from './server/guardian-rules.js';
import { SERVER_GAME_DATA } from './server/index.js';
import { SPAWN_TABLES } from './server/spawn-tables.js';
import { MOVES, SPECIES } from './species.js';
import { WAVE_1_SPECIES } from './species-wave-1.js';
import { TRADING_POST_TERRAIN } from '../territory/reach.js';

/*
 * The launch roster (issue #10, design doc §4). Schema and reference checks
 * live in `checkGameData` / `checkServerGameData`; these pin the roster's
 * shape and its balance intent.
 */

const byId = new Map(SPECIES.map((s) => [s.id, s]));
const evolvedIds = new Set(SPECIES.flatMap((s) => s.evolutions.map((e) => e.into)));
/** Wave-1 kinds (#382) are standalone: no evolutions yet, so they're not lines. */
const standalone = SPECIES.filter((s) => WAVE_1_SPECIES.some((w) => w.id === s.id));
const standaloneIds = new Set(standalone.map((s) => s.id));
/** Base forms: the first squishy of each launch line. */
const bases = SPECIES.filter((s) => !evolvedIds.has(s.id) && !standaloneIds.has(s.id));
const halloween = bases.filter((s) => s.season === 'halloween');
const everyday = bases.filter((s) => s.season === undefined);
/**
 * A line's kid (#443, stage 2), once its batch has shipped: the baby's one
 * evolution, which evolves on into the teens. Lines not converted yet go
 * straight from baby to teen.
 */
const kidOf = (base: Species): Species | undefined => {
  const only = base.evolutions.length === 1 ? byId.get(base.evolutions[0]!.into) : undefined;
  return only && only.evolutions.length > 0 ? only : undefined;
};
/** The form whose evolutions are the line's teens (the #32 branch step). */
const teenStepOf = (base: Species): Species => kidOf(base) ?? base;
/** A line's default teen (stage 3; today's evolved form). */
const evolvedFormOf = (s: Species): Species => byId.get(teenStepOf(s).evolutions[0]!.into)!;
const statTotal = (s: Species) =>
  s.baseStats.hp + s.baseStats.attack + s.baseStats.defense + s.baseStats.speed;
const RARITY_ORDER: readonly string[] = RaritySchema.options.filter((r) => r !== 'secret');

describe('launch roster (issue #10)', () => {
  it('has 12–15 everyday lines plus 4 Halloween lines', () => {
    expect(everyday.length).toBeGreaterThanOrEqual(12);
    expect(everyday.length).toBeLessThanOrEqual(15);
    expect(halloween).toHaveLength(4);
    // Every species is a base form or a form one of them evolves into (#32: one or two).
    expect(SPECIES).toHaveLength(bases.length + evolvedIds.size + standalone.length);
    for (const base of bases) expect(base.evolutions.length, base.id).toBeLessThanOrEqual(2);
  });

  // #443: a kid sits between the baby and its teens, at the baby's old
  // evolution level, and keeps everything but its size and stats.
  it('gives every converted line a kid that keeps its baby’s rarity, element, feeling and season', () => {
    const kids = bases.flatMap((base) => {
      const kid = kidOf(base);
      return kid ? [{ base, kid }] : [];
    });
    expect(kids.length).toBeGreaterThan(0);
    for (const { base, kid } of kids) {
      expect([kid.element, kid.feeling, kid.season, kid.rarity], kid.id).toEqual([
        base.element,
        base.feeling,
        base.season,
        base.rarity,
      ]);
      expect(statTotal(kid), kid.id).toBeGreaterThan(statTotal(base));
      expect(kid.visual.size ?? 1, kid.id).toBeGreaterThan(base.visual.size ?? 1);
      expect(kid.evolutions.length, kid.id).toBeLessThanOrEqual(2);
      // Teens come 8 levels after the kid (#443 §3).
      const kidLevel = base.evolutions[0]!.level;
      for (const evo of kid.evolutions) expect(evo.level, evo.into).toBe(kidLevel + 8);
      // Stats and size sit between the baby's and the teen's.
      const teen = evolvedFormOf(base);
      expect(statTotal(kid), kid.id).toBeLessThan(statTotal(teen));
      expect(kid.visual.size ?? 1, kid.id).toBeLessThan(teen.visual.size ?? 1);
    }
  });

  it('gives every line a default evolution that keeps its element, feeling and season', () => {
    for (const base of bases) {
      expect(base.evolutions.length, base.id).toBeGreaterThanOrEqual(1);
      const evolved = evolvedFormOf(base);
      expect(evolved.evolutions, evolved.id).toEqual([]);
      expect([evolved.element, evolved.feeling, evolved.season], evolved.id).toEqual([
        base.element,
        base.feeling,
        base.season,
      ]);
      // Bigger, stronger and at least as rare (design doc §1 "rarer and more powerful").
      expect(statTotal(evolved), evolved.id).toBeGreaterThan(statTotal(base));
      expect(RARITY_ORDER.indexOf(evolved.rarity), evolved.id).toBeGreaterThanOrEqual(
        RARITY_ORDER.indexOf(base.rarity),
      );
      expect(evolved.visual.size ?? 1, evolved.id).toBeGreaterThan(base.visual.size ?? 1);
    }
  });

  // #32: a branch is a sidegrade of its line's default form, not an upgrade.
  it('makes every branch a sibling of its default form', () => {
    const branches = bases.flatMap((base) =>
      teenStepOf(base)
        .evolutions.slice(1)
        .map((evo) => ({ base, evo, branch: byId.get(evo.into)! })),
    );
    for (const { base, evo, branch } of branches) {
      const first = teenStepOf(base).evolutions[0]!;
      const evolved = evolvedFormOf(base);
      expect(evo.level, branch.id).toBe(first.level);
      expect(branch.evolutions, branch.id).toEqual([]);
      expect([branch.element, branch.rarity, branch.season], branch.id).toEqual([
        base.element,
        evolved.rarity,
        base.season,
      ]);
      expect(branch.feeling, branch.id).not.toBe(evolved.feeling);
      expect(branch.visual.size ?? 1, branch.id).toBeGreaterThan(base.visual.size ?? 1);
      // Synergy moves the budget a little (species.ts); never more than a fifth.
      const ratio = statTotal(branch) / statTotal(evolved);
      expect(ratio, branch.id).toBeGreaterThan(0.8);
      expect(ratio, branch.id).toBeLessThan(1.2);
    }
  });

  it('uses every element and feeling at least twice', () => {
    for (const element of ElementIdSchema.options) {
      expect(bases.filter((s) => s.element === element).length, element).toBeGreaterThanOrEqual(2);
    }
    for (const feeling of FeelingIdSchema.options) {
      expect(bases.filter((s) => s.feeling === feeling).length, feeling).toBeGreaterThanOrEqual(2);
    }
  });

  it('has varied rarity: every public rarity appears, most lines start common or uncommon', () => {
    // The launch roster runs Common to Legendary; no species is Mythic yet (#261).
    expect(new Set(SPECIES.map((s) => s.rarity))).toEqual(
      new Set(RARITY_ORDER.filter((r) => r !== 'mythic')),
    );
    const easy = bases.filter((s) => s.rarity === 'common' || s.rarity === 'uncommon');
    expect(easy.length).toBeGreaterThan(bases.length / 2);
  });

  it('uses every public move, and every species name is unique', () => {
    const used = new Set(SPECIES.flatMap((s) => s.moves));
    expect(MOVES.map((m) => m.id).filter((id) => !used.has(id))).toEqual([]);
    expect(new Set(SPECIES.map((s) => s.name.toLowerCase())).size).toBe(SPECIES.length);
  });

  it('gives every species a habitat that suits its own element and feeling', () => {
    for (const s of SPECIES) {
      expect(s.habitatPreferences.elements, s.id).toContain(s.element);
      expect(s.habitatPreferences.feelings, s.id).toContain(s.feeling);
    }
  });
});

describe('where the roster lives (server-only tables)', () => {
  const spawnable = new Set(SPAWN_TABLES.flatMap((t) => t.entries.map((e) => e.species)));
  const guarding = new Set(GUARDIAN_RULES.tables.flatMap((t) => t.entries.map((e) => e.species)));

  it('spawns every base form wild, and keeps evolved forms out of the wild', () => {
    for (const s of [...bases, ...standalone]) expect(spawnable, s.id).toContain(s.id);
    for (const id of evolvedIds) expect(spawnable, id).not.toContain(id);
  });

  // Branch forms (#32) are only met by evolving one: in the Gap they break a
  // progression pace pin (`pnpm sim:progression`'s tests; which one depends
  // on where the rows sit, since guardian picks are seeded).
  it('meets every default evolved form as a guardian', () => {
    for (const s of bases) expect(guarding, s.id).toContain(evolvedFormOf(s).id);
  });

  it('has someone to find on every terrain on any day of the year', () => {
    // Trading posts (#269) are never wild: nobody spawns there.
    for (const terrain of GAME_DATA.terrains.filter((t) => t.id !== TRADING_POST_TERRAIN)) {
      const everyDay = SPAWN_TABLES.filter(
        (t) => t.terrains.includes(terrain.id) && !t.season && !t.timeOfDay,
      ).flatMap((t) => t.entries.filter((e) => byId.get(e.species)?.season === undefined));
      expect(everyDay.length, terrain.id).toBeGreaterThan(0);
    }
  });

  it('lists Halloween species only in Halloween tables', () => {
    const halloweenIds = new Set(SPECIES.filter((s) => s.season === 'halloween').map((s) => s.id));
    for (const table of [...SPAWN_TABLES, ...GUARDIAN_RULES.tables]) {
      for (const entry of table.entries) {
        if (halloweenIds.has(entry.species)) expect(table.season, table.id).toBe('halloween');
      }
    }
  });

  it('keeps secret squishies and their moves out of the public data (CLAUDE.md rule 6)', () => {
    const shipped = JSON.stringify(GAME_DATA);
    for (const s of SERVER_GAME_DATA.secretSpecies) {
      expect(shipped).not.toContain(`"${s.id}"`);
      expect(shipped).not.toContain(s.name);
    }
    for (const m of SERVER_GAME_DATA.secretMoves) {
      expect(shipped).not.toContain(`"${m.id}"`);
      expect(shipped).not.toContain(m.name);
    }
  });
});

describe('balance intent (design doc §5), played with the real engine', () => {
  const content = createBattleContent(GAME_DATA, BATTLE_RULES);
  const AI = { type: 'ai', policy: 'balanced' } as const;

  /** Share of `games` seeded 1v1 battles at `level` that `a` wins (draws count half). */
  function winRate(a: string, b: string, games: number, level = 12): number {
    let wins = 0;
    for (let i = 0; i < games; i++) {
      const { state } = autoplayBattle(content, {
        seed: `roster-${a}-${b}-${String(i)}`,
        sides: {
          a: { controller: AI, squishies: [{ id: 'a', speciesId: a, level }] },
          b: { controller: AI, squishies: [{ id: 'b', speciesId: b, level }] },
        },
      });
      if (state.phase.type !== 'over') throw new Error('autoplay always finishes');
      const { winner } = state.phase.result;
      wins += winner === 'a' ? 1 : winner === 'draw' ? 0.5 : 0;
    }
    return wins / games;
  }

  it.each([
    ['fuzzbolt', 'dawndrop'],
    ['fuzzbolt', 'thunderpuff'],
    ['pebblesnooze', 'candlekit'],
    ['pebblesnooze', 'glowboo'],
    ['puddlepuff', 'glimmerock'],
    ['snoozicle', 'mossmuffin'],
  ])('plain %s is a great counter to %s', (counter, target) => {
    const plain = byId.get(counter)!;
    const fancy = byId.get(target)!;
    // Plain: common, rarer target, smaller stat total (synergy aside: see species.ts).
    expect(plain.rarity).toBe('common');
    expect(RARITY_ORDER.indexOf(fancy.rarity)).toBeGreaterThan(RARITY_ORDER.indexOf('common'));
    expect(statTotal(plain)).toBeLessThan(statTotal(fancy));
    expect(winRate(counter, target, 100)).toBeGreaterThanOrEqual(0.7); // TUNE:
  });

  it('has no base form that wins (or loses) nearly every 1v1', () => {
    // Launch lines are measured against the launch lines, as ever (a roster of
    // more small kinds shouldn't make its epic look unbeatable). Wave-1 kinds
    // (#382) are measured against everyone, so none of them is a pushover or a bully.
    const everyBase = [...bases, ...standalone];
    const rates = everyBase.map((a) => {
      const field = standaloneIds.has(a.id) ? everyBase : bases;
      const others = field.filter((b) => b !== a);
      const total = others.reduce((sum, b) => sum + winRate(a.id, b.id, 30), 0);
      return { id: a.id, rate: total / others.length };
    });
    // TUNE: rarer squishies win a little more often, but nobody is strictly best.
    const outliers = rates.filter((r) => r.rate < 0.25 || r.rate > 0.75);
    expect(outliers).toEqual([]);
  });
});
