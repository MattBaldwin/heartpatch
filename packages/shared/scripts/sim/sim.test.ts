import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../../src/data/index.js';
import { ElementIdSchema, FeelingIdSchema } from '../../src/schemas/data/elements.js';
import { SIM_CONFIG, type SimConfig } from './config.js';
import {
  planSim,
  serverData,
  speciesForms,
  standIns,
  type Entrant,
  type Matchup,
} from './matchups.js';
import { buildRows, flaggedRows, renderCsv, renderMarkdown } from './report.js';
import { playMatchup, runSim, type MatchResult } from './run.js';

/** A small run: same shape as `SIM_CONFIG`, a few games each. */
const SMALL: SimConfig = {
  ...SIM_CONFIG,
  policies: ['balanced', 'aggressive'],
  games: { species: 2, combo: 2, stance: 2 },
};

const pairCount = (n: number) => (n * (n - 1)) / 2;

describe('planSim', () => {
  const plan = planSim(SMALL);
  const count = (bracket: Matchup['bracket']) =>
    plan.matchups.filter((m) => m.bracket === bracket).length;
  const { base, evolved } = speciesForms(serverData());

  it('plays every base form and every evolved form, secret ones too, in every stance', () => {
    expect(count('base')).toBe(pairCount(base.length) * SMALL.policies.length);
    expect(count('evolved')).toBe(pairCount(evolved.length) * SMALL.policies.length);
    expect(base.map((s) => s.id)).toContain('heartlet');
    expect(evolved.map((s) => s.id)).toContain('heartbloom');
    // Every species is in exactly one bracket.
    expect(base.length + evolved.length).toBe(serverData().species.length);
  });

  it('plays every element × feeling combo against every other', () => {
    const combos = ElementIdSchema.options.length * FeelingIdSchema.options.length;
    expect(count('combo')).toBe(pairCount(combos) * SMALL.policies.length);
  });

  it('mirrors every base form in each pair of different stances', () => {
    expect(count('stance')).toBe(base.length * pairCount(SMALL.policies.length));
    for (const m of plan.matchups.filter((x) => x.bracket === 'stance')) {
      expect(m.a).toBe(m.b);
      expect(m.policyA).not.toBe(m.policyB);
    }
  });

  it('matches levels within a bracket', () => {
    for (const m of plan.matchups) {
      const expected = m.bracket === 'stance' ? SMALL.levels.base : SMALL.levels[m.bracket];
      expect(m.level).toBe(expected);
    }
  });

  it('keeps the stand-ins out of the species and stance content', () => {
    expect([...plan.content.species.keys()].some((id) => id.startsWith('sim-'))).toBe(false);
    expect(plan.comboContent.contentHash).not.toBe(plan.content.contentHash);
  });
});

describe('standIns', () => {
  const stands = standIns(serverData());

  it('gives every element one stand-in with the same stats and only its own public moves', () => {
    expect(stands.map((s) => s.element)).toEqual(ElementIdSchema.options);
    const publicMoves = new Map(GAME_DATA.moves.map((m) => [m.id, m]));
    for (const s of stands) {
      expect(s.baseStats).toEqual(stands[0]!.baseStats);
      expect(s.moves.length).toBeGreaterThan(0);
      for (const id of s.moves) expect(publicMoves.get(id)?.element, id).toBe(s.element);
    }
  });
});

describe('runSim', () => {
  const plan = planSim(SMALL);

  it('is reproducible: the same data and config give the same report', () => {
    const first = runSim(plan, SMALL);
    const second = runSim(planSim(SMALL), SMALL);
    expect(second).toEqual(first);
    expect(renderCsv(buildRows(second, SMALL))).toBe(renderCsv(buildRows(first, SMALL)));
  });

  it('counts every game once, and a different root seed plays different games', () => {
    const matchup: Matchup = { ...plan.matchups[0]!, games: 40 };
    const r = playMatchup(plan, SMALL, matchup);
    expect(r.aWins + r.bWins + r.draws).toBe(40);
    const reseeded = playMatchup(plan, { ...SMALL, rootSeed: 'another-seed' }, matchup);
    expect(reseeded.turns === r.turns && reseeded.aWins === r.aWins).toBe(false);
  });

  it('credits the right entrant when sides swap', () => {
    // Fire vs Leaf at equal stats: Fire's 2× wins nearly always, whichever side it starts on.
    const fire: Entrant = { key: 'fire+joy', speciesId: 'sim-stand-in-fire', feeling: 'joy' };
    const leaf: Entrant = { key: 'leaf+joy', speciesId: 'sim-stand-in-leaf', feeling: 'joy' };
    const base = {
      bracket: 'combo',
      policyA: 'balanced',
      policyB: 'balanced',
      level: 15,
      games: 20,
    } as const;
    expect(playMatchup(plan, SMALL, { ...base, a: fire, b: leaf }).aWins).toBeGreaterThanOrEqual(
      18,
    );
    expect(playMatchup(plan, SMALL, { ...base, a: leaf, b: fire }).bWins).toBeGreaterThanOrEqual(
      18,
    );
  });
});

