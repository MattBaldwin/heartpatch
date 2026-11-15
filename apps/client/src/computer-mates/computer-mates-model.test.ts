import type { MapDetail, MapMember } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { legendEntries } from '../map/map-legend.js';
import { member } from '../map/test-view.js';
import {
  COMPUTER_TEXT,
  goodbyeLine,
  helloTitle,
  isComputer,
  livesHereLine,
  nameList,
  rosterDelta,
  type RosterEntry,
  switchView,
} from './computer-mates-model.js';

const NOW = Date.parse('2026-11-15T12:00:00.000Z');

const mate = (n: number, slot: number, name: string): MapMember => ({
  ...member(n, slot),
  user: { id: member(n, slot).user.id, username: name },
  computer: { personaId: name.toLowerCase() },
});

const owner = { ...member(1, 0), user: { ...member(1, 0).user, username: 'Mia' } };

function detail(
  role: MapDetail['role'],
  computerMates: MapDetail['computerMates'],
  members: MapMember[] = [owner],
): Pick<MapDetail, 'role' | 'computerMates' | 'members'> {
  return { role, members, ...(computerMates ? { computerMates } : {}) };
}

describe('isComputer', () => {
  it('is true only for a seat the server marks as a computer patch-mate', () => {
    expect(isComputer(mate(2, 1, 'Bramble'))).toBe(true);
    expect(isComputer(member(2, 1))).toBe(false);
  });
});

describe('nameList', () => {
  it('joins names the way a kid would say them', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['Bramble'])).toBe('Bramble');
    expect(nameList(['Bramble', 'Marigold'])).toBe('Bramble and Marigold');
    expect(nameList(['Bramble', 'Marigold', 'Pocket'])).toBe('Bramble, Marigold and Pocket');
  });
});

describe('switchView', () => {
  it('leaves the row out while the server keeps the switch closed here', () => {
    expect(switchView(detail('owner', undefined), NOW)).toBeNull();
    expect(switchView(detail('member', undefined), NOW)).toBeNull();
  });

  it('shows the owner an Off switch they can tap, with the honest line (the default)', () => {
    const view = switchView(detail('owner', { enabled: false, changeAt: null }), NOW);
    expect(view).toMatchObject({
      on: false,
      tappable: true,
      line: COMPUTER_TEXT.ownerLine,
      livesHere: null,
      cooldown: null,
      hint: COMPUTER_TEXT.honest,
      ownerPicks: false,
    });
  });

  it('says how many mates live here when it is on', () => {
    const members = [owner, mate(2, 1, 'Bramble'), mate(3, 2, 'Marigold'), mate(4, 3, 'Pocket')];
    const view = switchView(detail('owner', { enabled: true, changeAt: null }, members), NOW);
    expect(view?.on).toBe(true);
    expect(view?.tappable).toBe(true);
    expect(view?.livesHere).toBe(
      '3 computer friends live here. They move over when real friends join.',
    );
  });

  it('rests the switch with "Back on tomorrow" while it cools down', () => {
    const later = new Date(NOW + 3_600_000).toISOString();
    const view = switchView(detail('owner', { enabled: false, changeAt: later }), NOW);
    expect(view).toMatchObject({
      on: false,
      tappable: false,
      cooldown: COMPUTER_TEXT.cooldown,
      hint: COMPUTER_TEXT.cooldownHint,
    });
  });

  it('lets the owner tap again once the cooldown has passed', () => {
    const earlier = new Date(NOW - 1000).toISOString();
    const view = switchView(detail('owner', { enabled: false, changeAt: earlier }), NOW);
    expect(view?.tappable).toBe(true);
    expect(view?.cooldown).toBeNull();
  });

  it('shows another Keeper the state read-only, in their words', () => {
    const members = [owner, member(2, 1), mate(3, 2, 'Bramble'), mate(4, 3, 'Marigold')];
    const view = switchView(detail('member', { enabled: true, changeAt: null }, members), NOW);
    expect(view).toMatchObject({
      on: true,
      tappable: false,
      line: COMPUTER_TEXT.memberLine,
      ownerPicks: true,
      cooldown: null,
      livesHere: 'Mia has Computer friends on. Bramble and Marigold live here.',
    });
    // Never the owner's cooldown words, even while it cools down.
    const later = new Date(NOW + 3_600_000).toISOString();
    expect(
      switchView(detail('member', { enabled: false, changeAt: later }), NOW)?.cooldown,
    ).toBeNull();
  });
});

