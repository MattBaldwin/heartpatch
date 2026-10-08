import { describe, expect, it } from 'vitest';
import { DUSK_MINUTES } from './hollow-config.js';
import { fallPlan, isDusk, joinsTonight, liveStart, nightChips, nudgeDue } from './night-plan.js';

const day = { isNight: false, minutes: 300, darkCount: 0 };
const dusk = { isNight: false, minutes: 20, darkCount: 2 };
const night = { isNight: true, minutes: null, darkCount: 2 };

describe('the night chips (mockup screens 1–4, 7)', () => {
  it('shows my dark spots and his stage by day', () => {
    expect(nightChips(day)).toEqual(['stage']);
    expect(nightChips({ ...day, darkCount: 3 })).toEqual(['dark', 'stage']);
  });

  it('counts down at dusk, keeping his moon a tap away beside my dark spots', () => {
    expect(isDusk(dusk)).toBe(true);
    expect(nightChips(dusk)).toEqual(['night-in', 'dark', 'moon']);
    expect(nightChips({ ...dusk, darkCount: 0 })).toEqual(['night-in', 'stage']);
    // Dusk starts `DUSK_MINUTES` before nightfall, and not a minute sooner.
    expect(isDusk({ ...dusk, minutes: DUSK_MINUTES })).toBe(true);
    expect(isDusk({ ...dusk, minutes: DUSK_MINUTES + 1 })).toBe(false);
  });

  it('says "Night" and his stage once night has fallen', () => {
    expect(nightChips(night)).toEqual(['night', 'stage']);
    expect(isDusk(night)).toBe(false);
  });
});

describe('the dark-land nudge (mockup screen 1)', () => {
  it('is due at dusk with dark land, once a night per device, never on the Glade', () => {
    expect(nudgeDue(dusk, '2026-10-31', null, false)).toBe(true);
    expect(nudgeDue(dusk, '2026-10-31', '2026-10-30', false)).toBe(true);
    // Answered tonight: it's done until tomorrow's dusk.
    expect(nudgeDue(dusk, '2026-10-31', '2026-10-31', false)).toBe(false);
    expect(nudgeDue({ ...dusk, darkCount: 0 }, '2026-10-31', null, false)).toBe(false);
    expect(nudgeDue(day, '2026-10-31', null, false)).toBe(false);
    expect(nudgeDue(night, '2026-10-31', null, false)).toBe(false);
    expect(nudgeDue(dusk, '2026-10-31', null, true)).toBe(false);
  });
});

describe('a live nightfall', () => {
  it('plays live by night, his visit with no walk, and nothing by day in a real build', () => {
    expect(fallPlan({ glade: false, isNight: true, devTools: false, walks: 2 })).toBe('live');
    expect(fallPlan({ glade: false, isNight: true, devTools: false, walks: 0 })).toBe('visit');
    // A server catching up on a missed night by day: the morning report tells it.
    expect(fallPlan({ glade: false, isNight: false, devTools: false, walks: 2 })).toBe('none');
    // The dev route makes night fall any time.
    expect(fallPlan({ glade: false, isNight: false, devTools: true, walks: 2 })).toBe('live');
  });

  it('still shows the tutorial its nightfall by day, in a real build', () => {
    // The Glade's scripted "Night falls" is tapped by day: he still visits.
    expect(fallPlan({ glade: true, isNight: false, devTools: false, walks: 0 })).toBe('visit');
    expect(fallPlan({ glade: true, isNight: false, devTools: false, walks: 1 })).toBe('replay');
    expect(fallPlan({ glade: true, isNight: true, devTools: true, walks: 0 })).toBe('visit');
  });

  it("starts tonight's show at nightfall, so a late catch-up shows it over", () => {
    const nightfallAt = Date.parse('2026-10-31T23:00:00Z');
    const late = Date.parse('2026-10-31T23:40:00Z');
    expect(
      liveStart({ fallNight: '2026-10-31', fallAt: late, tonight: '2026-10-31', nightfallAt }),
    ).toBe(nightfallAt);
    // The dev route's night (tomorrow's, at noon) plays from the event.
    const noon = Date.parse('2026-10-31T16:00:00Z');
    expect(
      liveStart({ fallNight: '2026-11-01', fallAt: noon, tonight: '2026-10-31', nightfallAt }),
    ).toBe(noon);
  });
});

describe('opening the app during the prowl', () => {
  const base = {
    isNight: true,
    tonight: '2026-10-31',
    reportNight: '2026-10-31',
    walk: 4,
    now: Date.parse('2026-10-31T23:14:00Z'),
    strikeAt: Date.parse('2026-10-31T23:30:00Z'),
    watched: null,
  };

  it("joins tonight's show part way, until the strike", () => {
    expect(joinsTonight(base)).toBe(true);
    expect(joinsTonight({ ...base, now: base.strikeAt })).toBe(false);
  });

  it("doesn't join by day, without tonight's walk, or once watched or skipped here", () => {
    expect(joinsTonight({ ...base, isNight: false })).toBe(false);
    expect(joinsTonight({ ...base, reportNight: '2026-10-30' })).toBe(false);
    expect(joinsTonight({ ...base, walk: 0 })).toBe(false);
    expect(joinsTonight({ ...base, watched: '2026-10-31' })).toBe(false);
  });
});
