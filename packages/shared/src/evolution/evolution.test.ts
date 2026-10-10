import { describe, expect, it } from 'vitest';
import { EVOLUTION_RULES } from '../data/server/evolution-rules.js';
import { deriveSeed } from '../rng/index.js';
import type { FeelingId } from '../schemas/data/elements.js';
import { evolutionForms } from './forms.js';
import {
  addLean,
  careScore,
  dominantFeeling,
  habitatLeanPoints,
  leanAt,
  startingLean,
} from './lean.js';
import {
  conditionHolds,
  evolutionWeights,
  rollEvolution,
  stepForms,
  type EvolutionFacts,
  type EvolutionForm,
  type EvolutionRollInputs,
} from './roll.js';
import { whisperFor } from './whisper.js';

const FEELINGS: FeelingId[] = ['joy', 'cozy', 'brave', 'silly', 'sleepy', 'spooky'];
const DAY: EvolutionFacts = { time: 'day', seasons: [], firesLit: [], fireFull: false };
const NIGHT: EvolutionFacts = { ...DAY, time: 'night' };

/** A line with a default form, a sleepy branch and a rare night branch, as the data shapes it. */
const FORMS: EvolutionForm[] = [
  { from: 'puff', into: 'splash', level: 16 },
  { from: 'puff', into: 'doze', level: 16, trigger: { kind: 'feeling', feeling: 'sleepy' } },
  { from: 'puff', into: 'grand', level: 40 },
  { from: 'hoot', into: 'plume', level: 30 },
  {
    from: 'hoot',
    into: 'storm',
    level: 30,
    trigger: {
      kind: 'rare',
      conditions: [{ kind: 'time', times: ['dusk', 'night'] }],
      whisper: { icon: '🌙', text: '{name} keeps gazing up at the night sky…' },
    },
  },
];

const inputs = (over: Partial<EvolutionRollInputs> = {}): EvolutionRollInputs => ({
  dominant: 'silly',
  careScore: 0,
  facts: DAY,
  pity: {},
  ...over,
});

const share = (forms: readonly EvolutionForm[], i: EvolutionRollInputs, into: string) => {
  const weights = evolutionWeights(forms, i, EVOLUTION_RULES);
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  return (weights.find((w) => w.into === into)?.weight ?? 0) / total;
};

describe('feeling lean', () => {
  const t0 = new Date('2026-10-01T12:00:00Z');
  const hours = (h: number) => new Date(t0.getTime() + h * 3_600_000);

  it('halves every half-life and never ticks backwards', () => {
    const lean = startingLean('silly', t0, EVOLUTION_RULES);
    expect(lean.points).toEqual({ silly: 6 });
    expect(leanAt(lean, hours(96), EVOLUTION_RULES).points.silly).toBe(3);
    expect(leanAt(lean, hours(-5), EVOLUTION_RULES).points.silly).toBe(6);
  });

  it('adds points after decaying, and the most points wins', () => {
    let lean = startingLean('silly', t0, EVOLUTION_RULES);
    for (let i = 0; i < 4; i++) lean = addLean(lean, 'sleepy', 2, hours(i), EVOLUTION_RULES);
    expect(dominantFeeling(lean, 'silly', FEELINGS)).toBe('sleepy');
    // Four days later the pets have faded as much as the head start: still sleepy.
    expect(dominantFeeling(leanAt(lean, hours(100), EVOLUTION_RULES), 'silly', FEELINGS)).toBe(
      'sleepy',
    );
  });

  it('gives a tie, or no points at all, to its own feeling', () => {
    const lean = { points: { cozy: 4, joy: 4 }, at: t0 };
    expect(dominantFeeling(lean, 'joy', FEELINGS)).toBe('joy');
    expect(dominantFeeling({ points: {}, at: null }, 'brave', FEELINGS)).toBe('brave');
  });

  it('counts habitat time and care history', () => {
    expect(habitatLeanPoints(12, EVOLUTION_RULES)).toBe(2);
    expect(habitatLeanPoints(-1, EVOLUTION_RULES)).toBe(0);
    expect(careScore(0, 0)).toBe(0);
    expect(careScore(160, 2)).toBe(0.8);
    expect(careScore(500, 2)).toBe(1);
  });
});

