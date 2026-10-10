import type { BattleEventView, PlayerBattle } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '@heartpatch/shared';
import { applyStep, FENCE_LINES, playbackSteps, shownFrom } from './battle-playback.js';
import { BattleContent, benchOf, energyPercent, natureLine, plateName } from './battle-view.js';

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
    boosts: { attack: 0, defense: 0 },
    shield: 0,
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
          itemsUsed: [],
        },
        b: {
          controller: { type: 'ai', policy: 'wild' },
          squishies: [squishy('wild-1', 'test-mallow', 40)],
          active: 0,
          itemsUsed: [],
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
    terrain: 'forest',
    timeOfDay: 'day',
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

  it("a live battle names the other Keeper's squishy, never as wild (#29)", () => {
    const live: PlayerBattle = {
      ...b,
      kind: 'friendly',
      live: {
        opponentUserId: '00000000-0000-7000-8000-00000000000b',
        deadlineAt: null,
        myPick: null,
        opponentPicked: false,
        covered: [],
      },
    };
    const text = playbackSteps(live, content, 2, { opponent: 'Mira' })[0]?.text;
    expect(text).toBe("Mira's Mallow used Moon Blink!");
    expect(playbackSteps(live, content, 2)[0]?.text).toBe('Their Mallow used Moon Blink!');
  });

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

  it('words a fence (#203): it creaks when hit and cracks when it falls, never "Wild"', () => {
    const fenced = battle([
      { turn: 1, type: 'hit', side: 'b', slot: 0, energy: 20, effectiveness: 'super' },
      { turn: 1, type: 'tuckered-out', side: 'b', slot: 0 },
    ] as BattleEventView[]);
    const fence = fenced.view.sides.b.squishies[0];
    if (!fence) throw new Error('no fence');
    fenced.view.sides.b.squishies[0] = {
      ...fence,
      speciesId: 'hedge',
      element: 'leaf',
      fence: 'hedge',
    };
    const steps = playbackSteps(fenced, new BattleContent(fenced), 0);
    expect(steps.map((s) => s.text)).toEqual([
      FENCE_LINES.hit('The Hedge'),
      FENCE_LINES.down('The Hedge'),
    ]);
    expect(steps[0]?.text).toBe('The Hedge creaks…');
    const end = (winner: 'a' | 'b', reason: 'forfeit' | 'turn-limit' | 'tuckered-out') => {
      const b = battle([{ turn: 6, type: 'battle-end', winner, reason }]);
      b.view.sides.b.squishies[0] = { ...fence, speciesId: 'hedge', fence: 'hedge' };
      return playbackSteps(b, new BattleContent(b), 0)[0]?.text;
    };
    expect(end('a', 'tuckered-out')).toBe(FENCE_LINES.broke);
    expect(end('b', 'turn-limit')).toBe(FENCE_LINES.held);
    expect(end('b', 'forfeit')).toBe(FENCE_LINES.stopped);
    expect(natureLine({ element: 'leaf', feeling: 'sleepy', fence: 'hedge' })).toBe('Leaf fence');
    expect(plateName(new BattleContent(fenced), { id: 'x', speciesId: 'hedge' })).toBe('Hedge');
    for (const text of steps.map((s) => s.text)) expect(findAvoidedWords(text)).toEqual([]);
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
    expect(shown.a).toMatchObject({ active: 1, energy: [40, 40] });
  });
});

describe('view helpers', () => {
  const b = battle([]);
  const content = new BattleContent(b);

  it('reads names, bench and energy from the view', () => {
    const puff = b.view.sides.a.squishies[0]!;
    expect(plateName(content, puff)).toBe('Puff');
    // A nickname the player gave shows instead of the species name (#141).
    expect(plateName(content, puff, new Map([[puff.id, 'Pickle']]))).toBe('Pickle');
    expect(natureLine(b.view.sides.a.squishies[0]!)).toBe('Shadow · Sleepy');
    expect(benchOf(b, 'a').map((x) => x.slot)).toEqual([1]);
    expect(benchOf(b, 'b')).toEqual([]);
    // A guardian that left as a new friend (#279) never comes back out.
    const [g1, g2] = [b.view.sides.b.squishies[0]!, { ...b.view.sides.b.squishies[0]!, id: 'g2' }];
    const guarded = battle([], {
      sides: {
        ...b.view.sides,
        b: { ...b.view.sides.b, squishies: [g1, { ...g2, befriended: true }], active: 0 },
      },
    });
    expect(benchOf(guarded, 'b')).toEqual([]);
    expect(energyPercent({ energy: 10, stats: { hp: 40, attack: 1, defense: 1, speed: 1 } })).toBe(
      25,
    );
    expect(energyPercent({ energy: 0, stats: { hp: 40, attack: 1, defense: 1, speed: 1 } })).toBe(
      0,
    );
    expect(content.speciesName('nope')).toBe('Mystery squishy');
    expect(content.moveName('nope')).toBe('Mystery move');
  });

  it('plays a potion: a sip line, then a shielded hit pops the shield (#214)', () => {
    const b = battle([
      { ...at('a'), type: 'item', item: 'brave-brew' },
      { ...at('b'), type: 'move', move: 'test-hush-hum' },
      {
        ...at('a'),
        type: 'hit',
        amount: 2,
        energy: 38,
        effectiveness: 'normal',
        shielded: true,
      },
    ]);
    const content = new BattleContent(b);
    const steps = playbackSteps(b, content, 0);
    expect(steps.map((s) => s.kind)).toEqual(['item', 'move', 'hit']);
    expect(steps[0]).toMatchObject({
      item: 'brave-brew',
      text: 'Puff sipped Brave Brew! Feeling bold!',
    });
    expect(steps[2]).toMatchObject({
      shielded: true,
      callout: 'Sparkle shield!',
      text: 'The sparkle shield soaked up most of it!',
    });

    let shown = shownFrom({
      ...b,
      view: { ...b.view, log: [] },
    });
    expect(shown.a.chips[0]).toEqual({ attack: false, defense: false, shield: false });
    shown = applyStep(shown, steps[0]!);
    expect(shown.a.chips[0]).toEqual({ attack: true, defense: false, shield: true });
    // The bench squishy and the other side are untouched.
    expect(shown.a.chips[1]).toEqual({ attack: false, defense: false, shield: false });
    expect(shown.b.chips[0]).toEqual({ attack: false, defense: false, shield: false });
    shown = applyStep(shown, steps[1]!);
    shown = applyStep(shown, steps[2]!);
    expect(shown.a.chips[0]).toEqual({ attack: true, defense: false, shield: false });
    for (const step of steps) expect(findAvoidedWords(step.text)).toEqual([]);
  });

  it('starts the chips from the view, so a resumed battle keeps them', () => {
    const b = battle([]);
    const mine = b.view.sides.a.squishies[0]!;
    const resumed: PlayerBattle = {
      ...b,
      view: {
        ...b.view,
        sides: {
          ...b.view.sides,
          a: {
            ...b.view.sides.a,
            squishies: [
              { ...mine, boosts: { attack: 0, defense: 40 }, shield: 75 },
              b.view.sides.a.squishies[1]!,
            ],
          },
        },
      },
    };
    expect(shownFrom(resumed).a.chips[0]).toEqual({ attack: false, defense: true, shield: true });
  });
});
