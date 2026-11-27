import type { BossVisit } from '@heartpatch/shared';
import { describe, expect, it, vi } from 'vitest';
import type { TileActions } from './map-screen.js';
import type { BossStore } from './boss-store.js';
import {
  barOfView,
  bossTileInfo,
  createBossPicker,
  eveBarOf,
  exceptBossTile,
} from './boss-picker.js';

const NOW = new Date('2026-11-14T12:00:00');
const visit: BossVisit = {
  window: { id: '2026-11-13', endsAt: '2026-11-16T00:00:00' },
  tile: { q: 1, r: -2 },
  species: null,
  state: 'here',
  triesLeftToday: 2,
};
const storeOf = (v: BossVisit | null): BossStore =>
  ({ visit: v, mapId: 'm1', nameOf: () => null }) as unknown as BossStore;
const pickerOf = (v: BossVisit | null) =>
  createBossPicker({ store: storeOf(v), fight: vi.fn(), now: () => NOW });

/** Just enough of an element for the wrapper, which only empties or hands it on. */
const fakeBox = () => {
  const replaceChildren = vi.fn();
  return { box: { replaceChildren } as unknown as HTMLElement, replaceChildren };
};
const view = undefined as never;

describe('boss picker claims', () => {
  it('claims only the boss tile while the boss is out', () => {
    const picker = pickerOf(visit);
    expect(picker.claims({ q: 1, r: -2 })).toBe(true);
    expect(picker.claims({ q: 0, r: 0 })).toBe(false);
  });
  it('claims nothing with no boss, or once its time is up', () => {
    expect(pickerOf(null).claims({ q: 1, r: -2 })).toBe(false);
    const late = createBossPicker({
      store: storeOf(visit),
      fight: vi.fn(),
      now: () => new Date('2026-11-17T00:00:00'),
    });
    expect(late.claims({ q: 1, r: -2 })).toBe(false);
  });
});

describe('exceptBossTile', () => {
  const landRules = () => {
    const show = vi.fn();
    const hide = vi.fn();
    const actions: TileActions = { show, hide };
    return { actions, show, hide };
  };

  it('keeps the land rules ("Too far away!") off the boss tile: one state, never both', () => {
    const other = landRules();
    const { box, replaceChildren } = fakeBox();
    exceptBossTile(pickerOf(visit), other.actions).show(box, { q: 1, r: -2 } as never, view);
    expect(other.show).not.toHaveBeenCalled();
    expect(other.hide).toHaveBeenCalled();
    expect(replaceChildren).toHaveBeenCalledWith();
  });

  it('leaves every other tile to the land rules', () => {
    const other = landRules();
    const { box } = fakeBox();
    exceptBossTile(pickerOf(visit), other.actions).show(box, { q: 0, r: 0 } as never, view);
    expect(other.show).toHaveBeenCalledWith(box, { q: 0, r: 0 }, view);
  });

  it('is the land rules everywhere when no boss is out', () => {
    const other = landRules();
    const { box } = fakeBox();
    exceptBossTile(pickerOf(null), other.actions).show(box, { q: 1, r: -2 } as never, view);
    expect(other.show).toHaveBeenCalled();
  });

  it('passes hide on', () => {
    const other = landRules();
    exceptBossTile(pickerOf(visit), other.actions).hide();
    expect(other.hide).toHaveBeenCalled();
  });
});

describe('bossTileInfo', () => {
  const info = {
    title: 'Meadow',
    guardians: 'Guarded by 1 Joy squishy • easy',
    gatherer: 'Squishies gather 🌿 Greens here.',
  };
  it('drops the wild guards and gatherer lines on the boss tile only', () => {
    const picker = pickerOf(visit);
    expect(bossTileInfo(picker, info, { q: 1, r: -2 })).toEqual({
      title: 'Meadow',
      guardians: null,
      gatherer: null,
    });
    expect(bossTileInfo(picker, info, { q: 0, r: 0 })).toBe(info);
  });
});

describe('the Christmas Eve card bar (#37 X4)', () => {
  const viewWith = (eve: object | undefined) =>
    ({ christmas: { presentWaiting: false, eve } }) as never;

  it('reads the bar off MapView.christmas.eve once it is whole', () => {
    expect(
      barOfView(
        viewWith({ opensAt: '2026-12-24T16:00:00Z', state: 'open', chipped: 80, goal: 200 }),
      ),
    ).toEqual({ goal: 200, chipped: 80, state: 'open' });
  });
  it('has no bar before it opens (opensAt alone), off the Eve or on an older server', () => {
    expect(barOfView(viewWith({ opensAt: '2026-12-24T16:00:00Z' }))).toBeNull();
    expect(barOfView(viewWith(undefined))).toBeNull();
    expect(barOfView(undefined)).toBeNull();
  });
  it('shows the newer of the view and the live events, and nothing without a view bar', () => {
    const fromView = { goal: 200, chipped: 80, state: 'open' } as const;
    expect(eveBarOf(fromView, { goal: 200, chipped: 120, state: 'open' })?.chipped).toBe(120);
    expect(eveBarOf(fromView, { goal: 200, chipped: 40, state: 'open' })?.chipped).toBe(80);
    expect(eveBarOf(fromView, null)).toEqual(fromView);
    expect(eveBarOf(null, { goal: 200, chipped: 120, state: 'open' })).toBeNull();
  });
});
