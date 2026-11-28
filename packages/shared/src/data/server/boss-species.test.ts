import { describe, expect, it } from 'vitest';
import { baseFormOf } from '../../boss/befriend.js';
import type { EvolutionStep } from '../../care/growth.js';
import { checkRosterArt } from '../../schemas/data/art-rules.js';
import { checkGameData } from '../../schemas/data/game-data.js';
import { MoveSchema } from '../../schemas/data/moves.js';
import { checkServerGameData } from '../../schemas/data/server-game-data.js';
import { hiddenUntilSeen } from '../../schemas/data/species.js';
import { visualRegistry } from '../../schemas/data/visuals.js';
import { BOSS_BODIES, BOSS_PARTS } from '../boss-parts.js';
import { GAME_DATA } from '../index.js';
import { ART_RULES } from '../visuals.js';
import { BOSS_EVENTS } from './boss-events.js';
import { BOSS_EVOLUTIONS, BOSS_MOVES, BOSS_SPECIES } from './boss-species.js';
import { SERVER_GAME_DATA } from './index.js';
import { SECRET_EVOLUTIONS, SECRET_MOVES, SECRET_SPECIES } from './secret-species.js';

// #234 (234b-1): the four mini-boss lines as real, server-only game data.

const LINES: readonly (readonly [string, string, string])[] = [
  ['pileup', 'rakeling', 'rakelet'],
  ['momo', 'mamarama', 'mommentum'],
  ['snowpop', 'frostpop', 'papa-brrr'],
  ['zoomlet', 'revvy', 'rickeyride'],
];
/** The Christmas Eve BIG squishy (#37 X3): its befriend form, then its boss form. */
const EVE = ['bundlebit', 'snowbundle'] as const;

const byId = new Map(BOSS_SPECIES.map((s) => [s.id, s]));
const get = (id: string) => {
  const s = byId.get(id);
  if (!s) throw new Error(`no boss species "${id}"`);
  return s;
};
const total = (id: string) => {
  const b = get(id).baseStats;
  return b.hp + b.attack + b.defense + b.speed;
};
const steps: EvolutionStep[] = [
  ...[...GAME_DATA.species, ...SECRET_SPECIES].flatMap((s) =>
    s.evolutions.map((e) => ({ from: s.id, into: e.into, level: e.level })),
  ),
  ...SECRET_EVOLUTIONS,
];
const registry = visualRegistry(GAME_DATA);
/** Every boss species and move id and name: what the client bundle check bans. */
const secretWords = [...BOSS_SPECIES, ...BOSS_MOVES].flatMap((r) => [r.id, r.name]);