describe('stepForms', () => {
  it('lists the forms at the lowest level reached, default first', () => {
    expect(stepForms('puff', 15, FORMS)).toEqual([]);
    expect(stepForms('puff', 20, FORMS).map((f) => f.into)).toEqual(['splash', 'doze']);
    expect(stepForms('puff', 100, FORMS).map((f) => f.into)).toEqual(['splash', 'doze']);
  });

  it('builds forms from the tables, public before secret, with their triggers', () => {
    const forms = evolutionForms({
      species: [
        {
          id: 'a',
          evolutions: [
            { into: 'b', level: 16 },
            { into: 'c', level: 16 },
          ],
        },
      ],
      secretEvolutions: [
        { from: 'a', into: 's', level: 16, trigger: { kind: 'feeling', feeling: 'joy' } },
      ],
      evolutionOdds: [{ from: 'a', into: 'c', trigger: { kind: 'feeling', feeling: 'cozy' } }],
    });
    expect(forms.map((f) => [f.into, f.trigger?.kind ?? null])).toEqual([
      ['b', null],
      ['c', 'feeling'],
      ['s', 'feeling'],
    ]);
  });
});

describe('evolution odds (owner-approved 2026-10-10)', () => {
  const step = stepForms('puff', 16, FORMS);

  it('gives an aimed branch 60%, up to about 71% with top care, and an unaimed one about 7%', () => {
    expect(share(step, inputs({ dominant: 'sleepy' }), 'doze')).toBeCloseTo(0.6, 3);
    expect(share(step, inputs({ dominant: 'sleepy', careScore: 1 }), 'doze')).toBeCloseTo(
      240 / 340,
      3,
    );
    expect(share(step, inputs({ dominant: 'joy' }), 'doze')).toBeCloseTo(8 / 108, 3);
  });

  it('doubles an aimed branch after one miss and makes it certain after two', () => {
    expect(share(step, inputs({ dominant: 'sleepy', pity: { doze: 1 } }), 'doze')).toBeCloseTo(
      0.75,
      3,
    );
    expect(share(step, inputs({ dominant: 'sleepy', pity: { doze: 2 } }), 'doze')).toBe(1);
    // Pity only counts when the squishy is aimed at the branch.
    expect(share(step, inputs({ dominant: 'joy', pity: { doze: 5 } }), 'doze')).toBeCloseTo(
      8 / 108,
      3,
    );
  });

  it('only rolls a rare branch while its conditions hold', () => {
    const hoot = stepForms('hoot', 30, FORMS);
    expect(share(hoot, inputs(), 'storm')).toBe(0);
    expect(share(hoot, inputs({ facts: NIGHT }), 'storm')).toBeCloseTo(0.6, 3);
    expect(
      conditionHolds({ kind: 'season', season: 'halloween' }, { ...DAY, seasons: ['halloween'] }),
    ).toBe(true);
    expect(conditionHolds({ kind: 'fire-lit', building: 'jack-o-lantern-hearthfire' }, DAY)).toBe(
      false,
    );
    expect(conditionHolds({ kind: 'fire-full' }, { ...DAY, fireFull: true })).toBe(true);
  });

  it('needs the feeling too when a rare branch names one', () => {
    const forms: EvolutionForm[] = [
      { from: 'h', into: 'bloom', level: 25 },
      {
        from: 'h',
        into: 'song',
        level: 25,
        trigger: {
          kind: 'rare',
          conditions: [{ kind: 'fire-full' }],
          feeling: 'joy',
          whisper: { icon: '🔥', text: 'It loves sitting by a bright fire…' },
        },
      },
    ];
    const lit = { ...NIGHT, fireFull: true };
    expect(share(forms, inputs({ facts: lit, dominant: 'cozy' }), 'song')).toBe(0);
    expect(share(forms, inputs({ facts: lit, dominant: 'joy' }), 'song')).toBeCloseTo(0.6, 3);
  });
});

