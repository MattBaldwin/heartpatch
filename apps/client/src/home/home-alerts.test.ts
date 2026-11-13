import type { JobsView } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { sampleHouse, withGift } from '../house/house-fixtures.js';
import {
  createHomeAlertState,
  fullGatherers,
  giftWaitingIn,
  FULL_REREAD,
  nextFullInMs,
  HOME_ALERT_TEXT,
  homeAlerts,
  type HomeAlerts,
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
    expect(homeAlerts({ giftWaiting: null, jobs: null })).toEqual({ home: null, jobs: null });
  });

  it('dots the Home row while a House gift waits', () => {
    expect(homeAlerts({ giftWaiting: true, jobs: null }).home).toEqual({
      count: 1,
      peek: HOME_ALERT_TEXT.gift,
    });
    expect(homeAlerts({ giftWaiting: false, jobs: null }).home).toBeNull();
  });

  it("reads a house reply's gift: waiting while wrapped, not once opened or with none", () => {
    expect(giftWaitingIn(wrapped)).toBe(true);
    expect(giftWaitingIn(opened)).toBe(false);
    expect(giftWaitingIn({ gift: null })).toBe(false);
  });

  it('dots the Jobs row with how many gatherers are full', () => {
    expect(homeAlerts({ giftWaiting: null, jobs: jobs(true, false, null) }).jobs).toEqual({
      count: 1,
      peek: 'A gatherer is full',
    });
    expect(homeAlerts({ giftWaiting: null, jobs: jobs(true, true) }).jobs).toEqual({
      count: 2,
      peek: '2 gatherers are full',
    });
  });

  it('keeps the Jobs row quiet while every gatherer is still working', () => {
    expect(homeAlerts({ giftWaiting: true, jobs: jobs(false, null) }).jobs).toBeNull();
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
      seen.push([mapId, giftWaitingIn(view)]);
    });
    await expect(api.get('map-1')).resolves.toBe(wrapped);
    await expect(api.claimGift('map-1', '2026-10-31', 'k')).resolves.toBe(opened);
    expect(seen).toEqual([
      ['map-1', true],
      ['map-1', false],
    ]);
  });
});

describe('createHomeAlertState', () => {
  const tracked = () => {
    const drawn: HomeAlerts[] = [];
    const state = createHomeAlertState((alerts) => drawn.push(alerts));
    const home = () => drawn.at(-1)?.home !== null;
    return { state, drawn, home };
  };

  it("lights the Home dot from the map view's giftWaiting, before the house is opened", () => {
    const { state, home } = tracked();
    state.setMap('map-1');
    expect(home()).toBe(false);
    state.mapView('map-1', true);
    expect(home()).toBe(true);
    // The house opened, then the gift claimed: its replies say what's true now.
    state.house('map-1', wrapped);
    expect(home()).toBe(true);
    state.house('map-1', opened);
    expect(home()).toBe(false);
  });

  it('keeps a view that lands before the HUD names the map, for that map only', () => {
    const { state, home } = tracked();
    state.mapView('map-1', true);
    expect(home()).toBe(false);
    state.setMap('map-1');
    expect(home()).toBe(true);
    state.mapView('map-2', true);
    state.setMap('map-3');
    expect(home()).toBe(false);
  });

  it("ignores another patch's replies, older servers' views, and forgets everything on reset", () => {
    const { state, home } = tracked();
    state.setMap('map-1');
    state.house('map-2', wrapped);
    state.mapView('map-1', undefined);
    expect(home()).toBe(false);
    state.mapView('map-1', true);
    state.jobs('map-1', jobs(true));
    expect(state.debug.jobs?.count).toBe(1);
    state.reset();
    expect(state.debug).toEqual({ home: null, jobs: null });
  });
});

describe('nextFullInMs', () => {
  const now = '2026-10-31T12:00:00.000Z';
  const at = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();
  const working = (readyCycles: number, nextIn: number | null, cycleSeconds = 600, full = false) =>
    ({
      work: { readyCycles, nextReadyAt: nextIn === null ? null : at(nextIn), cycleSeconds, full },
    }) as unknown as JobSquishy;
  const view = (...squishies: JobSquishy[]) => ({
    squishies,
    rules: { teamSize: 3, maxStoredCycles: 4 },
    now,
  });

  it('is the next cycle plus one cycle per slot left after it, from the server clock', () => {
    // 1 ready of 4: the next lands in 60 s, then two more 600 s cycles.
    expect(nextFullInMs(view(working(1, 60)))).toBe((60 + 2 * 600) * 1000 + FULL_REREAD.slackMs);
    // 3 ready: the next one fills it.
    expect(nextFullInMs(view(working(3, 60)))).toBe(60 * 1000 + FULL_REREAD.slackMs);
  });

  it('takes the soonest of my gatherers and skips full, idle and non-gatherers', () => {
    const v = view(
      working(0, 30),
      working(3, 500),
      working(4, null, 600, true),
      gatherer(null),
    );
    expect(nextFullInMs(v)).toBe(500 * 1000 + FULL_REREAD.slackMs);
    expect(nextFullInMs(view(working(4, null, 600, true), gatherer(null)))).toBeNull();
  });

  it('never schedules in the past and never waits longer than the cap', () => {
    expect(nextFullInMs(view(working(3, -10)))).toBe(FULL_REREAD.slackMs);
    expect(nextFullInMs(view(working(0, 60, 86_400)))).toBe(FULL_REREAD.maxMs);
  });
});