describe('mini-boss species (#234)', () => {
  it('ships four lines of three: base and middle legendary, the boss mythic', () => {
    expect(BOSS_SPECIES.map((s) => s.id).sort()).toEqual([...LINES.flat(), ...EVE].sort());
    for (const [base, middle, boss] of LINES) {
      expect([base, middle, boss].map((id) => get(id).rarity)).toEqual([
        'legendary',
        'legendary',
        'mythic',
      ]);
      const { element, feeling } = get(base);
      for (const id of [middle, boss]) expect(get(id)).toMatchObject({ element, feeling });
    }
  });

  it('marks every one a boss line, hidden until seen, and secret (server-only)', () => {
    for (const s of BOSS_SPECIES) {
      expect(s.line, s.id).toBe('boss');
      expect(hiddenUntilSeen(s), s.id).toBe(true);
      expect(SECRET_SPECIES).toContain(s);
    }
    for (const m of BOSS_MOVES) expect(SECRET_MOVES).toContain(m);
    for (const e of BOSS_EVOLUTIONS) expect(SECRET_EVOLUTIONS).toContain(e);
  });

  it('grows base → middle at 30 and middle → boss at 50, and joins as the base form', () => {
    for (const [base, middle, boss] of LINES) {
      expect(BOSS_EVOLUTIONS.filter((e) => [base, middle, boss].includes(e.from))).toEqual([
        { from: base, into: middle, level: 30 },
        { from: middle, into: boss, level: 50 },
      ]);
      for (const id of [base, middle, boss]) expect(baseFormOf(id, steps)).toBe(base);
      expect(get(base).evolutions).toEqual([]);
    }
  });

  it('keeps stat totals in the plan bands, growing up the line', () => {
    for (const [base, middle, boss] of LINES) {
      expect(total(base), base).toBeGreaterThanOrEqual(260);
      expect(total(base), base).toBeLessThanOrEqual(290);
      // A kid is about ×1.15–1.18 its base (#443); the boss forms are tuned
      // in sim:boss (#234 ruling (A)), well above the middle form.
      expect(total(middle) / total(base), middle).toBeCloseTo(1.18, 1);
      expect(total(boss), boss).toBeGreaterThanOrEqual(340);
      expect(total(boss), boss).toBeLessThanOrEqual(440);
      expect(total(boss) - total(middle), boss).toBeGreaterThanOrEqual(25);
      const stats = ['hp', 'attack', 'defense', 'speed'] as const;
      for (const stat of stats) {
        expect(get(middle).baseStats[stat]).toBeGreaterThan(get(base).baseStats[stat]);
        expect(get(boss).baseStats[stat]).toBeGreaterThan(get(middle).baseStats[stat]);
      }
    }
  });

  it('grows each step inside the art rules’ evolution scale', () => {
    const { min, max } = ART_RULES.evolutionScale;
    for (const [base, middle, boss] of LINES) {
      const size = (id: string) => get(id).visual.size ?? 1;
      for (const [from, into] of [
        [base, middle],
        [middle, boss],
      ] as const) {
        expect(size(into) / size(from), into).toBeGreaterThanOrEqual(min);
        expect(size(into) / size(from), into).toBeLessThanOrEqual(max);
      }
    }
  });

  it('gives the signature moves the #234 engine effects', () => {
    const move = (id: string) => {
      const m = BOSS_MOVES.find((x) => x.id === id);
      if (!m) throw new Error(`no boss move "${id}"`);
      return m;
    };
    const kinds = (id: string) => (move(id).effects ?? []).map((e) => e.type);
    expect(kinds('count-to-three')).toEqual(['windup']);
    expect(kinds('leaf-pile-pounce')).toEqual(['flinch']);
    expect(kinds('full-name-shout')).toEqual(['flinch']);
    expect(kinds('mama-bear-charge')).toEqual(['low-energy']);
    expect(move('ask-your-mother').effects?.[0]).toEqual({
      type: 'assist',
      move: 'mama-bear-charge',
    });
    // Count to Three replaces Mossy Nap (#234 lever A): no heal left to stall on.
    expect(get('rakelet').moves).toContain('count-to-three');
    expect(get('rakelet').moves).not.toContain('mossy-nap');
  });

  it('checks clean with the public and server data', () => {
    expect(checkGameData(GAME_DATA)).toEqual([]);
    expect(checkServerGameData(SERVER_GAME_DATA, GAME_DATA)).toEqual([]);
  });

  it('passes the roster art checks alongside the public roster', () => {
    // checkServerGameData skips silhouettes across secret and public lines (its TODO).
    const problems: string[] = [];
    checkRosterArt(
      'roster+bosses',
      [
        ...GAME_DATA.species,
        ...BOSS_SPECIES.map((s) => ({
          ...s,
          evolutions: BOSS_EVOLUTIONS.filter((e) => e.from === s.id),
        })),
      ],
      registry,
      GAME_DATA.artRules,
      (path, message) => problems.push(`${path.join('.')}: ${message}`),
    );
    expect(problems).toEqual([]);
  });

  it('draws every boss from the public kit, and the kit holds nothing unused', () => {
    const bodies = new Set(GAME_DATA.bodies.map((b) => b.id));
    const parts = new Set(GAME_DATA.parts.map((p) => p.id));
    const usedBodies = new Set<string>();
    const usedParts = new Set<string>();
    for (const s of BOSS_SPECIES) {
      for (const body of [s.visual.body, s.visual.head?.body ?? s.visual.body]) {
        expect(bodies.has(body), `${s.id} body ${body}`).toBe(true);
        usedBodies.add(body);
      }
      for (const part of s.visual.parts) {
        expect(parts.has(part), `${s.id} part ${part}`).toBe(true);
        usedParts.add(part);
      }
    }
    expect(BOSS_BODIES.map((b) => b.id).filter((id) => !usedBodies.has(id))).toEqual([]);
    expect(BOSS_PARTS.map((p) => p.id).filter((id) => !usedParts.has(id))).toEqual([]);
    expect(BOSS_BODIES.map((b) => b.id).sort()).toEqual(
      ['cardigan', 'dad-belly', 'kart', 'rake-head', 'upright'].sort(),
    );
  });

  it('puts the two-tone toe on the three tine parts only', () => {
    expect(BOSS_PARTS.filter((p) => p.accent).map((p) => p.id)).toEqual([
      'rake-tines-small',
      'rake-tines-mid',
      'rake-tool-tines',
    ]);
  });

  it('gives each species 2–4 known moves, the signatures using only existing effects', () => {
    const moves = new Set([...GAME_DATA.moves, ...SECRET_MOVES].map((m) => m.id));
    for (const s of BOSS_SPECIES) {
      expect(s.moves.length).toBeGreaterThanOrEqual(2);
      expect(s.moves.length).toBeLessThanOrEqual(4);
      for (const m of s.moves) expect(moves.has(m), `${s.id} ${m}`).toBe(true);
    }
    for (const m of BOSS_MOVES) expect(MoveSchema.parse(m)).toEqual(m);
    // Every signature is known by some boss line species.
    const known = new Set(BOSS_SPECIES.flatMap((s) => s.moves));
    expect(BOSS_MOVES.map((m) => m.id).filter((id) => !known.has(id))).toEqual([]);
    // The bosses' spread moves (the first `all-foes` moves in data).
    expect(BOSS_MOVES.filter((m) => m.targets === 'all-foes').map((m) => m.id)).toEqual([
      'stink-bomb',
      'lawnmower-rumble',
      'drift-spin',
      'snow-puff-flop',
    ]);
  });

  it('names nothing the roster or its moves already use', () => {
    const publicNames = new Set(
      [...GAME_DATA.species, ...GAME_DATA.moves].flatMap((r) => [r.id, r.name.toLowerCase()]),
    );
    for (const r of [...BOSS_SPECIES, ...BOSS_MOVES]) {
      expect(publicNames.has(r.id), r.id).toBe(false);
      expect(publicNames.has(r.name.toLowerCase()), r.name).toBe(false);
    }
    const ids = SECRET_SPECIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fills the visiting bag with the four boss forms, each once, on known terrain', () => {
    const terrains = new Set(GAME_DATA.terrains.map((t) => t.id));
    expect(BOSS_EVENTS.bag.map((e) => e.speciesId)).toEqual(LINES.map((line) => line[2]));
    for (const entry of BOSS_EVENTS.bag) {
      expect(entry.terrains.length).toBeGreaterThan(0);
      for (const t of entry.terrains) expect(terrains.has(t), t).toBe(true);
    }
  });

  // Plan risk 1: the client bundle check bans every secret id and name as a
  // substring, and the boss kit ships to the client. (The source-text half
  // of this guard is in tests/server-data-boundary.test.ts.)
  it('never names a boss in any public body, part, species or move', () => {
    const publicIds = [
      ...GAME_DATA.bodies,
      ...GAME_DATA.parts,
      ...GAME_DATA.species,
      ...GAME_DATA.moves,
    ].map((r) => r.id);
    expect(publicIds.filter((id) => secretWords.some((word) => id.includes(word)))).toEqual([]);
  });
});

