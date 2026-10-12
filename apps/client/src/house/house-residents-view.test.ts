import { findAvoidedWords, type HouseRoomView, type ResidentAway } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { mergeRoster, type RosterRow } from '../squishies/roster/roster-view.js';
import { sampleHouse, sampleMix } from './house-fixtures.js';
import {
  castKey,
  hoursUntil,
  movedLine,
  MOVE_BACK_IN_HOURS,
  pickerFor,
  residentRooms,
  roomBeds,
  roomFor,
  roomNameOf,
} from './house-residents-view.js';
import { RESIDENT_TEXT } from './house-view.js';

const mix = sampleMix();
const NOW_MS = Date.parse(mix.view.now);
const rows = mergeRoster({ home: mix, care: mix.care, jobs: null });
const people = new Map(rows.map((r) => [r.id, r]));
const byName = (name: string) => rows.find((r) => r.name === name)!;
const snug = mix.view.rooms.find((r) => r.id === 'snug')!;
const playroom = mix.view.rooms.find((r) => r.id === 'playroom')!;

describe('the beds (plan §10.2)', () => {
  it('shows each room in order: residents with their mood or where they are, then empty beds', () => {
    const [a, b] = roomBeds(mix.view, people);
    expect(a!.title).toBe('The Snug · 2 of 2 beds');
    expect(a!.free).toBe(0);
    expect(a!.chips.map((c) => [c.kind, c.line])).toEqual([
      ['home', '🌟 Glowing'],
      ['gathering', 'Gathering\u00A0🧺'],
    ]);
    expect(a!.chips[0]!.name).toBe(people.get(snug.residents[0]!.squishyId)!.name);
    expect(b!.title).toBe('The Playroom · 1 of 2 beds');
    expect(b!.chips.map((c) => [c.kind, c.name, c.line])).toEqual([
      ['in-trade', expect.any(String), 'At the\u00A0post\u00A0📬'],
      ['empty', 'Move in', ''],
    ]);
    expect(b!.chips[1]).toMatchObject({ roomId: 'playroom', squishyId: null, person: null });
  });

  it('says where a resident is for every away kind', () => {
    const kinds: ResidentAway[] = ['gathering', 'guarding', 'training', 'hollow', 'in-trade'];
    const room: HouseRoomView = {
      ...snug,
      beds: kinds.length + 1,
      residents: kinds.map((away, i) => ({
        squishyId: `0190a000-0000-7000-8000-00000000090${String(i)}`,
        since: mix.view.now,
        away,
      })),
    };
    const [beds] = roomBeds({ rooms: [room] }, new Map());
    expect(beds!.chips.map((c) => c.line)).toEqual([
      'Gathering\u00A0🧺',
      'On watch\u00A0🛡️',
      'Training\u00A0🎯',
      'In the\u00A0Hollow',
      'At the\u00A0post\u00A0📬',
      '',
    ]);
    expect(beds!.chips.map((c) => c.kind)).toEqual([...kinds, 'empty']);
    // The detail says it in full; the short chip words keep their emoji on the word.
    expect(beds!.chips.map((c) => c.about)).toEqual([
      ...kinds.map((k) => RESIDENT_TEXT.away[k]),
      '',
    ]);
    for (const c of beds!.chips.slice(0, -1)) expect(c.line).not.toMatch(/ \S+$/u);
    // Not in the reads yet: still named, never blank.
    expect(beds!.chips[0]!.name).toBe('Your squishy');
  });

  it('a full room has no empty bed, and one tuned below its residents still shows them all', () => {
    const full = sampleHouse(1).view;
    const [beds] = roomBeds(full, new Map());
    expect(beds!.chips.every((c) => c.kind === 'home')).toBe(true);
    expect(beds!.free).toBe(0);
    const over = { ...full.rooms[0]!, beds: 1 };
    const [tight] = roomBeds({ rooms: [over] }, new Map());
    expect(tight!.chips).toHaveLength(2);
    expect(tight!.free).toBe(0);
    expect(tight!.title).toBe('The Snug · 2 of 1 bed');
  });

  it('a resident at home with no mood read yet just says it’s home', () => {
    const [beds] = roomBeds(sampleHouse(1).view, new Map());
    expect(beds!.chips[0]!.line).toBe('Home 🏠');
  });

  it('empty rooms are all “Move in”', () => {
    const [beds] = roomBeds(sampleHouse(1, false).view, new Map());
    expect(beds!.chips.map((c) => c.name)).toEqual(['Move in', 'Move in']);
    expect(beds!.title).toBe('The Snug · 0 of 2 beds');
  });
});