describe('rollEvolution', () => {
  const step = stepForms('puff', 16, FORMS);
  const seed = deriveSeed('test-salt', 'squishy-1', 'puff', 16);

  it('replays a logged roll to the same pick', () => {
    const roll = rollEvolution(
      seed,
      step,
      inputs({ dominant: 'sleepy', careScore: 0.5 }),
      EVOLUTION_RULES,
    );
    const logged = JSON.parse(JSON.stringify(roll)) as typeof roll;
    const replay = rollEvolution(logged.seed, step, logged.inputs, EVOLUTION_RULES);
    expect(replay).toEqual(roll);
    expect(roll.u).toBeGreaterThanOrEqual(0);
    expect(roll.u).toBeLessThan(1);
  });

  it('lands near the table odds over many squishies', () => {
    let branches = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const roll = rollEvolution(
        deriveSeed('salt', i),
        step,
        inputs({ dominant: 'sleepy' }),
        EVOLUTION_RULES,
      );
      if (roll.branch) branches += 1;
    }
    expect(branches / n).toBeGreaterThan(0.57);
    expect(branches / n).toBeLessThan(0.63);
  });

  it('reports aimed misses for pity, and none when the branch comes out', () => {
    for (let i = 0; i < 50; i++) {
      const roll = rollEvolution(
        deriveSeed('salt', i),
        step,
        inputs({ dominant: 'sleepy' }),
        EVOLUTION_RULES,
      );
      expect(roll.aimedMisses).toEqual(roll.pick === 'doze' ? [] : ['doze']);
    }
    const unaimed = rollEvolution(seed, step, inputs({ dominant: 'joy' }), EVOLUTION_RULES);
    expect(unaimed.aimedMisses).toEqual([]);
  });

  it('always picks the default form when it is the only form', () => {
    const roll = rollEvolution(seed, [FORMS[2]!], inputs(), EVOLUTION_RULES);
    expect(roll).toMatchObject({ pick: 'grand', branch: false, aimedMisses: [] });
  });
});

describe('whisperFor', () => {
  const next = stepForms('puff', 100, FORMS);
  const bubbles = { name: 'Bubbles', evolvingPercent: 78, dominant: 'sleepy' as FeelingId };

  it('names the winning feeling from half the evolving meter', () => {
    expect(whisperFor(bubbles, next, EVOLUTION_RULES)).toEqual({
      icon: '💭',
      text: 'Bubbles has been feeling very sleepy lately…',
      sub: 'Something about it is changing.',
    });
    expect(whisperFor({ ...bubbles, evolvingPercent: 49 }, next, EVOLUTION_RULES)).toBeNull();
    expect(whisperFor({ ...bubbles, evolvingPercent: null }, next, EVOLUTION_RULES)).toBeNull();
  });

  it("hints at a rare branch's condition, and says nothing for a line without branches", () => {
    expect(
      whisperFor({ ...bubbles, name: 'Rumble' }, stepForms('hoot', 100, FORMS), EVOLUTION_RULES),
    ).toEqual({ icon: '🌙', text: 'Rumble keeps gazing up at the night sky…' });
    expect(whisperFor(bubbles, [FORMS[2]!], EVOLUTION_RULES)).toBeNull();
  });

  it('never names a form or a number', () => {
    for (const w of Object.values(EVOLUTION_RULES.whisper.feelings)) {
      expect(`${w.text} ${w.sub ?? ''}`).not.toMatch(/\d|%|chance|odds/i);
    }
  });
});
