import { describe, expect, it } from 'vitest';
import { sampleHouse, withGift } from '../house/house-fixtures.js';
import {
  createHomeAlertState,
  giftWaitingIn,
  HOME_ALERT_TEXT,
  homeAlerts,
  type HomeAlerts,
  showAlert,
  watchedHouseApi,
} from './home-alerts.js';

const wrapped = withGift(sampleHouse(1)).view;
const opened = withGift(sampleHouse(1), { claimed: true }).view;

describe('homeAlerts (#731)', () => {
  it('shows nothing before the server has said anything', () => {
    expect(homeAlerts({ giftWaiting: null })).toEqual({ home: null });
  });

  it('dots the Home row while a House gift waits', () => {
    expect(homeAlerts({ giftWaiting: true }).home).toEqual({
      count: 1,
      peek: HOME_ALERT_TEXT.gift,
    });
    expect(homeAlerts({ giftWaiting: false }).home).toBeNull();
  });

  it("reads a house reply's gift: waiting while wrapped, not once opened or with none", () => {
    expect(giftWaitingIn(wrapped)).toBe(true);
    expect(giftWaitingIn(opened)).toBe(false);
    expect(giftWaitingIn({ gift: null })).toBe(false);
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
    expect(home()).toBe(true);
    state.reset();
    expect(state.debug).toEqual({ home: null });
  });
});