describe('the move-in picker (plan §10.3)', () => {
  it('lists who can come first (residents of other rooms first), then the dimmed ones with why', () => {
    const picker = pickerFor(mix.view, 'playroom', rows, NOW_MS)!;
    expect(picker.title).toBe('Who moves into the Playroom?');
    expect(picker.line).toBe('1 bed free');
    expect(picker.full).toBe(false);
    const kinds = picker.rows.map((r) => r.kind);
    // The one waiting at a trading post lives here, but the post is the reason it can't move.
    expect(kinds).toEqual(['over', 'over', 'in', 'in', 'cooldown', 'in-trade']);
    const over = picker.rows.filter((r) => r.kind === 'over');
    expect(over.every((r) => r.can && r.tag === 'Lives in the Snug')).toBe(true);
    const mochi = picker.rows.find((r) => r.row.name === 'Mochi')!;
    expect(mochi).toMatchObject({ kind: 'cooldown', can: false });
    expect(mochi.reason).toBe(`Can move back in 5\u00A0h\u00A0🏠`);
    expect(picker.rows.find((r) => r.row.name === 'Biscuit')).toMatchObject({
      kind: 'in',
      can: true,
      tag: null,
      reason: null,
    });
  });

  it('dims a squishy waiting at a post or in the Hollow, wherever it lives', () => {
    const picker = pickerFor(mix.view, 'snug', rows, NOW_MS)!;
    const post = picker.rows.find((r) => r.row.id === playroom.residents[0]!.squishyId)!;
    expect(post).toMatchObject({
      kind: 'in-trade',
      can: false,
      reason: 'Waiting at the\u00A0post\u00A0📬',
    });
    // From the job board: a squishy taken to the Hollow (not a resident).
    const biscuit = byName('Biscuit');
    const taken: RosterRow = {
      ...biscuit,
      status: { kind: 'hollowed', text: '', readyAt: null },
      away: true,
    };
    const again = pickerFor(mix.view, 'playroom', [taken], NOW_MS)!;
    expect(again.rows[0]).toMatchObject({
      kind: 'hollowed',
      can: false,
      reason: 'In the\u00A0Hollow',
    });
    // A resident the house says is in the Hollow.
    const hollowView = {
      ...mix.view,
      rooms: mix.view.rooms.map((r) =>
        r.id === 'snug'
          ? { ...r, residents: r.residents.map((x) => ({ ...x, away: 'hollow' as const })) }
          : r,
      ),
    };
    const hollow = pickerFor(hollowView, 'playroom', rows, NOW_MS)!;
    expect(hollow.rows.filter((r) => r.kind === 'hollowed')).toHaveLength(2);
  });

  it('a full room dims everyone and says so', () => {
    const picker = pickerFor(mix.view, 'snug', rows, NOW_MS)!;
    expect(picker.full).toBe(true);
    expect(picker.line).toBe('The Snug is full! Move someone out first.');
    expect(picker.rows.some((r) => r.can)).toBe(false);
    const full = picker.rows.filter((r) => r.kind === 'full');
    expect(full.length).toBeGreaterThan(0);
    expect(full.every((r) => r.reason === 'No free bed')).toBe(true);
    // Its own residents read "Lives here".
    expect(picker.rows.filter((r) => r.kind === 'here').map((r) => r.reason)).toEqual([
      'Lives here',
      'Lives here',
    ]);
  });

  it('counts the cooldown down in whole hours on the server’s clock, then lets it come', () => {
    const moveBackInAt = mix.view.cooldowns[0]!.moveBackInAt;
    expect(hoursUntil(moveBackInAt, NOW_MS)).toBe(5);
    expect(hoursUntil(moveBackInAt, NOW_MS + 4.5 * 3_600_000)).toBe(1);
    expect(hoursUntil(moveBackInAt, Date.parse(moveBackInAt))).toBeNull();
    const day = new Date(NOW_MS + MOVE_BACK_IN_HOURS * 3_600_000).toISOString();
    expect(hoursUntil(day, NOW_MS + 5)).toBe(24);
    const later = pickerFor(mix.view, 'playroom', rows, Date.parse(moveBackInAt) + 1)!;
    expect(later.rows.find((r) => r.row.name === 'Mochi')).toMatchObject({ kind: 'in', can: true });
  });

  it('has no picker for a room the house doesn’t have', () => {
    expect(pickerFor(mix.view, 'kitchen', rows, NOW_MS)).toBeNull();
  });
});

