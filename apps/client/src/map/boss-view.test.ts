import type { BossVisit } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  BOSS_TEXT,
  bossPatchLine,
  bossUntil,
  cardModel,
  markerModel,
  terrainWord,
} from './boss-view.js';

const visit = (over: Partial<BossVisit> = {}): BossVisit => ({
  window: { id: '2026-11-09', endsAt: '2026-11-16T00:00:00' },
  tile: { q: 1, r: -2 },
  species: null,
  state: 'here',
  triesLeftToday: 2,
  ...over,
});
const noon = (iso: string) => new Date(`${iso}T12:00:00`);

describe('bossUntil', () => {
  it('names the last day it is here', () => {
    expect(bossUntil('2026-11-16T00:00:00', noon('2026-11-14'))?.text).toBe('here until Sunday');
  });
  it('says "last day!" on that day', () => {
    expect(bossUntil('2026-11-16T00:00:00', noon('2026-11-15'))).toEqual({
      text: 'last day!',
      lastDay: true,
    });
  });
  it('is nothing once the time is up or unreadable', () => {
    expect(bossUntil('2026-11-16T00:00:00', noon('2026-11-16'))).toBeNull();
    expect(bossUntil('nope', noon('2026-11-14'))).toBeNull();
  });
});

describe('markerModel', () => {
  const now = noon('2026-11-14');
  it('is null with no boss, or when its window is over', () => {
    expect(markerModel(null, now, () => 'Rakelet')).toBeNull();
    expect(markerModel(visit(), noon('2026-11-20'), () => 'Rakelet')).toBeNull();
  });
  it('keeps the stand-in until the species is met, and never asks for a name', () => {
    const asked: string[] = [];
    const m = markerModel(visit(), now, (id) => {
      asked.push(id);
      return 'Rakelet';
    });
    expect(m).toMatchObject({ known: false, name: BOSS_TEXT.unknownName, speciesId: null });
    expect(asked).toEqual([]);
  });
  it('names it once met and the catalog knows its name', () => {
    const m = markerModel(visit({ species: 'rakelet' }), now, () => 'Rakelet');
    expect(m).toMatchObject({ known: true, name: 'Rakelet', speciesId: 'rakelet', q: 1, r: -2 });
  });
  it('falls back to the stand-in when a met species has no name here yet', () => {
    const m = markerModel(visit({ species: 'rakelet' }), now, () => null);
    expect(m?.known).toBe(false);
  });
});

describe('bossPatchLine', () => {
  it('names the species once known', () => {
    expect(bossPatchLine('Rakelet', 'lake')).toBe('A giant Rakelet is stomping about!');
  });
  it('uses the terrain otherwise, and never a species', () => {
    expect(bossPatchLine(null, 'lake')).toBe('Something BIG is stomping around the lake!');
    expect(bossPatchLine(null, 'old-forest')).toBe(
      'Something BIG is stomping around the old forest!',
    );
    expect(bossPatchLine(null, undefined)).toBe('Something BIG is stomping around the patch!');
  });
  it('has a word for unknown terrain', () => {
    expect(terrainWord('trading-post')).toBe('patch');
  });
});

describe('cardModel', () => {
  const marker = (day: string) => markerModel(visit(), noon(day), () => null)!;
  it('offers the fight with the tries chip', () => {
    expect(cardModel(visit(), marker('2026-11-14'))).toEqual({
      title: 'A BIG squishy!',
      body: 'Bring your whole team?',
      chip: '🍀 2 tries left today',
      canFight: true,
    });
    expect(cardModel(visit({ triesLeftToday: 1 }), marker('2026-11-14')).chip).toBe(
      '🍀 1 try left today',
    );
  });
  it('is kind with no tries: tomorrow, but never "Back tomorrow!" on the last day', () => {
    const none = visit({ triesLeftToday: 0 });
    expect(cardModel(none, marker('2026-11-14'))).toMatchObject({
      body: 'Back tomorrow!',
      canFight: false,
    });
    expect(cardModel(none, marker('2026-11-15')).body).toBe('See you next time!');
  });
  it('closes the fight for too-big, beaten and friend', () => {
    for (const state of ['too-big', 'beaten', 'friend'] as const) {
      expect(cardModel(visit({ state }), marker('2026-11-14')).canFight).toBe(false);
    }
  });
});
