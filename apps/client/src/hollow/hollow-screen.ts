import {
  GAME_DATA,
  type HollowStatus,
  type MorningReport,
  type OwnedSquishy,
  type PlayerBattle,
  type PublicUser,
  type Species,
  type WsEventMessage,
} from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { hollowApi, type HollowApi } from './hollow-api.js';
import { VISIT_FRESH_MS } from './hollow-config.js';
import type { HollowLayer } from './hollow-layer.js';
import { changesMyFire, HOLLOW_TEXT, reportText, unseenReports } from './hollow-report.js';
import './hollow.css';

// The Hollow Man on the client (#21, design doc §14): the night look on the
// map, his visit when night falls live, the morning report on the next visit
// to a patch, and rescues from the Hollow (startable from anywhere, decision
// C). The server decides everything (CLAUDE.md rule 1); this shows what it
// says and sends taps.

export interface HollowScreenOptions {
  root: HTMLElement;
  /** Where the entry button goes (a tray over the map, ui/trays); defaults to `root`. */
  entryRoot?: HTMLElement;
  /** Where the fire hint goes (the My Heartpatch tray); defaults to `root`. */
  hintRoot?: HTMLElement;
  /** Draws the night and the Hollow Man on the map (`map-screen` layer). */
  layer: Pick<HollowLayer, 'setNight' | 'visit' | 'debug'>;
  /** A rescue battle started (or one going came back): the battle screen takes over. */
  openBattle: (battle: PlayerBattle) => void;
  api?: HollowApi;
  /** Remembers which night's report this player has seen per patch (null: nowhere). */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Device wall clock in ms (tests pass a fake). */
  now?: () => number;
  /** Dev builds: a button that makes night fall now. */
  devTools?: boolean;
  /**
   * Another morning report is on screen (#16's raid report): the Hollow's
   * card and list wait their turn, so the player sees one thing at a time.
   * Call `otherReportClosed` when it goes away.
   */
  otherReportOpen?: () => boolean;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface HollowDebug {
  readonly mapId: string;
  readonly night: boolean;
  /** My squishies in the Hollow. */
  readonly hollowed: number;
  /** Nights the report card on screen tells about (empty: none shown). */
  readonly report: readonly string[];
  readonly sheetOpen: boolean;
  readonly visiting: boolean;
  readonly visits: number;
  readonly rewardsLeftToday: number;
  /** The "light a fire" hint is showing (first-night grace). */
  readonly fireHint: boolean;
}

export interface HollowScreen {
  /** The map on screen (null: none); fetches the night and my reports. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  /** A live event on the open map (`map-screen`'s `onLiveEvent`). */
  liveEvent: (event: WsEventMessage) => void;
  /** The other morning report opened or closed (see `otherReportOpen`). */
  otherReportChanged: () => void;
  readonly debug: HollowDebug | null;
}

/** Longest wait before asking whether night fell or morning came (a phone may sleep through it). */
const MAX_NIGHT_CHECK_MS = 30 * 60_000;

const seenKey = (userId: string, mapId: string) => `heartpatch.hollow.seen.${userId}.${mapId}`;

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createHollowScreen(options: HollowScreenOptions): HollowScreen {
  const api = options.api ?? hollowApi;
  const storage = options.storage === undefined ? safeStorage() : options.storage;
  // Wall-clock time, like `event.at` (the event's database time). Not the
  // game clock: a dev override (`HP_DEV_NOW`) moves that one but not `at`.
  const now = options.now ?? (() => Date.now());

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let status: HollowStatus | null = null;
  /** Bumped by every map or user change, so a late reply can't land on another map. */
  let generation = 0;
  let working = false;
  let report: MorningReport[] = [];
  let sheetOpen = false;
  let note = '';
  /** His visit is playing: the report waits until he has faded away. */
  let visitPlaying = false;
  let nightTimer: ReturnType<typeof setTimeout> | undefined;

  const openButton = el(
    'button',
    {
      type: 'button',
      class: 'hollow-open',
      'data-testid': 'hollow-open',
      'aria-label': HOLLOW_TEXT.sheetTitle,
    },
    el('span', { class: 'hollow-open-icon', 'aria-hidden': 'true' }, '🌙'),
    el('span', { class: 'hollow-open-label' }, HOLLOW_TEXT.open),
  );
  const badge = el('span', {
    class: 'hollow-open-badge',
    'aria-hidden': 'true',
    'data-tray-alert': HOLLOW_TEXT.news,
  });
  openButton.append(badge);
  openButton.hidden = true;
  openButton.addEventListener('click', () => {
    sheetOpen = !sheetOpen;
    note = '';
    render();
  });

  // A small nudge before the Hollow Man's first visit (first-night grace,
  // owner decision 2026-10-03). It never takes taps, so it can't get in the way.
  const hint = el(
    'p',
    {
      class: 'hollow-hint',
      role: 'status',
      'data-testid': 'hollow-fire-hint',
      // A nudge on the My Heartpatch handle until the first fire is lit.
      'data-tray-alert': HOLLOW_TEXT.fireHint,
    },
    el('span', { 'aria-hidden': 'true' }, '🔥 '),
    HOLLOW_TEXT.fireHint,
  );
  hint.hidden = true;

  const reportBox = el('div', {
    class: 'hollow-card hollow-report',
    role: 'dialog',
    'aria-labelledby': 'hollow-report-title',
    'data-testid': 'hollow-report',
  });
  reportBox.hidden = true;
  const sheet = el('div', {
    class: 'hollow-card hollow-sheet',
    role: 'dialog',
    'aria-labelledby': 'hollow-sheet-title',
    'data-testid': 'hollow-sheet',
  });
  sheet.hidden = true;
  (options.entryRoot ?? options.root).append(openButton);
  (options.hintRoot ?? options.root).append(hint);
  options.root.append(reportBox, sheet);

  const speciesName = (speciesId: string): string | undefined => {
    const species: Species | undefined =
      GAME_DATA.species.find((s) => s.id === speciesId) ??
      status?.speciesDefs.find((s) => s.id === speciesId);
    return species?.name;
  };
  /**
   * A little round squishy in its own colour, greyed while it's in the
   * Hollow (design doc §14 "Hollowed squishies turn grey").
   */
  const token = (speciesId: string, greyed: boolean): HTMLElement => {
    const species =
      GAME_DATA.species.find((s) => s.id === speciesId) ??
      status?.speciesDefs.find((s) => s.id === speciesId);
    const node = el('span', {
      class: `hollow-token${greyed ? ' hollow-token-grey' : ''}`,
      'aria-hidden': 'true',
      'data-testid': greyed ? 'hollow-token-grey' : 'hollow-token',
    });
    node.style.setProperty('--squishy-color', species?.visual.palette[0] ?? '#b9a8d9');
    return node;
  };
  const nameOf = (squishy: { nickname: string | null; speciesId: string }): string =>
    squishy.nickname ?? speciesName(squishy.speciesId) ?? HOLLOW_TEXT.mystery;

  const seenNight = (): string | null => {
    if (!user || !mapId) return null;
    try {
      return storage?.getItem(seenKey(user.id, mapId)) ?? null;
    } catch {
      return null;
    }
  };
  const markSeen = (night: string): void => {
    if (!user || !mapId) return;
    try {
      storage?.setItem(seenKey(user.id, mapId), night);
    } catch {
      // Private mode or full storage: the report may show again next time.
    }
  };

  const button = (label: string, onClick: () => void, attrs: Record<string, string> = {}) => {
    const { class: more = '', ...rest } = attrs;
    const b = el(
      'button',
      { type: 'button', class: `auth-button hollow-button ${more}`.trim(), ...rest },
      label,
    );
    b.disabled = working;
    b.addEventListener('click', onClick);
    return b;
  };

  function render(): void {
    const on = mapId !== null && status !== null;
    const hollowed = status?.hollowed ?? [];
    openButton.hidden = !on || (hollowed.length === 0 && !options.devTools);
    badge.textContent = hollowed.length > 0 ? String(hollowed.length) : '';
    badge.hidden = hollowed.length === 0;

    hint.hidden = !on || status?.fireHint !== true || status.night.isNight;

    const heldBack = options.otherReportOpen?.() ?? false;
    reportBox.hidden = !on || report.length === 0 || visitPlaying || heldBack;
    if (!reportBox.hidden) {
      const { title, lines } = reportText(report, (t) => nameOf(t), status?.fireHint ?? true);
      const waiting = report.flatMap((r) => (r.taken?.inHollow ? [r.taken] : []));
      const rescueFirst = waiting[0];
      reportBox.replaceChildren(
        el('h2', { class: 'hollow-title', id: 'hollow-report-title' }, title),
        ...(report.some((r) => r.taken)
          ? [
              el(
                'div',
                { class: 'hollow-tokens' },
                ...report.flatMap((r) =>
                  r.taken ? [token(r.taken.speciesId, r.taken.inHollow)] : [],
                ),
              ),
            ]
          : []),
        ...lines.map((line) => el('p', { class: 'hollow-line' }, line)),
        el(
          'div',
          { class: 'hollow-row' },
          ...(rescueFirst
            ? [
                button(
                  HOLLOW_TEXT.rescueNamed(nameOf(rescueFirst)),
                  () => {
                    dismissReport();
                    void rescue(rescueFirst.squishyId);
                  },
                  { 'data-testid': 'hollow-report-rescue' },
                ),
              ]
            : []),
          button(HOLLOW_TEXT.ok, dismissReport, {
            class: rescueFirst ? 'auth-button-soft' : '',
            'data-testid': 'hollow-report-ok',
          }),
        ),
      );
    }

    sheet.hidden = !on || !sheetOpen || !reportBox.hidden || heldBack;
    if (!sheet.hidden && status) {
      const reward =
        status.rescue.rewardsLeftToday > 0
          ? HOLLOW_TEXT.reward(status.rescue.heartdust)
          : HOLLOW_TEXT.noReward;
      sheet.replaceChildren(
        el('h2', { class: 'hollow-title', id: 'hollow-sheet-title' }, HOLLOW_TEXT.sheetTitle),
        el(
          'p',
          { class: 'hollow-line' },
          hollowed.length > 0 ? HOLLOW_TEXT.sheetIntro : HOLLOW_TEXT.empty,
        ),
        ...(hollowed.length > 0 ? [el('p', { class: 'hollow-sub' }, reward)] : []),
        el(
          'ul',
          { class: 'hollow-list', 'data-testid': 'hollow-list' },
          ...hollowed.map((s: OwnedSquishy) =>
            el(
              'li',
              { class: 'hollow-list-row' },
              token(s.speciesId, true),
              el(
                'span',
                { class: 'hollow-list-name' },
                nameOf(s),
                // Read out by VoiceOver; the greyed token says it on screen.
                el('span', { class: 'hollow-sr' }, HOLLOW_TEXT.waiting),
              ),
              button(HOLLOW_TEXT.rescue, () => void rescue(s.id), {
                'data-squishy': s.id,
                'data-testid': 'hollow-rescue',
              }),
            ),
          ),
        ),
        el('p', { class: 'hollow-note', role: 'status', 'data-testid': 'hollow-note' }, note),
        el(
          'div',
          { class: 'hollow-row' },
          ...(options.devTools
            ? [
                button(HOLLOW_TEXT.devNightfall, () => void devNightfall(), {
                  class: 'auth-button-soft',
                  'data-testid': 'hollow-dev-nightfall',
                }),
              ]
            : []),
          button(
            HOLLOW_TEXT.back,
            () => {
              sheetOpen = false;
              render();
            },
            { class: 'auth-button-soft', 'data-testid': 'hollow-back' },
          ),
        ),
      );
    }
  }

  function dismissReport(): void {
    const newest = report[0];
    if (newest) markSeen(newest.night);
    report = [];
    render();
  }

  /** Asks again when night falls or morning comes (the map's time, from the server). */
  function scheduleNightCheck(minutes: number): void {
    clearTimeout(nightTimer);
    const at = generation;
    nightTimer = setTimeout(
      () => {
        if (at === generation) void refresh();
      },
      Math.min(minutes * 60_000, MAX_NIGHT_CHECK_MS),
    );
  }

  async function refresh(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id) return;
    try {
      const fresh = await api.status(id);
      if (at !== generation) return;
      status = fresh;
      options.layer.setNight(fresh.night.isNight);
      scheduleNightCheck(fresh.night.changesInMinutes);
      report = unseenReports(fresh.reports, seenNight());
    } catch (err) {
      if (at === generation) note = messageOf(err);
    }
    if (at === generation) render();
  }

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  async function rescue(squishyId: string): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    const stillHere = () => at === generation && mapId === id;
    working = true;
    note = '';
    render();
    try {
      const battle = await sendCommand(
        sendDeps,
        (key) => api.rescue(id, squishyId, key),
        stillHere,
      );
      if (battle && stillHere()) {
        sheetOpen = false;
        options.openBattle(battle);
      }
    } catch (err) {
      if (stillHere()) {
        note = messageOf(err);
        sheetOpen = true;
        await refresh();
      }
    } finally {
      working = false;
      if (stillHere()) render();
    }
  }

  async function devNightfall(): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    working = true;
    render();
    try {
      const fell = await api.devNightfall(id);
      note = HOLLOW_TEXT.devNight(fell.night, fell.taken);
    } catch (err) {
      note = messageOf(err);
    } finally {
      working = false;
      render();
    }
  }

  return {
    setMap: async (next) => {
      generation += 1;
      clearTimeout(nightTimer);
      mapId = next;
      status = null;
      report = [];
      sheetOpen = false;
      note = '';
      working = false;
      visitPlaying = false;
      if (!next) options.layer.setNight(false);
      render();
      await refresh();
    },

    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      generation += 1;
      clearTimeout(nightTimer);
      mapId = null;
      status = null;
      report = [];
      sheetOpen = false;
      visitPlaying = false;
      options.layer.setNight(false);
      render();
    },

    otherReportChanged: () => {
      render();
    },

    liveEvent: (event) => {
      if (event.mapId !== mapId) return;
      if (event.type === 'hollow.nightfall') {
        // Live, not a replay after reconnecting: he comes by once, and the
        // report follows when he has gone.
        const at = generation;
        if (now() - Date.parse(event.at) < VISIT_FRESH_MS) {
          visitPlaying = options.layer.visit(() => {
            if (at !== generation) return;
            visitPlaying = false;
            render();
          });
        }
        void refresh();
      } else if (event.type === 'squishy.hollowed' || event.type === 'squishy.rescued') {
        void refresh();
      } else if (user && changesMyFire(event, user.id)) {
        // My fire changed: the "light a fire" hint may be done now.
        if (status?.fireHint) void refresh();
      }
    },

    get debug() {
      if (!mapId || !status) return null;
      const layer = options.layer.debug;
      return {
        mapId,
        night: layer.night,
        hollowed: status.hollowed.length,
        report: reportBox.hidden ? [] : report.map((r) => r.night),
        sheetOpen: !sheet.hidden,
        visiting: layer.visiting,
        visits: layer.visits,
        rewardsLeftToday: status.rescue.rewardsLeftToday,
        fireHint: !hint.hidden,
      };
    },
  };
}