describe('residents, the rest', () => {
  it('picks the first room with a free bed for the roster’s “Move into the house”', () => {
    expect(roomFor(mix.view)).toBe('playroom');
    expect(roomFor(sampleHouse(1, false).view)).toBe('snug');
    expect(roomFor(sampleHouse(1).view)).toBe('snug'); // all full: the picker says so
    expect(roomFor({ rooms: [] })).toBeNull();
  });

  it('knows who lives where, and redraws the scene only when someone moved or came home', () => {
    const lives = residentRooms(mix.view);
    expect(lives.get(snug.residents[1]!.squishyId)).toEqual({ roomId: 'snug', away: 'gathering' });
    const key = castKey(mix.view);
    expect(castKey({ rooms: mix.view.rooms.map((r) => ({ ...r })) })).toBe(key);
    const home = mix.view.rooms.map((r) => ({
      ...r,
      residents: r.residents.map((x) => ({ ...x, away: null })),
    }));
    expect(castKey({ rooms: home })).not.toBe(key);
  });

  it('says it kindly (style guide §9), with the rooms mid-sentence', () => {
    expect(movedLine(mix.view, 'Mochi', 'snug')).toBe('Mochi moved into the Snug! 🏠');
    expect(roomNameOf('heart-hall')).toBe('the Heart Hall');
    expect(RESIDENT_TEXT.moveOutAsk('Mochi', MOVE_BACK_IN_HOURS)).toBe(
      'Move Mochi out? They can move back in after 24\u00A0h.',
    );
    const lines = [
      RESIDENT_TEXT.beds('The Snug', 1, 2),
      RESIDENT_TEXT.moveIn,
      ...Object.values(RESIDENT_TEXT.away),
      ...Object.values(RESIDENT_TEXT.awayShort),
      RESIDENT_TEXT.cantFull,
      RESIDENT_TEXT.home,
      RESIDENT_TEXT.pickerTitle('the Snug'),
      RESIDENT_TEXT.free(1),
      RESIDENT_TEXT.full('The Snug'),
      RESIDENT_TEXT.livesIn('the Snug'),
      RESIDENT_TEXT.livesHere,
      RESIDENT_TEXT.cantCooldown(5),
      RESIDENT_TEXT.noOne,
      RESIDENT_TEXT.moved('Mochi', 'the Snug'),
      RESIDENT_TEXT.moveOutAsk('Mochi', 24),
      RESIDENT_TEXT.movedOut('Mochi'),
      RESIDENT_TEXT.rosterMoveIn,
      RESIDENT_TEXT.rosterMoveOut,
      RESIDENT_TEXT.rosterLivesIn('the Snug'),
    ];
    for (const line of lines) expect(findAvoidedWords(line)).toEqual([]);
    expect(RESIDENT_TEXT.free(2)).toBe('2 beds free');
  });
});
