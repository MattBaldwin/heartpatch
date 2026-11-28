import {
  MapViewChristmasEveSchema,
  findAvoidedWords,
  type MapViewChristmasEve,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  EVE_FALL_ASKS,
  EVE_TEXT,
  cardLines,
  eveStage,
  noticeLine,
  thanksModel,
  waitingForThanks,
} from './eve-model.js';

const OPENS = '2026-12-24T16:00:00.000Z';
const bar = (over: Partial<MapViewChristmasEve> = {}): MapViewChristmasEve =>
  MapViewChristmasEveSchema.parse({
    opensAt: OPENS,
    state: 'open',
    chipped: 80,
    goal: 200,
    chippers: 3,
    warmedUp: true,
    ...over,
  });
const BATTLE = '11111111-1111-4111-8111-111111111111';
const thanks = (over: Record<string, unknown> = {}) => ({
  kind: 'fell' as const,
  items: { 'heart-charm': 6, heartdust: 10 },
  asksLeft: 2,
  battleId: BATTLE,
  ...over,
});

describe('eveStage', () => {
  it('keys off the bar, not off the entry being there', () => {
    expect(eveStage(undefined)).toBeNull();
    expect(eveStage({ opensAt: OPENS })).toBe('notice');
    expect(eveStage(bar())).toBe('open');
    expect(eveStage(bar({ state: 'fell', chipped: 200 }))).toBe('fell');
    expect(eveStage(bar({ state: 'dozed', chipped: 50 }))).toBe('dozed');
  });
});

describe('noticeLine', () => {
  it('says it is coming from three days out, tonight on the day, almost here after', () => {
    const eve = { opensAt: '2026-12-24T16:00:00' };
    expect(noticeLine(eve, new Date('2026-12-21T09:00:00'))).toBe(EVE_TEXT.noticeSoon);
    expect(noticeLine(eve, new Date('2026-12-24T09:00:00'))).toBe(EVE_TEXT.noticeToday);
    expect(noticeLine(eve, new Date('2026-12-24T16:05:00'))).toBe(EVE_TEXT.noticeHere);
  });
  it('is gone once the bar is out, and off the Eve', () => {
    expect(noticeLine(bar(), new Date('2026-12-24T17:00:00'))).toBeNull();
    expect(noticeLine(undefined, new Date())).toBeNull();
  });
});

describe('cardLines', () => {
  it('shows how many chipped in and that the lights warmed it up', () => {
    expect(cardLines(bar())).toEqual(['3 chipped in', EVE_TEXT.warmedUp]);
  });
  it('shows no count with nobody chipped, and never the head start', () => {
    const lines = cardLines(bar({ chippers: 0, chipped: 40 }));
    expect(lines).toEqual([EVE_TEXT.warmedUp]);
    expect(lines.join(' ')).not.toMatch(/\d/);
  });
  it('shows nothing before the bar, and no warm-up once it settled', () => {
    expect(cardLines({ opensAt: OPENS })).toEqual([]);
    expect(cardLines(undefined)).toEqual([]);
    expect(cardLines(bar({ state: 'fell', chipped: 200 }))).toEqual(['3 chipped in']);
  });
});

describe('thanksModel', () => {
  it('a fall has the bundle and the asks', () => {
    const model = thanksModel(thanks());
    expect(model.title).toBe(EVE_TEXT.fellTitle);
    expect(model.items).toHaveLength(2);
    expect(model.asksLeft).toBe(2);
    expect(model.nextAsk).toBe(1);
    expect(model.battleId).toBe(BATTLE);
  });
  it('the next ask is asks made + 1', () => {
    expect(thanksModel(thanks({ asksLeft: 1 })).nextAsk).toBe(2);
    expect(thanksModel(thanks({ asksLeft: 0 })).nextAsk).toBe(EVE_FALL_ASKS + 1);
  });
  it('a doze says it wandered home at dawn, with the bundle and no asks', () => {
    const model = thanksModel(thanks({ kind: 'dozed', asksLeft: 0 }));
    expect(model.line).toContain('wandered home at dawn');
    expect(model.items.length).toBeGreaterThan(0);
    expect(model.asksLeft).toBe(0);
  });
});

describe('waitingForThanks', () => {
  const fell = bar({ state: 'fell', chipped: 200 });
  it('waits only for a Keeper who chipped in, and only until the thanks lands', () => {
    expect(waitingForThanks(fell, true)).toBe(true);
    expect(waitingForThanks(fell, false)).toBe(false);
    expect(waitingForThanks(bar(), true)).toBe(false);
    expect(waitingForThanks({ ...fell, thanks: thanks() }, true)).toBe(false);
  });
});

describe('copy', () => {
  it('uses no word the style guide avoids and shows no head-start size', () => {
    for (const text of Object.values(EVE_TEXT)) {
      if (typeof text === 'string') expect(findAvoidedWords(text)).toEqual([]);
    }
    expect(JSON.stringify(EVE_TEXT)).not.toMatch(/gave/i);
  });
});
