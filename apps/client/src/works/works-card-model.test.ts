import type { BuildingProduction, MyBuilding } from '@heartpatch/shared';
import { describe, expect, it, vi } from 'vitest';
import type { BuildingPortraits } from '../procedural/portraits.js';
import { WORKS_BUILDINGS } from './works-model.js';
import { askPortrait } from './works-card.js';
import {
  WORKS_CARD_TEXT,
  WORKS_PORTRAIT_PX,
  worksCard,
  worksChip,
  worksDescription,
  worksHere,
  worksPortraitLook,
} from './works-card-model.js';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const joined = { homestead: 'joined' as const };

const production = (over: Partial<BuildingProduction> = {}): BuildingProduction => ({
  resource: 'flour',
  perCycle: 1,
  cycleSeconds: 300,
  ready: { flour: 109 },
  cycles: 109,
  maxCycles: 288,
  full: false,
  nextReadyAt: new Date(NOW + 3 * 60_000).toISOString(),
  upkeep: 14,
  paidThrough: null,
  pausedAt: null,
  upkeepRank: null,
  delivering: false,
  eats: { greens: 2 },
  short: {},
  ...over,
});

const mill = (over: Partial<BuildingProduction> = {}) => ({
  buildingId: 'watermill',
  level: 1,
  production: production(over),
});

const data = (id: string) => {
  const b = WORKS_BUILDINGS.find((x) => x.id === id);
  if (b?.kind !== 'works') throw new Error(`no works ${id}`);
  return b;
};

describe('the works tile card (#621 W1-10c)', () => {
  it('says what a working Watermill turns into what, with its meter and next batch', () => {
    const card = worksCard(mill(), joined, NOW);
    expect(card).toMatchObject({
      state: 'running',
      stored: 109,
      max: 288,
      percent: 38,
      meter: '🌾 109 of 288',
      line: "Turns 🌿 Greens into 🌾 Flour, even while you're away!",
      next: 'Next batch in 3m',
      upkeep: '💛 14 each morning',
      collect: true,
      // The Watermill ignores the weather: the server sends no `weather`, so no chip.
      chip: null,
    });
  });

  it('asks for Greens when the server says the bag is short, with no weather chip', () => {
    const card = worksCard(mill({ short: { greens: 2 }, weather: 'same' }), joined, NOW);
    expect(card).toMatchObject({
      state: 'short',
      line: 'Out of Greens! Bring some for the Watermill 🌿',
      next: 'Each batch takes 2 🌿',
      chip: null,
    });
  });

  it('naps or pauses before it asks for anything', () => {
    const short = { short: { greens: 2 } };
    expect(worksCard(mill(short), { homestead: 'paused' }, NOW)).toMatchObject({
      state: 'napping',
      upkeep: 'Free while it sleeps',
    });
    expect(
      worksCard(mill({ ...short, pausedAt: new Date(NOW).toISOString() }), joined, NOW),
    ).toMatchObject({ state: 'paused' });
  });

  it('is full before it is running, and is null for a building with no production', () => {
    expect(worksCard(mill({ full: true }), joined, NOW)?.state).toBe('full');
    expect(worksCard({ buildingId: 'watermill', production: null }, joined, NOW)).toBeNull();
    expect(worksCard({ buildingId: 'seawall', production: production() }, joined, NOW)).toBeNull();
  });

  it('reads an older server with no `short` as having enough', () => {
    const older = production();
    delete older.short;
    expect(worksCard({ buildingId: 'watermill', production: older }, joined, NOW)?.state).toBe(
      'running',
    );
  });
});

describe('the weather chip (#621 W1-10c)', () => {
  it('names the sky that speeds a works up or slows it down, from the server’s effect', () => {
    expect(worksChip(data('fishing-pier'), 'faster')).toEqual({
      text: '🌫️ Foggy: faster today!',
      tone: 'up',
    });
    expect(worksChip(data('irrigated-field'), 'faster')?.text).toBe('🌧️ Rainy: faster today!');
    expect(worksChip(data('irrigated-field'), 'slower')).toEqual({
      text: '🌞 Dry: slower today',
      tone: 'down',
    });
    expect(worksChip(data('fishing-pier'), 'same')).toEqual({
      text: WORKS_CARD_TEXT.usual,
      tone: 'same',
    });
  });

  it('has the Rain Barrel filling under rain and waiting without it', () => {
    expect(worksChip(data('rain-barrel'), 'same')?.text).toBe('🌧️ Rainy: filling up!');
    expect(worksChip(data('rain-barrel'), 'waiting')).toEqual({
      text: 'Dry here: waiting for rain 🌧️',
      tone: 'waiting',
    });
    expect(worksChip(data('salt-pans'), undefined)).toBeNull();
  });

  it('keeps every chip short enough for one line on a small phone', () => {
    const texts = WORKS_BUILDINGS.flatMap((b) =>
      b.kind === 'works'
        ? (['faster', 'slower', 'same', 'waiting'] as const).flatMap((w) => {
            const chip = worksChip(b, w);
            return chip ? [chip.text] : [];
          })
        : [],
    );
    const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(Array.from(graphemes.segment(t)).length, t).toBeLessThanOrEqual(30);
  });
});

describe('the building’s picture (#621 W1-10c, owner decision A)', () => {
  it('asks for the building’s own portrait at its level, asleep while it naps', () => {
    const b = { buildingId: 'seawall', level: 2, production: null };
    expect(worksPortraitLook(b, joined)).toEqual({
      buildingId: 'seawall',
      level: 2,
      asleep: false,
      size: WORKS_PORTRAIT_PX,
    });
    expect(worksPortraitLook(b, { homestead: 'paused' }).asleep).toBe(true);
    expect(worksPortraitLook(mill({ pausedAt: new Date(NOW).toISOString() }), joined).asleep).toBe(
      true,
    );
    // Small and cheap: at most 96 CSS px (drawn at the capped pixel ratio).
    expect(WORKS_PORTRAIT_PX).toBeLessThanOrEqual(96);
  });

  it('is what the card asks the shared portraits for, and shows', async () => {
    const building = vi.fn<BuildingPortraits['building']>().mockResolvedValue('data:image/png;x');
    const show = vi.fn<(url: string) => void>();
    const look = worksPortraitLook(mill(), joined);
    await askPortrait({ building }, look, show);
    expect(building).toHaveBeenCalledWith({
      buildingId: 'watermill',
      level: 1,
      asleep: false,
      size: WORKS_PORTRAIT_PX,
    });
    expect(show).toHaveBeenCalledWith('data:image/png;x');
    // No engine (no picture): the soft square stays, and nothing breaks.
    building.mockResolvedValueOnce(null);
    show.mockClear();
    await askPortrait({ building }, look, show);
    await askPortrait(undefined, look, show);
    expect(show).not.toHaveBeenCalled();
  });
});

describe('which buildings get the card', () => {
  const at = (buildingId: string, q = 1, r = 0) => ({ buildingId, q, r }) as unknown as MyBuilding;

  it('finds my works, canal, shelter or vane on the tile, and nothing else', () => {
    const home = { buildings: [at('stone-quarry', 1, 0), at('seawall', 2, 0)] };
    expect(worksHere(home, { q: 1, r: 0 })).toBeUndefined();
    expect(worksHere(home, { q: 2, r: 0 })?.buildingId).toBe('seawall');
    expect(worksDescription('seawall')).toContain('wall');
  });
});
