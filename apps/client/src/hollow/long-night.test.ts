import { describe, expect, it } from 'vitest';
import { findAvoidedWords } from '@heartpatch/shared';
import { HOLLOW_TEXT } from './hollow-report.js';
import {
  closingWords,
  daysBetween,
  gapBattleOk,
  gapReply,
  gapState,
  latestResult,
  LONG_NIGHT_TEXT,
  localDate,
  noticeChip,
  noticeChipText,
  reportLines,
  rescueReward,
  revealCard,
  type LongNightStatus,
} from './long-night.js';

const NY = 'America/New_York';
// Saturday 2026-10-31, 7:00 PM in New York is 23:00 UTC (EDT).
const SAT_7PM = '2026-10-31T23:00:00.000Z';
const at = (iso: string) => Date.parse(iso);
const ln = (extra: Partial<LongNightStatus> = {}): LongNightStatus => ({
  weekday: 6,
  tonight: false,
  nextAt: SAT_7PM,
  gap: null,
  ...extra,
});
const ME = '00000000-0000-4000-8000-00000000000a';
const MAYA = '00000000-0000-4000-8000-00000000000b';

describe('Long Night dates (#727)', () => {
  it('reads the map-local day, not UTC', () => {
    // 1 AM UTC Sunday is still Saturday evening in New York.
    expect(localDate(at('2026-11-01T01:00:00Z'), NY)).toBe('2026-10-31');
    expect(daysBetween('2026-10-28', '2026-10-31')).toBe(3);
    // Across the DST change (Nov 1 2026 in New York) a day is still one day.
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });
});

describe('noticeChip (#727)', () => {
  const chip = (nowIso: string, extra: Partial<LongNightStatus> = {}, isNight = false) =>
    noticeChip({ ln: ln(extra), isNight, now: at(nowIso), timeZone: NY });

  it('counts the days from noticeDays out, then tonight, then minutes at dusk', () => {
    expect(chip('2026-10-27T16:00:00Z')).toBeNull(); // Tuesday: 4 days out
    expect(noticeChipText(chip('2026-10-28T16:00:00Z') ?? { kind: 'tonight' })).toBe(
      '🌑 Long Night in 3 days',
    );
    expect(noticeChipText(chip('2026-10-30T16:00:00Z') ?? { kind: 'tonight' })).toBe(
      '🌑 Long Night tomorrow',
    );
    expect(chip('2026-10-31T16:00:00Z')).toEqual({ kind: 'tonight' });
    expect(chip('2026-10-31T22:18:00Z')).toEqual({ kind: 'minutes', minutes: 42 });
  });

  it('shows nothing at night, while Off, or at 0% (nextAt null)', () => {
    expect(chip('2026-10-31T16:00:00Z', {}, true)).toBeNull();
    expect(chip('2026-10-31T16:00:00Z', { weekday: null, nextAt: null })).toBeNull();
    expect(chip('2026-10-31T16:00:00Z', { nextAt: null })).toBeNull();
    expect(noticeChip({ ln: undefined, isNight: false, now: 0, timeZone: NY })).toBeNull();
  });

  it("follows the patch's own weekday, never a fixed Saturday", () => {
    // A Wednesday Night: on Monday it's two days away.
    const wed = ln({ weekday: 3, nextAt: '2026-10-28T23:00:00.000Z' });
    expect(
      noticeChip({ ln: wed, isNight: false, now: at('2026-10-26T15:00:00Z'), timeZone: NY }),
    ).toEqual({ kind: 'days', days: 2 });
  });
});

describe('closingWords (#727)', () => {
  const closes = '2026-11-01T23:30:00.000Z'; // Sunday 6:30 PM EST, a day after the strike
  it('is "tomorrow night" at the reveal and "tonight" the next morning', () => {
    expect(closingWords(closes, at('2026-10-31T23:30:00Z'), NY)).toBe('tomorrow night');
    expect(closingWords(closes, at('2026-11-01T13:00:00Z'), NY)).toBe('tonight');
  });
});

describe('gapState (#727)', () => {
  const gap = (available: boolean) =>
    ln({
      gap: {
        night: '2026-10-31',
        opensAt: '2026-10-31T23:30:00.000Z',
        closesAt: '2026-11-01T23:30:00.000Z',
        available,
      },
    });
  it('is available, had, or none outside the window', () => {
    expect(gapState(gap(true), at('2026-11-01T10:00:00Z'))).toBe('available');
    expect(gapState(gap(false), at('2026-11-01T10:00:00Z'))).toBe('had');
    expect(gapState(gap(true), at('2026-11-02T00:00:00Z'))).toBe('none');
    expect(gapState(ln(), at('2026-11-01T10:00:00Z'))).toBe('none');
  });

  it('treats only a wild battle as the Gap battle', () => {
    expect(gapBattleOk({ kind: 'wild' })).toBe(true);
    expect(gapBattleOk({ kind: 'tile' })).toBe(false);
  });
});