describe('the Christmas Eve BIG squishy (#37 X3)', () => {
  const [befriendForm, bossForm] = EVE;
  const eve = BOSS_EVENTS.christmasEve;

  it('visits on Christmas Eve only, never from the weekly bag', () => {
    expect(eve?.speciesId).toBe(bossForm);
    expect(BOSS_EVENTS.bag.map((e) => e.speciesId)).not.toContain(bossForm);
    expect(BOSS_EVENTS.bag.map((e) => e.speciesId)).not.toContain(befriendForm);
  });

  it('is a frost · sleepy boss line, server-only and hidden until met', () => {
    for (const id of EVE) {
      expect(get(id)).toMatchObject({ element: 'frost', feeling: 'sleepy', line: 'boss' });
      expect(hiddenUntilSeen(get(id)), id).toBe(true);
      expect(SECRET_SPECIES).toContain(get(id));
    }
  });

  it('joins as Bundlebit, which can grow into Snowbundle at 50 (owner question)', () => {
    expect(BOSS_EVOLUTIONS.filter((e) => EVE.includes(e.from as (typeof EVE)[number]))).toEqual([
      { from: befriendForm, into: bossForm, level: 50 },
    ]);
    expect(baseFormOf(bossForm, steps)).toBe(befriendForm);
    expect(baseFormOf(befriendForm, steps)).toBe(befriendForm);
  });

  it('never wears the shimmer (#866): legendary, iridescent, by the art rules', () => {
    for (const id of EVE) {
      expect(get(id).rarity, id).toBe('legendary');
      expect(get(id).visual.finish, id).toBe(ART_RULES.finishByRarity.legendary);
      expect(get(id).visual.finish, id).not.toBe('shimmer');
    }
  });

  it('lights only its star (or bead): one accent part, and that part glows', () => {
    for (const id of EVE) {
      const { visual } = get(id);
      expect(visual.glow, id).toBe('accent');
      const accents = visual.parts.filter((p) => registry.parts.get(p)?.color === 'accent');
      expect(accents, id).toHaveLength(1);
    }
    // The cranberry cap (Bundlebit) and cap band (Snowbundle) are the detail colour: never lit.
    expect(get(befriendForm).visual.parts).toContain('acorn-cup');
    expect(get(bossForm).visual.parts).toContain('fringe');
    for (const part of ['acorn-cup', 'fringe']) {
      expect(registry.parts.get(part)?.color, part).toBe('detail');
    }
  });

  it('reads apart from Papa Brrr by shape, accent and finish (the ice-blue body hue is shared)', () => {
    const brrr = get('papa-brrr').visual;
    const snow = get(bossForm).visual;
    // The two tiers: a wide, low base with a round head sat on it (the brief's gumdrop on a pillow).
    expect(snow.body).toBe('mochi');
    expect(snow.head?.body).toBe('orb');
    expect(snow.body).not.toBe(brrr.body);
    // None of the dad's signature parts.
    for (const part of ['moustache', 'ball-cap', 'cap-brim', 'sneakers', 'dad-arms']) {
      expect(snow.parts, part).not.toContain(part);
    }
    // A gold accent (the lit star) where his is red; the cranberry is the detail colour.
    expect(snow.palette[2]).toBe('#ffd25a');
    expect(brrr.palette[2]).toBe('#e2574c');
    expect(snow.palette[3]).toBe('#d9485a');
    expect(snow.finish).toBe('iridescent');
    expect(brrr.finish).toBe('shimmer');
  });

  it('is the bigger one, inside the evolution scale', () => {
    const { min, max } = ART_RULES.evolutionScale;
    const ratio = (get(bossForm).visual.size ?? 1) / (get(befriendForm).visual.size ?? 1);
    expect(ratio).toBeGreaterThanOrEqual(min);
    expect(ratio).toBeLessThanOrEqual(max);
  });

  it('keeps its stats in the bands: the befriend form a base, the boss form tuned at the Eve floor', () => {
    expect(total(befriendForm)).toBeGreaterThanOrEqual(260);
    expect(total(befriendForm)).toBeLessThanOrEqual(290);
    // Tuned at the Eve floor (level 10), so under the weekly bosses' 340–440.
    expect(total(bossForm)).toBeGreaterThanOrEqual(290);
    expect(total(bossForm)).toBeLessThanOrEqual(440);
    // Every stat grows from the befriend form, like a boss line's steps.
    for (const stat of ['hp', 'attack', 'defense', 'speed'] as const) {
      expect(get(bossForm).baseStats[stat], stat).toBeGreaterThan(
        get(befriendForm).baseStats[stat],
      );
    }
  });

  it('signs off with Big Chilly Sneeze: frost + windup, a pair no other boss uses', () => {
    const sneeze = BOSS_MOVES.find((m) => m.id === 'big-chilly-sneeze');
    expect(sneeze).toMatchObject({ element: 'frost', effects: [{ type: 'windup' }] });
    expect(get(bossForm).moves).toContain('big-chilly-sneeze');
    const others = BOSS_MOVES.filter(
      (m) => m.id !== 'big-chilly-sneeze' && m.element === 'frost',
    ).flatMap((m) => (m.effects ?? []).map((e) => e.type));
    expect(others).not.toContain('windup');
  });
});
