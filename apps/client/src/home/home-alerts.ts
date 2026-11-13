import type { HouseView, JobsView } from '@heartpatch/shared';
import type { HouseApi } from '../house/house-api.js';
import { wrappedGift } from '../house/house-gift-view.js';
import { el } from '../ui/dom.js';

// The My Home tray's dots (#731): the House daily gift waiting, or a gatherer
// full and waiting to be collected. One rule for every source, pure so it's
// tested without a DOM; the gold dot itself is the trays' `[data-tray-alert]`
// (ui/trays). Everything here is what the server sent (CLAUDE.md rule 1).
// Village gifts (Old Well, Bakery) stay with the village's own entry.

export const HOME_ALERT_TEXT = {
  gift: 'Gift waiting 🎁',
  full: (n: number) => (n === 1 ? 'A gatherer is full' : `${String(n)} gatherers are full`),
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
  readonly jobs: Pick<JobsView, 'squishies'> | null;
}

/** A house reply's say on the gift: wrapped (not opened yet) means one waits. */
export function giftWaitingIn(view: Pick<HouseView, 'gift'>): boolean {
  return wrappedGift(view) !== null;
}

/** The dots: on the Home row (the House gift) and the Jobs row (full gatherers); null for none. */
export interface HomeAlerts {
  readonly home: HomeAlert | null;
  readonly jobs: HomeAlert | null;
}

/** My gatherers that are full and stopped until someone collects. */
export function fullGatherers(jobs: Pick<JobsView, 'squishies'> | null): number {
  return jobs?.squishies.filter((s) => s.work?.full === true).length ?? 0;
}

/** A re-read waits at least this long, and its timer never runs past the cap. */
export const FULL_REREAD = { slackMs: 1_000, maxMs: 6 * 60 * 60 * 1000 } as const; // TUNE:

/**
 * How long until my first working gatherer fills up (#731c), from the
 * server's own `now`, so the Jobs dot can read the view again then (the map
 * reads it only when its gatherer counts change): the next cycle, plus one
 * cycle for each slot left after it. Null when none is filling. The re-read
 * keeps the dot what the server says; a night's pause just schedules again.
 */
export function nextFullInMs(view: Pick<JobsView, 'squishies' | 'rules' | 'now'>): number | null {
  const now = Date.parse(view.now);
  let soonest: number | null = null;
  for (const { work } of view.squishies) {
    if (!work || work.full || work.nextReadyAt === null) continue;
    const left = Math.max(1, view.rules.maxStoredCycles - work.readyCycles);
    const at = Date.parse(work.nextReadyAt) + (left - 1) * work.cycleSeconds * 1000;
    if (soonest === null || at < soonest) soonest = at;
  }
  if (soonest === null) return null;
  return Math.min(Math.max(soonest - now, 0) + FULL_REREAD.slackMs, FULL_REREAD.maxMs);
}

/** THE badge rule: which My Home rows wear a dot, and with what count. */
export function homeAlerts(sources: HomeAlertSources): HomeAlerts {
  const full = fullGatherers(sources.jobs);
  return {
    home: sources.giftWaiting === true ? { count: 1, peek: HOME_ALERT_TEXT.gift } : null,
    jobs: full > 0 ? { count: full, peek: HOME_ALERT_TEXT.full(full) } : null,
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

/** The dots' DOM: one badge per row, fed by the patch on screen's latest replies. */
export interface HomeAlertBadges {
  /** The patch the map shows now (another patch: what was said for the last one goes). */
  setMap: (mapId: string) => void;
  /** The map view's `giftWaiting` (left out by older servers: nothing changes). */
  mapView: (mapId: string, giftWaiting: boolean | undefined) => void;
  house: (mapId: string, view: Pick<HouseView, 'gift'>) => void;
  jobs: (mapId: string, view: Pick<JobsView, 'squishies'>) => void;
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
  let sources: HomeAlertSources = { giftWaiting: null, jobs: null };
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
      sources = { giftWaiting: early?.mapId === next ? early.giftWaiting : null, jobs: null };
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
    jobs: (forMap, view) => {
      if (forMap !== mapId) return;
      sources = { ...sources, jobs: view };
      redraw();
    },
    reset: () => {
      mapId = null;
      early = null;
      sources = { giftWaiting: null, jobs: null };
      redraw();
    },
    get debug() {
      return homeAlerts(sources);
    },
  };
}

export function createHomeAlertBadges(rows: {
  home: Element | null;
  jobs: Element | null;
}): HomeAlertBadges {
  const badge = (row: Element | null) => {
    const node = el('span', { class: 'home-alert-badge', 'aria-hidden': 'true' });
    row?.append(node);
    return node;
  };
  const badges = { home: badge(rows.home), jobs: badge(rows.jobs) };
  return createHomeAlertState((alerts) => {
    showAlert(badges.home, alerts.home);
    showAlert(badges.jobs, alerts.jobs);
  });
}