describe('latestResult (727e2)', () => {
  const GAP = {
    night: '2026-10-31',
    opensAt: '2026-10-31T23:30:00.000Z',
    closesAt: '2026-11-01T23:30:00.000Z',
    available: true,
  };
  const last = (held: boolean) => ({
    night: '2026-10-31',
    held,
    heldBy: held ? [ME, MAYA] : [ME],
    keeperOfNight: held ? MAYA : null,
  });
  const live = (night: string, held: boolean) => ({
    night,
    held,
    heldBy: [],
    keeperOfNight: null,
    gapClosesAt: held ? '2026-11-01T23:30:00.000Z' : null,
  });

  it('is nothing before any Night, heard or stored', () => {
    expect(latestResult(undefined, null)).toBeNull();
    expect(latestResult(ln(), null)).toBeNull();
  });

  it("tells a Keeper who wasn't online a Night that didn't hold, as the server says", () => {
    expect(latestResult(ln({ last: last(false) }), null)).toEqual({
      ...last(false),
      gapClosesAt: null,
    });
  });

  it("takes a held Night's closing time from the open Gap", () => {
    expect(latestResult(ln({ last: last(true), gap: GAP }), null)).toEqual({
      ...last(true),
      gapClosesAt: GAP.closesAt,
    });
  });

  it('uses a Night just heard live until the status catches up, then the status', () => {
    const heard = live('2026-11-07', false);
    expect(latestResult(ln({ last: last(true) }), heard)).toBe(heard);
    expect(latestResult(ln(), heard)).toBe(heard);
    // Same Night: the status's word, with the event's closing time.
    expect(latestResult(ln({ last: last(true) }), live('2026-10-31', true))).toEqual({
      ...last(true),
      gapClosesAt: '2026-11-01T23:30:00.000Z',
    });
  });

  it('never turns a stored "didn\'t hold" into a held one from an older live result', () => {
    const result = latestResult(
      ln({ last: { ...last(false), night: '2026-11-07' } }),
      live('2026-10-31', true),
    );
    expect(result).toMatchObject({ night: '2026-11-07', held: false, gapClosesAt: null });
  });
});

describe('revealCard (#727)', () => {
  const now = at('2026-10-31T23:30:00Z');
  const open = ln({
    nextAt: '2026-11-07T23:00:00.000Z',
    gap: {
      night: '2026-10-31',
      opensAt: '2026-10-31T23:30:00.000Z',
      closesAt: '2026-11-01T23:30:00.000Z',
      available: true,
    },
  });
  const result = (held: boolean, heldBy: string[] = []) => ({
    night: '2026-10-31',
    held,
    heldBy,
    keeperOfNight: MAYA,
    gapClosesAt: held ? '2026-11-01T23:30:00.000Z' : null,
  });

  it('cheers a held Night and offers my look', () => {
    const card = revealCard({ result: result(true), me: ME, ln: open, now, timeZone: NY });
    expect(card).toMatchObject({
      title: 'The patch held! 🎉',
      line: "Juniper's Gap is open till tomorrow night.",
      goLook: true,
    });
  });

  it('never says a closed Gap is open (a stale result, days later)', () => {
    const late = at('2026-11-04T15:00:00Z');
    const card = revealCard({
      result: result(true),
      me: ME,
      ln: ln({ nextAt: '2026-11-07T23:00:00.000Z' }),
      now: late,
      timeZone: NY,
    });
    expect(card.line).toBe('');
    expect(card.goLook).toBe(false);
  });

  it('leaves Go look out once my look is had, or for a Keeper not in the Night', () => {
    const had = ln({ ...open, gap: open.gap && { ...open.gap, available: false } });
    expect(revealCard({ result: result(true), me: ME, ln: had, now, timeZone: NY }).goLook).toBe(
      false,
    );
  });

  it('words a miss softly: my land stood, or the rescue line, and the next day', () => {
    const stood = revealCard({ result: result(false, [ME]), me: ME, ln: open, now, timeZone: NY });
    expect(stood.line).toContain('Your land stood strong!');
    expect(stood.sub).toBe('Next Long Night: Saturday.');
    const reached = revealCard({
      result: result(false, [MAYA]),
      me: ME,
      ln: open,
      now,
      timeZone: NY,
    });
    expect(reached.sub).toBe(
      'Taken to the Hollow? You can rescue them! Next Long Night: Saturday.',
    );
    const off = revealCard({
      result: result(false),
      me: ME,
      ln: ln({ weekday: null, nextAt: null }),
      now,
      timeZone: NY,
    });
    expect(off.sub).toBe('Taken to the Hollow? You can rescue them!');
    expect(JSON.stringify([stood, reached, off])).not.toMatch(/fail|lost|maya/i);
  });
});