describe('livesHereLine', () => {
  it('reads right for one mate and for none yet', () => {
    expect(livesHereLine(['Pocket'], null)).toBe(
      '1 computer friend lives here. They move over when real friends join.',
    );
    expect(livesHereLine([], 'Mia')).toBe('Mia has Computer friends on.');
    expect(livesHereLine(['Pocket'], 'Mia')).toBe(
      'Mia has Computer friends on. Pocket lives here.',
    );
  });
});

describe('hello and goodbye', () => {
  it('names every mate who moved in (the approval record’s words)', () => {
    expect(helloTitle(['Bramble', 'Marigold', 'Pocket'])).toBe(
      'Bramble, Marigold and Pocket moved in next door!\u00a0🏡',
    );
    expect(COMPUTER_TEXT.helloLine).toBe("They're run by the game.");
  });

  it('badges the departing mate in words and names the real friend', () => {
    expect(goodbyeLine('Pocket', 'Lee')).toBe(
      'Pocket (Computer friend) waved goodbye so Lee could move in 👋',
    );
    expect(goodbyeLine('Pocket', null)).toBe(
      'Pocket (Computer friend) waved goodbye to make room for a new friend 👋',
    );
  });
});

describe('the legend badge', () => {
  it('marks a mate’s land row for the badge, and never a real kid’s', () => {
    const entries = legendEntries([owner, member(2, 1), mate(3, 2, 'Bramble')], null);
    expect(entries.map((e) => e.computer)).toEqual([false, false, true]);
  });
});

describe('rosterDelta', () => {
  const roster = (...rows: [string, string, boolean][]) =>
    new Map<string, RosterEntry>(rows.map(([id, name, computer]) => [id, { name, computer }]));
  const mia: [string, string, boolean] = ['u1', 'Mia', false];

  it('says hello to every mate once, even ones there when the patch opened', () => {
    const greeted = new Set<string>();
    const opened = roster(mia, ['m1', 'Bramble', true], ['m2', 'Marigold', true]);
    expect(rosterDelta(null, opened, greeted)).toEqual({
      arrivals: ['Bramble', 'Marigold'],
      departed: [],
      newKids: [],
    });
    // The next view: nothing new, so no second hello.
    expect(rosterDelta(opened, opened, greeted).arrivals).toEqual([]);
    const more = roster(
      mia,
      ['m1', 'Bramble', true],
      ['m2', 'Marigold', true],
      ['m3', 'Pocket', true],
    );
    expect(rosterDelta(opened, more, greeted).arrivals).toEqual(['Pocket']);
  });

  it('pairs a mate leaving with a real kid arriving: the goodbye', () => {
    const greeted = new Set(['m1', 'm2']);
    const before = roster(mia, ['m1', 'Bramble', true], ['m2', 'Pocket', true]);
    const after = roster(mia, ['m1', 'Bramble', true], ['u2', 'Lee', false]);
    expect(rosterDelta(before, after, greeted)).toEqual({
      arrivals: [],
      departed: ['Pocket'],
      newKids: ['Lee'],
    });
  });

  it('tells no goodbye when the owner switches mates off (no kid arrives)', () => {
    const greeted = new Set(['m1']);
    const before = roster(mia, ['m1', 'Bramble', true]);
    const delta = rosterDelta(before, roster(mia), greeted);
    expect(delta.departed).toEqual(['Bramble']);
    expect(delta.newKids).toEqual([]);
  });

  it('never counts a real kid as a mate, or the first view as anyone arriving', () => {
    const delta = rosterDelta(null, roster(mia, ['u2', 'Lee', false]), new Set());
    expect(delta).toEqual({ arrivals: [], departed: [], newKids: [] });
  });
});
