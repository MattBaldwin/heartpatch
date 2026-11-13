import type { JobsView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { sampleHouse, withGift } from '../house/house-fixtures.js';
import {
  fullGatherers,
  HOME_ALERT_TEXT,
  homeAlerts,
  showAlert,
  watchedHouseApi,
} from './home-alerts.js';

type JobSquishy = JobsView['squishies'][number];
/** Only `work.full` matters to the rule; the rest of a job row is never read. */
const gatherer = (full: boolean | null): JobSquishy =>
  ({ work: full === null ? null : { full } }) as unknown as JobSquishy;
const jobs = (...rows: (boolean | null)[]) => ({ squishies: rows.map(gatherer) });

const wrapped = withGift(sampleHouse(1)).view;
const opened = withGift(sampleHouse(1), { claimed: true }).view;

describe('homeAlerts (#731)', () => {
  it('shows nothing before the server has said anything', () => {
    expect(homeAlerts({ house: null, jobs: null })).toEqual({ home: null, jobs: null });
  });

  it('dots the Home row while the House gift is wrapped', () => {
    expect(homeAlerts({ house: wrapped, jobs: null }).home).toEqual({
      count: 1,
      peek: HOME_ALERT_TEXT.gift,
    });
  });

  it('clears the Home dot once the gift is opened, or when there is none', () => {
    expect(homeAlerts({ house: opened, jobs: null }).home).toBeNull();
    expect(homeAlerts({ house: { gift: null }, jobs: null }).home).toBeNull();
  });

  it('dots the Jobs row with how many gatherers are full', () => {
    expect(homeAlerts({ house: null, jobs: jobs(true, false, null) }).jobs).toEqual({
      count: 1,
      peek: 'A gatherer is full',
    });
    expect(homeAlerts({ house: null, jobs: jobs(true, true) }).jobs).toEqual({
      count: 2,
      peek: '2 gatherers are full',
    });
  });

  it('keeps the Jobs row quiet while every gatherer is still working', () => {
    expect(homeAlerts({ house: wrapped, jobs: jobs(false, null) }).jobs).toBeNull();
    expect(fullGatherers(jobs())).toBe(0);
  });
});

describe('showAlert', () => {
  it('writes the count the trays read, and empties the badge when there is nothing', () => {
    // No DOM in unit tests: the three fields showAlert writes are all it needs.
    const badge = { textContent: '', dataset: {}, hidden: false } as unknown as HTMLElement;
    showAlert(badge, { count: 2, peek: 'Two' });
    expect([badge.textContent, badge.dataset['trayAlert'], badge.hidden]).toEqual([
      '2',
      'Two',
      false,
    ]);
    showAlert(badge, null);
    expect([badge.textContent, badge.dataset['trayAlert'], badge.hidden]).toEqual(['', '', true]);
  });
});

describe('watchedHouseApi', () => {
  it('passes every house reply through unchanged and tells which patch it was for', async () => {
    const seen: [string, boolean][] = [];
    const inner = {
      get: () => Promise.resolve(wrapped),
      build: () => Promise.resolve(wrapped),
      moveResident: () => Promise.resolve(wrapped),
      claimGift: () => Promise.resolve(opened),
    };
    const api = watchedHouseApi(inner, (mapId, view) => {
      seen.push([mapId, homeAlerts({ house: view, jobs: null }).home !== null]);
    });
    await expect(api.get('map-1')).resolves.toBe(wrapped);
    await expect(api.claimGift('map-1', '2026-10-31', 'k')).resolves.toBe(opened);
    expect(seen).toEqual([
      ['map-1', true],
      ['map-1', false],
    ]);
  });
});
