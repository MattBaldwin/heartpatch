import type { BattleEventView, PlayerBattle } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '@heartpatch/shared';
import { applyStep, playbackSteps, shownFrom } from './battle-playback.js';
import { BattleContent, benchOf, energyPercent, nameplate, natureLine } from './battle-view.js';

/** A small battle view, with species and moves the public tables don't have. */
function battle(log: BattleEventView[], extra: Partial<PlayerBattle['view']> = {}): PlayerBattle {
  const squishy = (id: string, speciesId: string, energy: number) => ({
    id,
    speciesId,
    level: 7,
    element: 'shadow' as const,
    feeling: 'sleepy' as const,
    stats: { hp: 40, attack: 10, defense: 10, speed: 10 },
    moves: ['test-hush-hum', 'test-moon-blink'],
    energy,
    stages: { attack: 0, defense: 0, speed: 0 },
    status: null,
    joined: true,
  });
  return {
    id: '00000000-0000-7000-8000-000000000001',
    mapId: '00000000-0000-7000-8000-000000000002',
    kind: 'wild',
    status: 'active',
    mySide: 'a',
    view: {
      version: 1,
      contentHash: 'x',
      turn: 1,
      sides: {
        a: {
          controller: { type: 'player' },
          squishies: [squishy('mine', 'test-puff', 40), squishy('bench', 'test-mallow', 40)],
          active: 0,
        },
        b: {
          controller: { type: 'ai', policy: 'wild' },
          squishies: [squishy('wild-1', 'test-mallow', 40)],
          active: 0,
        },
      },
      phase: { type: 'turn' },
      log,
      ...extra,
    },
    speciesDefs: [
      {
        id: 'test-puff',
        name: 'Puff',
        description: 'A puff.',
        element: 'shadow',
        feeling: 'sleepy',
        rarity: 'secret',
        baseStats: { hp: 50, attack: 40, defense: 45, speed: 60 },
        moves: ['test-hush-hum', 'test-moon-blink'],
        evolutions: [],
        visual: { body: 'blob', palette: ['#3b3561'], parts: ['sleepy-eyes'] },
        habitatPreferences: { elements: ['shadow'], feelings: ['sleepy'] },
      },
      {
        id: 'test-mallow',
        name: 'Mallow',
        description: 'A mallow.',
        element: 'shadow',
        feeling: 'sleepy',
        rarity: 'secret',
        baseStats: { hp: 50, attack: 40, defense: 45, speed: 60 },
        moves: ['test-hush-hum', 'test-moon-blink'],
        evolutions: [],
        visual: { body: 'blob', palette: ['#3b3561'], parts: ['sleepy-eyes'] },
        habitatPreferences: { elements: ['shadow'], feelings: ['sleepy'] },
      },
    ],
    moveDefs: [
      {
        id: 'test-hush-hum',
        name: 'Hush Hum',
        description: 'A hum.',
        element: 'shadow',
        power: 40,
        accuracy: 100,
      },
      {
        id: 'test-moon-blink',
        name: 'Moon Blink',
        description: 'A blink.',
        element: 'light',
        power: 0,
        accuracy: 100,
      },
    ],
    seed: null,
    rewards: null,
    startedAt: '2026-10-02T12:00:00.000Z',
    endedAt: null,
  };
}

const at = (side: 'a' | 'b', slot = 0) => ({ turn: 1, side, slot });