describe('report', () => {
  const entrant = (key: string, rarity = 'common', secret = false): Entrant => ({
    key,
    speciesId: key,
    rarity,
    secret,
  });
  const result = (
    a: Entrant,
    b: Entrant,
    aWins: number,
    bWins: number,
    draws = 0,
    bracket: Matchup['bracket'] = 'base',
  ): MatchResult => ({
    matchup: {
      bracket,
      a,
      b,
      policyA: 'balanced',
      policyB: 'balanced',
      level: 12,
      games: aWins + bWins + draws,
    },
    aWins,
    bWins,
    draws,
    turns: 0,
  });

  it('flags win rates outside the band (draws count half) and names the table to tune', () => {
    const strong = entrant('strongling', 'legendary');
    const weak = entrant('weakling');
    const edge = entrant('edgeling', 'secret', true);
    // strongling 70/100 vs weakling; edgeling: exactly 65% vs weakling → not flagged.
    const rows = buildRows(
      [result(strong, weak, 70, 30), result(edge, weak, 60, 30, 10)],
      SIM_CONFIG,
    );
    const species = new Map(rows.filter((r) => r.section === 'species').map((r) => [r.subject, r]));
    expect(species.get('strongling')).toMatchObject({ winRate: 0.7, flag: 'strong' });
    expect(species.get('edgeling')).toMatchObject({ winRate: 0.65, flag: null, draws: 10 });
    expect(species.get('edgeling')!.tune).toContain('data/server/secret-species.ts');
    // weakling: 60 wins and 10 draws out of 200 is 32.5%.
    expect(species.get('weakling')).toMatchObject({ games: 200, wins: 60, flag: 'weak' });
    expect(species.get('weakling')!.tune).toContain('data/species.ts');
    expect(flaggedRows(rows).map((r) => r.subject)).toEqual(['strongling', 'weakling']);
  });

  it('never flags head-to-head pairs: counters are by design', () => {
    const rows = buildRows([result(entrant('x'), entrant('y'), 100, 0)], SIM_CONFIG);
    const pair = rows.find((r) => r.section === 'pair')!;
    expect(pair).toMatchObject({ subject: 'x', opponent: 'y', winRate: 1, flag: null });
  });

  it('points elements, feelings, combos and stances at their tables', () => {
    const combo = (element: 'fire' | 'leaf', feeling: 'joy' | 'cozy'): Entrant => ({
      key: `${element}+${feeling}`,
      speciesId: `sim-stand-in-${element}`,
      element,
      feeling,
    });
    const stance: MatchResult = {
      ...result(entrant('x'), entrant('x'), 80, 20, 0, 'stance'),
      matchup: {
        ...result(entrant('x'), entrant('x'), 80, 20).matchup,
        bracket: 'stance',
        policyB: 'defensive',
      },
    };
    const rows = buildRows(
      [result(combo('fire', 'joy'), combo('leaf', 'cozy'), 90, 10, 0, 'combo'), stance],
      SIM_CONFIG,
    );
    const tune = (section: string, subject: string) =>
      rows.find((r) => r.section === section && r.subject === subject)?.tune;
    expect(tune('element', 'fire')).toContain('ELEMENT_MATRIX');
    expect(tune('element', 'fire')).toContain('fire moves');
    expect(tune('feeling', 'cozy')).toContain('FEELING_MATRIX');
    expect(tune('combo', 'fire+joy')).toContain('SYNERGY_TABLE');
    expect(rows.find((r) => r.section === 'stance')).toMatchObject({
      subject: 'balanced',
      opponent: 'defensive',
      winRate: 0.8,
      flag: 'strong',
    });
    expect(tune('stance', 'balanced')).toContain('BATTLE_RULES.ai');
  });

  it('writes a flags table in Markdown and quotes CSV cells that need it', () => {
    const rows = buildRows([result(entrant('a,"b"'), entrant('c'), 90, 10)], SIM_CONFIG);
    const md = renderMarkdown(rows, SIM_CONFIG, {
      contentHash: 'abc',
      battles: 100,
      averageTurns: 5,
      seconds: 1,
    });
    expect(md).toContain('## Flags (2)');
    expect(md).toMatch(/🔺 strong \| base form a,"b" \| 90\.0% \| 100 \| species base stats/);
    const csv = renderCsv(rows);
    expect(csv.split('\n')[0]).toBe(
      'section,group,subject,opponent,rarity,games,wins,draws,losses,win_rate,flag,tune',
    );
    expect(csv).toContain('species,base,"a,""b""",,common,100,90,0,10,0.9000,strong,');
  });
});

describe('where the sim lives', () => {
  it('is never imported by game code or the client (it reads server-only data)', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const roots = ['packages/shared/src', 'apps/client/src', 'apps/server/src'].map((p) =>
      join(repo, p),
    );
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.ts$/.test(name) && /scripts\/sim/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
