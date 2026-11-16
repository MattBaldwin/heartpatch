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
    expect(BOSS_SPECIES.map((s) => s.id).sort()).toEqual(LINES.flat().slice().sort());
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
