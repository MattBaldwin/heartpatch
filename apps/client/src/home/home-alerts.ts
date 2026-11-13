import type { HouseView } from '@heartpatch/shared';
import type { HouseApi } from '../house/house-api.js';
import { wrappedGift } from '../house/house-gift-view.js';
import { el } from '../ui/dom.js';

// The My Home tray's dots (#731): the House daily gift waiting, on the Home
// row. One rule for every source (a later one adds a field to the sources and
// a row to HomeAlerts), pure so it's tested without a DOM; the gold dot itself is the trays' `[data-tray-alert]`
// (ui/trays). Everything here is what the server sent (CLAUDE.md rule 1).
// Village gifts (Old Well, Bakery) stay with the village's own entry. No
// gatherer-full dot: the client settles full gatherers on map open and at
// each `nextAt`, so "full, waiting" never lasts for the player (#731c).

export const HOME_ALERT_TEXT = {
  gift: 'Gift waiting 🎁',
} as const;

/** One row's dot: how many things wait, and the line that peeks out beside the handle. */
export interface HomeAlert {
  readonly count: number;
  readonly peek: string;
}

/** What the server last said for the patch on screen (null: not read yet). */
export interface HomeAlertSources {
  /**
   * A House gift waits: the map view's `giftWaiting` (read-only, so it's
   * known before the house is opened), then each house reply's wrapped gift.
   */
  readonly giftWaiting: boolean | null;
}

/** A house reply's say on the gift: wrapped (not opened yet) means one waits. */
export function giftWaitingIn(view: Pick<HouseView, 'gift'>): boolean {
  return wrappedGift(view) !== null;
}

/** The dots: the Home row's (the House gift); null for none. */
export interface HomeAlerts {
  readonly home: HomeAlert | null;
}

/** THE badge rule: which My Home rows wear a dot, and with what count. */
export function homeAlerts(sources: HomeAlertSources): HomeAlerts {
  return {
    home: sources.giftWaiting === true ? { count: 1, peek: HOME_ALERT_TEXT.gift } : null,
  };
}

/**
 * Shows one alert on a badge node: its text is the count (the trays read it)
 * and `data-tray-alert` is the peek line; an empty badge counts for nothing.
 */
export function showAlert(badge: HTMLElement, alert: HomeAlert | null): void {
  badge.textContent = alert ? String(alert.count) : '';
  badge.dataset['trayAlert'] = alert?.peek ?? '';
  badge.hidden = alert === null;
}

/**
 * The house calls, unchanged, plus every house the server replies with (a
 * read, a build, a move, an opened gift) for `onView`: the Home dot's source,
 * with no extra request (#731c).
 */
export function watchedHouseApi(
  api: HouseApi,
  onView: (mapId: string, view: HouseView) => void,
): HouseApi {
  const seen = (mapId: string) => (view: HouseView) => {
    onView(mapId, view);
    return view;
  };
  return {
    get: (mapId) => api.get(mapId).then(seen(mapId)),
    build: (mapId, toLevel, key) => api.build(mapId, toLevel, key).then(seen(mapId)),
    moveResident: (mapId, squishyId, roomId, key) =>
      api.moveResident(mapId, squishyId, roomId, key).then(seen(mapId)),
    claimGift: (mapId, day, key) => api.claimGift(mapId, day, key).then(seen(mapId)),
  };
}

/** The dots' DOM: one badge per row (the Home row's for now), fed by the patch on screen's latest replies. */
export interface HomeAlertBadges {
  /** The patch the map shows now (another patch: what was said for the last one goes). */
  setMap: (mapId: string) => void;
  /** The map view's `giftWaiting` (left out by older servers: nothing changes). */
  mapView: (mapId: string, giftWaiting: boolean | undefined) => void;
  house: (mapId: string, view: Pick<HouseView, 'gift'>) => void;
  /** Logged out or in as someone else: nothing waits. */
  reset: () => void;
  readonly debug: HomeAlerts;
}

/**
 * The dots' state for the patch on screen, without the DOM: `draw` gets the
 * alerts each time what the server said changes (and once at the start).
 */
export function createHomeAlertState(draw: (alerts: HomeAlerts) => void): HomeAlertBadges {
  let mapId: string | null = null;
  let sources: HomeAlertSources = { giftWaiting: null };
  // A map's view can land before the HUD says it's on screen: kept for its setMap.
  let early: { mapId: string; giftWaiting: boolean } | null = null;
  const redraw = () => {
    draw(homeAlerts(sources));
  };
  redraw();
  return {
    setMap: (next) => {
      if (next === mapId) return;
      mapId = next;
      sources = { giftWaiting: early?.mapId === next ? early.giftWaiting : null };
      early = null;
      redraw();
    },
    mapView: (forMap, giftWaiting) => {
      if (giftWaiting === undefined) return;
      if (forMap !== mapId) {
        early = { mapId: forMap, giftWaiting };
        return;
      }
      sources = { ...sources, giftWaiting };
      redraw();
    },
    house: (forMap, view) => {
      if (forMap !== mapId) return;
      sources = { ...sources, giftWaiting: giftWaitingIn(view) };
      redraw();
    },
    reset: () => {
      mapId = null;
      early = null;
      sources = { giftWaiting: null };
      redraw();
    },
    get debug() {
      return homeAlerts(sources);
    },
  };
}

export function createHomeAlertBadges(rows: { home: Element | null }): HomeAlertBadges {
  const badge = (row: Element | null) => {
    const node = el('span', { class: 'home-alert-badge', 'aria-hidden': 'true' });
    row?.append(node);
    return node;
  };
  const home = badge(rows.home);
  return createHomeAlertState((alerts) => {
    showAlert(home, alerts.home);
  });
}