describe('reportLines (#727)', () => {
  const morning = at('2026-11-01T13:00:00Z');
  const names = (id: string) => (id === MAYA ? 'Maya' : null);
  const open = ln({
    nextAt: '2026-11-07T23:00:00.000Z',
    gap: {
      night: '2026-10-31',
      opensAt: '2026-10-31T23:30:00.000Z',
      closesAt: '2026-11-01T23:30:00.000Z',
      available: true,
    },
  });

  it('says the patch held, till tonight, and crowns me', () => {
    const lines = reportLines({
      held: true,
      keeperOfNight: ME,
      me: ME,
      nameOf: names,
      ln: open,
      now: morning,
      timeZone: NY,
    });
    expect(lines.map((l) => l.text)).toEqual([
      "The patch held! Juniper's Gap is open till tonight.",
      LONG_NIGHT_TEXT.crownMine,
    ]);
  });

  it('after a miss: the calm line, the crown by name, and the next day', () => {
    const lines = reportLines({
      held: false,
      keeperOfNight: MAYA,
      me: ME,
      nameOf: names,
      ln: ln({ nextAt: '2026-11-07T23:00:00.000Z' }),
      now: morning,
      timeZone: NY,
    });
    expect(lines.map((l) => l.text)).toEqual([
      LONG_NIGHT_TEXT.reportMiss,
      'Maya is Keeper of the Night 🔥',
      'Try again next Saturday!',
    ]);
  });

  it('leaves "try again" out while Off', () => {
    const lines = reportLines({
      held: false,
      keeperOfNight: null,
      me: ME,
      nameOf: names,
      ln: ln({ weekday: null, nextAt: null }),
      now: morning,
      timeZone: NY,
    });
    expect(lines).toHaveLength(1);
  });
});

describe('gapReply (#727)', () => {
  it("opens the Gap's wild battle, or asks to finish another battle first", () => {
    expect(gapReply({ battle: { kind: 'wild' } })).toEqual({ kind: 'battle' });
    expect(gapReply({ battle: { kind: 'tile' } })).toMatchObject({
      kind: 'message',
      title: 'One battle at a time',
      line: 'Finish your other battle first, then come back to the Gap!',
    });
  });

  it("shows the server's words for closed, claimed and not a Keeper, and hides when off", () => {
    const claimed = 'You already went through Juniper’s Gap this week. See you next Long Night!';
    expect(gapReply({ code: 'CONFLICT', message: claimed })).toEqual({
      kind: 'message',
      title: "Juniper's Gap",
      line: claimed,
    });
    expect(gapReply({ code: 'FORBIDDEN', message: 'For Keepers…' })).toMatchObject({
      line: 'For Keepers…',
    });
    expect(gapReply({ code: 'NOT_FOUND', message: 'Not here' })).toEqual({ kind: 'hide' });
  });
});

describe('the Long Night words (#727)', () => {
  it('counts rescue rewards left, one or many', () => {
    expect(LONG_NIGHT_TEXT.rewardsLeft(1)).toBe('1 rescue reward left today.');
    expect(LONG_NIGHT_TEXT.rewardsLeft(2)).toBe('2 rescue rewards left today.');
  });

  it("words the rescue list's reward from the server's count, boosted only while one is left", () => {
    const rescue = (left: number) => ({ rewardsLeftToday: left, heartdust: 1 });
    expect(rescueReward(rescue(2), true)).toEqual({
      boost: true,
      line: '2 rescue rewards left today.',
    });
    expect(rescueReward(rescue(1), false)).toEqual({ boost: false, line: HOLLOW_TEXT.reward(1) });
    // No "more rescues earn rewards" over "No more Heartdust today".
    expect(rescueReward(rescue(0), true)).toEqual({ boost: false, line: HOLLOW_TEXT.noReward });
    expect(rescueReward(rescue(0), false)).toEqual({ boost: false, line: HOLLOW_TEXT.noReward });
  });

  it('keep to the style guide (no avoided words)', () => {
    const words = Object.values(LONG_NIGHT_TEXT).map((v) =>
      typeof v === 'function' ? (v as (a: never) => string)('Maya' as never) : v,
    );
    expect(findAvoidedWords(words.join(' '))).toEqual([]);
  });
});