describe('playbackSteps', () => {
  const log: BattleEventView[] = [
    { ...at('a'), type: 'move', move: 'test-hush-hum' },
    { ...at('b'), type: 'hit', amount: 12, energy: 28, effectiveness: 'super' },
    { ...at('b'), type: 'move', move: 'test-moon-blink' },
    { ...at('b'), type: 'stat-change', stat: 'speed', stages: 1, total: 1 },
    { ...at('b'), type: 'status-start', status: 'sleepy' },
    { ...at('a'), type: 'swap', to: 1 },
    { ...at('b'), type: 'miss', move: 'test-hush-hum' },
    { ...at('a', 1), type: 'heal', amount: 5, energy: 40 },
    { ...at('b'), type: 'status-skip', status: 'sleepy' },
    { ...at('b'), type: 'status-end', status: 'sleepy' },
    { ...at('b'), type: 'tuckered-out' },
    { ...at('a', 1), type: 'replace' },
    { turn: 1, type: 'forfeit', side: 'b' },
    { turn: 1, type: 'battle-end', winner: 'a', reason: 'tuckered-out' },
  ];
  const b = battle(log);
  const content = new BattleContent(b);

  it('names secret squishies and moves from the battle', () => {
    const steps = playbackSteps(b, content, 0);
    expect(steps.map((s) => s.text)).toEqual([
      'Puff used Hush Hum!',
      'Wild Mallow lost some energy.',
      'Wild Mallow used Moon Blink!',
      "Wild Mallow's zip went up!",
      'Wild Mallow dozed off!',
      'Puff hopped back. Come on out, Mallow!',
      'Wild Mallow missed! Oops.',
      'Mallow got some energy back!',
      'Wild Mallow is fast asleep…',
      'Wild Mallow woke up!',
      'Wild Mallow is all tuckered out!',
      'Come on out, Mallow!',
      'Wild Mallow ran off!',
      'You won! Hooray!',
    ]);
    expect(steps[1]).toMatchObject({ kind: 'hit', callout: 'Super cozy!', energy: 28 });
    expect(steps[10]).toMatchObject({ kind: 'tuckered', energy: 0 });
    expect(steps[5]).toMatchObject({ kind: 'swap', to: 1 });
    expect(steps.every((s) => s.ms > 0)).toBe(true);
  });

  it('says scooted home after running away, tuckered out otherwise', () => {
    const line = (reason: 'forfeit' | 'tuckered-out') =>
      playbackSteps(battle([{ turn: 1, type: 'battle-end', winner: 'b', reason }]), content, 0)[0]!
        .text;
    expect(line('forfeit')).toBe('You scooted home. Maybe next time!');
    expect(line('tuckered-out')).toBe('Aw, tuckered out. Next time!');
  });

  it('shows a Heart Charm: a bounce for a new friend, a wobble when it wiggles free', () => {
    const [caught, end] = playbackSteps(
      battle([
        { ...at('b'), type: 'capture', caught: true },
        { turn: 1, type: 'battle-end', winner: 'a', reason: 'captured' },
      ]),
      content,
      0,
    );
    expect(caught).toMatchObject({
      kind: 'capture',
      side: 'b',
      text: 'Heart Charm! Mallow wants to be friends!',
      squish: 'bounce',
      energy: null,
    });
    expect(end!.text).toBe('A new friend! Hooray!');
    const [missed] = playbackSteps(
      battle([{ ...at('b'), type: 'capture', caught: false }]),
      content,
      0,
    );
    expect(missed).toMatchObject({
      text: 'Heart Charm! Wild Mallow wiggled free.',
      squish: 'wobble',
    });
  });

  it('plays only what the client has not shown yet', () => {
    expect(playbackSteps(b, content, log.length - 1)).toHaveLength(1);
    expect(playbackSteps(b, content, log.length)).toEqual([]);
  });

  it('uses no avoided words (style guide §9)', () => {
    const all = battle(log, {
      phase: {
        type: 'over',
        result: { winner: 'b', reason: 'forfeit', contentHash: 'x', turns: 1, xp: [] },
      },
    });
    const texts = [
      ...playbackSteps(all, content, 0),
      ...playbackSteps(
        battle([{ turn: 1, type: 'battle-end', winner: 'b', reason: 'forfeit' }]),
        content,
        0,
      ),
      ...playbackSteps(
        battle([{ turn: 1, type: 'battle-end', winner: 'b', reason: 'tuckered-out' }]),
        content,
        0,
      ),
      ...playbackSteps(
        battle([{ turn: 1, type: 'battle-end', winner: 'draw', reason: 'turn-limit' }]),
        content,
        0,
      ),
      ...playbackSteps(battle([{ turn: 1, type: 'forfeit', side: 'a' }]), content, 0),
      ...playbackSteps(
        battle([
          { ...at('b'), type: 'capture', caught: false },
          { ...at('b'), type: 'capture', caught: true },
          { turn: 1, type: 'battle-end', winner: 'a', reason: 'captured' },
        ]),
        content,
        0,
      ),
      ...playbackSteps(
        battle([
          { ...at('b'), type: 'stat-change', stat: 'attack', stages: -1, total: -1 },
          { ...at('b'), type: 'stat-change', stat: 'defense', stages: 0, total: 4 },
        ]),
        content,
        0,
      ),
    ].flatMap((s) => [s.text, s.callout ?? '']);
    expect(texts.flatMap((t) => findAvoidedWords(t))).toEqual([]);
  });

  it('keeps bars honest: shown energy follows the log, then the view', () => {
    let shown = shownFrom(b);
    expect(shown.b.energy).toEqual([40]);
    for (const step of playbackSteps(b, content, 0)) shown = applyStep(shown, step);
    expect(shown.b.energy).toEqual([0]);
    expect(shown.a).toEqual({ active: 1, energy: [40, 40] });
  });
});

describe('view helpers', () => {
  const b = battle([]);
  const content = new BattleContent(b);

  it('reads names, bench and energy from the view', () => {
    expect(nameplate(content, b.view.sides.a.squishies[0]!)).toBe('Puff · Lv 7');
    expect(natureLine(b.view.sides.a.squishies[0]!)).toBe('Shadow · Sleepy');
    expect(benchOf(b, 'a').map((x) => x.slot)).toEqual([1]);
    expect(benchOf(b, 'b')).toEqual([]);
    expect(energyPercent({ energy: 10, stats: { hp: 40, attack: 1, defense: 1, speed: 1 } })).toBe(
      25,
    );
    expect(energyPercent({ energy: 0, stats: { hp: 40, attack: 1, defense: 1, speed: 1 } })).toBe(
      0,
    );
    expect(content.speciesName('nope')).toBe('Mystery squishy');
    expect(content.moveName('nope')).toBe('Mystery move');
  });
});
