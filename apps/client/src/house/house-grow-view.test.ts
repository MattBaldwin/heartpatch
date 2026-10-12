import {
  findAvoidedWords,
  type HouseNextLevel,
  type RequirementProgress,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { sampleHouse, withGrow } from './house-fixtures.js';
import {
  buildLabel,
  builtLine,
  confirmLine,
  costLine,
  costSentence,
  growGroups,
  growHeader,
  growNeeds,
  growState,
  inSentence,
  rowCount,
  rowFill,
} from './house-grow-view.js';
import { GROW_TEXT } from './house-view.js';

const row = (over: Partial<RequirementProgress>): RequirementProgress => ({
  id: 'litFires-0',
  kind: 'litFires',
  group: 'home',
  line: 'Light a fire 🔥',
  have: 0,
  need: 1,
  done: false,
  hint: null,
  ...over,
});

function next(over: Partial<HouseNextLevel> = {}): HouseNextLevel {
  return {
    level: 3,
    name: 'The Kitchen',
    room: { id: 'kitchen', name: 'The Kitchen', beds: 2 },
    final: false,
    requirements: [],
    cost: { timber: 60, stone: 50, glimmer: 4 },
    unlocked: true,
    affordable: true,
    ...over,
  };
}

describe('grow the house: the rows', () => {
  it('groups rows under their headings in a fixed order, only the groups the level has', () => {
    const groups = growGroups(
      next({
        requirements: [
          row({ id: 'land', kind: 'tilesTended', group: 'land', line: 'Tend 8 tiles of land' }),
          row({ id: 'fire', group: 'home' }),
          row({ id: 'seed', kind: 'heartSeedLevel', group: 'seed', line: 'Grow your Heart Seed' }),
          row({ id: 'hab', kind: 'buildingsBuilt', group: 'home', line: 'Build 2 habitats' }),
        ],
      }),
    );
    expect(groups.map((g) => g.group)).toEqual(['seed', 'home', 'land']);
    expect(groups.map((g) => `${g.icon} ${g.title}`)).toEqual([
      '🌱 Heart Seed',
      '🏡 Your home base',
      '🗺️ Your land',
    ]);
    // Data order inside a group.
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(['fire', 'hab']);
  });

  it('has a heading for every group the server can send', () => {
    const all = ['seed', 'home', 'residents', 'patch-mates', 'land', 'adventure'] as const;
    const groups = growGroups(
      next({ requirements: all.map((group) => row({ id: group, group })) }),
    );
    expect(groups.map((g) => g.icon)).toEqual(['🌱', '🏡', '💗', '💌', '🗺️', '⚔️']);
  });

  it('fills the bar from the server’s have/need, never past full', () => {
    expect(rowFill({ have: 1, need: 2 })).toBe(0.5);
    expect(rowFill({ have: 9, need: 2 })).toBe(1);
    expect(rowFill({ have: 0, need: 8 })).toBe(0);
    expect(rowCount({ have: 7, need: 8 })).toBe('7/8');
    expect(rowCount({ have: 12, need: 8 })).toBe('8/8');
  });

  it('shows a real Playroom from the server’s evaluator, with the solo invite hint on patch-mate rows', () => {
    const kitchen = withGrow(sampleHouse(2), 'not-yet').view.next!;
    const mates = growGroups(kitchen).find((g) => g.group === 'patch-mates');
    expect(mates?.rows[0]?.hint).toBe('Invite a patch-mate to grow further 💌');
    const playroom = withGrow(sampleHouse(1), 'not-yet').view.next!;
    expect(growGroups(playroom).map((g) => g.group)).toEqual(['seed', 'home', 'residents', 'land']);
  });
});

describe('grow the house: Build it! or not yet', () => {
  it('lights Build it! only when the server says unlocked and affordable', () => {
    expect(growState({ next: next(), items: {} })).toEqual({ kind: 'ready' });
    expect(buildLabel({ kind: 'ready' })).toBe('Build it!');
  });

  it('counts the unmet rows, plus one when the bag is short, and names the first unmet row', () => {
    const state = growState({
      next: next({
        unlocked: false,
        affordable: false,
        requirements: [
          row({ id: 'seed', kind: 'heartSeedLevel', group: 'seed', done: true, have: 1 }),
          row({ id: 'land', kind: 'tilesTended', group: 'land', line: 'Tend 16 tiles of land' }),
          row({
            id: 'res',
            kind: 'residentsLevel',
            group: 'residents',
            line: '2 residents at level 10+',
          }),
        ],
      }),
      items: { timber: 60, stone: 10, glimmer: 0 },
    });
    // The residents' group shows before land, so it's the first named.
    expect(state).toEqual({
      kind: 'not-yet',
      steps: 3,
      first: 'Next up: 2 residents at level 10+',
    });
    expect(buildLabel(state)).toBe('Not yet: 3 things to go!');
  });

  it('names the short item when only the bag is short', () => {
    const state = growState({
      next: next({ affordable: false, requirements: [row({ done: true, have: 1 })] }),
      items: { timber: 60, stone: 38, glimmer: 4 },
    });
    expect(state).toEqual({ kind: 'not-yet', steps: 1, first: 'Next up: Gather 12 more Stone' });
    expect(buildLabel(state)).toBe('Not yet: 1 thing to go!');
  });

  it('trusts the server’s locked over rows that all read done', () => {
    const state = growState({
      next: next({ unlocked: false, requirements: [row({ done: true, have: 1 })] }),
      items: {},
    });
    expect(state).toEqual({ kind: 'not-yet', steps: 1, first: null });
  });

  it('says the house is all grown at the top level', () => {
    const top = sampleHouse(99).view;
    expect(top.next).toBeNull();
    expect(growState(top)).toEqual({ kind: 'final' });
    expect(buildLabel({ kind: 'final' })).toBe('Your house is all grown! ✨');
  });

  it('matches the samples: not yet with the bag short, ready with everything', () => {
    const notYet = withGrow(sampleHouse(1), 'not-yet').view;
    const state = growState(notYet);
    expect(state.kind).toBe('not-yet');
    if (state.kind === 'not-yet') {
      const unmet = notYet.next!.requirements.filter((r) => !r.done).length;
      expect(state.steps).toBe(unmet + 1);
    }
    expect(growState(withGrow(sampleHouse(1), 'ready').view)).toEqual({ kind: 'ready' });
  });
});

describe('grow the house: the words', () => {
  it('heads the sheet with the levels and the new room', () => {
    expect(growHeader({ level: 2 }, next())).toBe('House 2 → 3 · The Kitchen (room for 2)');
  });

  it('lists the cost with my counts, short ones marked', () => {
    expect(costLine({ timber: 60, stone: 50, glimmer: 4 })).toBe(
      '60 Timber · 50 Stone · 4 Glimmer',
    );
    const needs = growNeeds({ items: { timber: 60, stone: 10 } }, next());
    expect(needs.map((n) => [n.id, n.have, n.ok])).toEqual([
      ['timber', 60, true],
      ['stone', 10, false],
      ['glimmer', 0, false],
    ]);
  });

  it('asks before building, with the room mid-sentence', () => {
    expect(inSentence('The Kitchen')).toBe('the Kitchen');
    expect(inSentence('Theatre')).toBe('Theatre');
    expect(confirmLine(next())).toBe('Build the Kitchen for 60 Timber, 50 Stone and 4 Glimmer?');
    expect(costSentence({ timber: 30 })).toBe('30 Timber');
    expect(costSentence({ timber: 30, stone: 20 })).toBe('30 Timber and 20 Stone');
  });

  it('says ta-da for the new room, and all grown at the top', () => {
    expect(builtLine(withGrow(sampleHouse(2), 'not-yet').view)).toBe(
      'Ta-da! The Playroom is ready. Who moves in?',
    );
    const top = sampleHouse(99).view;
    const hall = top.rooms.find((r) => r.level === top.level)!.name;
    expect(builtLine(top)).toBe(`Ta-da! ${hall} is ready. Your house is all grown! ✨`);
  });

  it('says it all kindly (style guide §9)', () => {
    const lines = [
      GROW_TEXT.open,
      GROW_TEXT.allGrown,
      GROW_TEXT.header(1, 2, 'The Playroom', 2),
      ...Object.values(GROW_TEXT.groups).map((g) => g.title),
      GROW_TEXT.youNeed,
      GROW_TEXT.buildIt,
      GROW_TEXT.notYet(2),
      GROW_TEXT.nextUp('Light a fire'),
      GROW_TEXT.gatherMore(3, 'Stone'),
      GROW_TEXT.confirm('the Kitchen', '4 Glimmer'),
      GROW_TEXT.notNow,
      GROW_TEXT.building,
      GROW_TEXT.back,
      GROW_TEXT.built('The Kitchen'),
      GROW_TEXT.builtFinal('The Heart Hall'),
      GROW_TEXT.done,
      GROW_TEXT.toDo,
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
  });
});
