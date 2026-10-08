import {
  GAME_DATA,
  GAME_EVENTS,
  HOLLOW_RULES,
  hexKey,
  type Hex,
  type HexKey,
  type HollowStage,
  type HollowStatus,
  type MorningReport,
  type OwnedSquishy,
  type PlayerBattle,
  type PublicTile,
  type PublicUser,
  type PvpMode,
  type Species,
  type WsEventMessage,
} from '@heartpatch/shared';
import { describeItems } from '../inventory/bag-view.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { hollowApi, type HollowApi } from './hollow-api.js';
import { VISIT_FRESH_MS } from './hollow-config.js';
import { fallPlan, joinsTonight, liveStart, nightChips, nudgeDue } from './night-plan.js';
import type { HollowLayer } from './hollow-layer.js';
import { changesMyNight, HOLLOW_TEXT, reportText, unseenReports } from './hollow-report.js';
import { placeOf } from './dark-land.js';
import { createNightShow, domCaption, type NightShowDebug, type ShowWalk } from './night-show.js';
import { NIGHT_TEXT, reachText, STAGE_ORDER, STAGES, stageNights } from './night-text.js';
import type { BeatKind, Narration } from './show-timeline.js';
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
  /** Where the fire hint goes (the My Home tray); defaults to `root`. */
  hintRoot?: HTMLElement;
  /** Draws the night and the Hollow Man on the map (`map-screen` layer). */
  layer: Pick<HollowLayer, 'setNight' | 'visit' | 'walk' | 'endWalks' | 'debug'>;
  /**
   * The night show on the map (#277): land drawn as its Keeper's until he
   * strikes there (`MapScreen.setHeld`), each Keeper's Heart Seed and tiles,
   * a sound per stop, and the camera's glide.
   */
  show?: {
    hold: (held: ReadonlyMap<HexKey, string>) => void;
    seedOf: (userId: string) => Hex | null;
    tileAt: (h: Hex) => PublicTile | undefined;
    cue?: (kind: BeatKind) => void;
    pan?: (h: Hex) => void;
  };
  /** My dark land on the map on screen, farthest from home first (#277, `darkTiles`). */
  darkLand?: () => readonly PublicTile[];
  /** Glides to a tile; with `panel`, taps it too (its panel builds a fire). */
  showTile?: (h: Hex, panel: boolean) => void;
  /** Names of my squishies sleeping out on these tiles tonight (guards and gatherers). */
  outInDark?: (mapId: string, tiles: readonly Hex[]) => Promise<string[]>;
  /** The map's PvP mode: a gentle patch caps him at one. */
  pvpMode?: () => PvpMode | null;
  /** The tutorial's Glade has its own nightfall: no night chips there. */
  isGlade?: (mapId: string) => boolean;
  /**
   * Something else is up over the map (a tile's panel, a tray, the care or
   * home sheet): the narrator and the nudge step back, one card at a time.
   */
  mapBusy?: () => boolean;
  /** The night's status came in (what `reclaimed` answers may have changed). */
  onStatus?: () => void;
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
   * Another card is on screen (#16's raid report, a found lore page, a
   * milestone party): the Hollow's report and list wait their turn, so the
   * player sees one thing at a time (#129). Call `otherReportChanged` when
   * it opens or goes away.
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
  /** The night show (#277). */
  readonly show: NightShowDebug;
  /** The chips over the map, as they read. */
  readonly chips: readonly string[];
  /** The dark-land nudge before nightfall is showing. */
  readonly nudge: boolean;
  /** The "he gets bolder" sheet is open. */
  readonly strength: boolean;
  /** The report card offers the replay. */
  readonly replay: boolean;
  /** My dark spots on the map now. */
  readonly darkSpots: number;
  /** Keepers he's out walking for on the map (the show's figures). */
  readonly walking: number;
}

export interface HollowScreen {
  /** The map on screen (null: none); fetches the night and my reports. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  /** A live event on the open map (`map-screen`'s `onLiveEvent`). */
  liveEvent: (event: WsEventMessage) => void;
  /** Another card opened or closed (see `otherReportOpen`). */
  otherReportChanged: () => void;
  /** The map on screen redrew (my dark land may have changed): the chips and the nudge follow. */
  viewChanged: () => void;
  /** He won this land of mine back on `night` (#277): his report tells it. */
  reclaimed: (night: string, h: Hex) => boolean;
  readonly debug: HollowDebug | null;
}

/** Longest wait before asking whether night fell or morning came (a phone may sleep through it). */
const MAX_NIGHT_CHECK_MS = 30 * 60_000;

const seenKey = (userId: string, mapId: string) => `heartpatch.hollow.seen.${userId}.${mapId}`;
/** The packed-home-fire note seen on this device (#202): its `at`. */
const packedKey = (userId: string, mapId: string) => `heartpatch.hollow.packed.${userId}.${mapId}`;
/** The last night whose show this device played to the end or skipped (#277). */
const watchedKey = (userId: string, mapId: string) => `heartpatch.hollow.show.${userId}.${mapId}`;
/** The last night whose dark-land nudge was answered on this device (#277). */
const nudgeKey = (userId: string, mapId: string) => `heartpatch.hollow.nudge.${userId}.${mapId}`;
/** The live show's prowl: he strikes this long after nightfall. */
const PROWL_MS = HOLLOW_RULES.show.prowlMinutes * 60_000;
/** How often the night's cards look whether something else is up over the map. */
const BUSY_TICK_MS = 1_000;
/** How often the chips' "Night in N min" counts down. */
const CHIP_TICK_MS = 30_000;

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
  /** Another card was holding the report back at the last render. */
  let heldBackBefore = false;
  let nightTimer: ReturnType<typeof setTimeout> | undefined;
  /** The server's clock minus this device's, at the last status. */
  let clockOffset = 0;
  /** The "he gets bolder" sheet is open. */
  let strengthOpen = false;
  /** Names out in the dark for a night (asked once a night). */
  let outNames: { night: string; names: string[] } | null = null;
  let asking = false;
  /** The morning replay is playing: the report waits and the map shows night. */
  let replaying = false;
  /** Night just fell live: its walks wait for the status to say it's night. */
  let pendingFall: { night: string; at: number; receivedAt: number; walks: ShowWalk[] } | null =
    null;
  const serverNow = () => now() + clockOffset;

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
      // A nudge on the My Home handle until the first fire is lit.
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

  // The night's chips over the map (#277, mockup screens 1–4): the time,
  // my dark spots, and how bold he is tonight (tap: the sheet).
  const chips = el('div', { class: 'night-chips', 'data-testid': 'night-chips' });
  chips.hidden = true;
  // The nudge before nightfall (mockup screen 1).
  const nudge = el('div', {
    class: 'hollow-card night-nudge',
    role: 'dialog',
    'aria-labelledby': 'night-nudge-title',
    'data-testid': 'night-nudge',
  });
  nudge.hidden = true;
  // "He gets bolder" (mockup screen 7).
  const strength = el('div', {
    class: 'hollow-card night-strength',
    role: 'dialog',
    'aria-labelledby': 'night-strength-title',
    'data-testid': 'night-strength',
  });
  strength.hidden = true;
  options.root.append(chips, nudge, strength);
  /** The narrator's card: it steps back while another Hollow card is open. */
  let caption: ReturnType<typeof domCaption> | null = null;
  const show = createNightShow({
    now,
    // My strike has landed: the Hollow's badge can count who he took.
    onBeat: () => {
      render();
    },
    caption: (onSkip) =>
      (caption = domCaption(options.root, onSkip, () =>
        (showReport()?.taken ?? []).filter((t) => t.inHollow).map((t) => token(t.speciesId, true)),
      )),
    stage: {
      walk: (keeper, beat, seed, still, done) =>
        options.layer.walk(keeper, beat, seed, still, done),
      endWalks: () => {
        options.layer.endWalks();
      },
      hold: (held) => options.show?.hold(held),
      cue: (kind) => options.show?.cue?.(kind),
      pan: (h) => options.show?.pan?.(h),
    },
  });
  /** The night the show playing is about. */
  let showNight: string | null = null;
  const showReport = (): MorningReport | undefined =>
    status?.reports.find((r) => r.night === showNight);
  // One timer for the app's life (the screen is made once, main.ts): each
  // second the cards check whether something else came up over the map,
  // and every `CHIP_TICK_MS` the "Night in N min" chip counts down.
  let ticks = 0;
  let busyBefore = false;
  setInterval(() => {
    if (!mapId || !status) return;
    ticks += 1;
    const busy = options.mapBusy?.() ?? false;
    if (busy !== busyBefore || ticks % (CHIP_TICK_MS / BUSY_TICK_MS) === 0) {
      busyBefore = busy;
      renderChips();
      renderNight();
    }
  }, BUSY_TICK_MS);

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
  /** The packed-home-fire note, while this device hasn't shown it (#202). */
  const packedNote = (): { refund: Record<string, number>; at: string } | null => {
    const packed = status?.homeFirePacked ?? null;
    if (!packed || !user || !mapId) return null;
    try {
      return storage?.getItem(packedKey(user.id, mapId)) === packed.at ? null : packed;
    } catch {
      return packed;
    }
  };
  const markPackedSeen = (): void => {
    const packed = status?.homeFirePacked ?? null;
    if (!packed || !user || !mapId) return;
    try {
      storage?.setItem(packedKey(user.id, mapId), packed.at);
    } catch {
      // Private mode or full storage: the note may show again next time.
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

  const stored = (key: (u: string, m: string) => string): string | null => {
    if (!user || !mapId) return null;
    try {
      return storage?.getItem(key(user.id, mapId)) ?? null;
    } catch {
      return null;
    }
  };
  const store = (key: (u: string, m: string) => string, night: string): void => {
    if (!user || !mapId) return;
    try {
      storage?.setItem(key(user.id, mapId), night);
    } catch {
      // Private mode or full storage: it may show again next time.
    }
  };

  /** My walk's story, read at each stop: the report for `night` once it's in. */
  const storyFor = (night: string) => (): Narration => {
    const report = status?.reports.find((r) => r.night === night);
    return {
      placeOf: (h) => placeOf(options.show?.tileAt(h)),
      isHome: (h) => (options.show?.tileAt(h)?.homeSlot ?? null) !== null,
      reclaimed: new Set((report?.reclaimed ?? []).map(hexKey)),
      taken: (report?.taken ?? []).filter((t) => t.inHollow).map((t) => nameOf(t)),
      strikes: (report?.walk ?? []).filter((p) => p.kind === 'strike').length,
    };
  };

  /** The show for `night` ended (played out or skipped): it isn't offered again. */
  const showEnded = (night: string, at: number) => (): void => {
    if (at !== generation) return;
    store(watchedKey, night);
    showNight = null;
    if (replaying) {
      replaying = false;
      options.layer.setNight(status?.night.isNight ?? false);
    }
    render();
  };

  /** Plays walks live from nightfall (`startedAt`, this device's clock). */
  const playLive = (night: string, walks: ShowWalk[], startedAt: number): boolean => {
    const played = show.play(walks, startedAt, PROWL_MS, showEnded(night, generation));
    if (played) showNight = night;
    return played;
  };

  /** My walk for `report`, to play. */
  const myWalk = (report: MorningReport, replay: boolean): ShowWalk | null => {
    if (!user) return null;
    return {
      userId: user.id,
      walk: report.walk,
      // In the replay, only land that's still wild is drawn as mine until he strikes.
      reclaimed: replay
        ? report.reclaimed.filter((h) => options.show?.tileAt(h)?.ownerUserId === null)
        : report.reclaimed,
      seed: options.show?.seedOf(user.id) ?? null,
      story: storyFor(report.night),
    };
  };

  /** The morning replay (mockup screen 5): the same show, sped up and skippable. */
  const replay = (report: MorningReport): void => {
    const walk = myWalk(report, true);
    if (!walk) return;
    replaying = true;
    options.layer.setNight(true);
    const played = show.play([walk], now(), null, showEnded(report.night, generation));
    if (played) showNight = report.night;
    else {
      replaying = false;
      options.layer.setNight(status?.night.isNight ?? false);
    }
    render();
  };

  /** A report with a walk this device hasn't watched: the newest one. */
  const replayable = (): MorningReport | undefined => {
    const newest = report.find((r) => r.walk.length > 0);
    return newest && stored(watchedKey) !== newest.night ? newest : undefined;
  };

  const dark = (): readonly PublicTile[] => (mapId ? (options.darkLand?.() ?? []) : []);
  /** Minutes until tonight's nightfall (null: it has fallen). */
  const minutesToNight = (): number | null => {
    if (!status) return null;
    const ms = Date.parse(status.tonight.nightfallAt) - serverNow();
    return ms > 0 ? Math.ceil(ms / 60_000) : null;
  };
  const glade = () => mapId !== null && (options.isGlade?.(mapId) ?? false);

  function chip(label: string, onClick: (() => void) | null, testId: string): HTMLElement {
    if (!onClick) return el('span', { class: 'night-chip', 'data-testid': testId }, label);
    const b = el(
      'button',
      { type: 'button', class: 'night-chip night-chip-tap', 'data-testid': testId },
      label,
    );
    b.addEventListener('click', onClick);
    return b;
  }

  function renderChips(): void {
    const on = mapId !== null && status !== null && !glade();
    chips.hidden = !on;
    if (!on || !status) return;
    const spots = dark();
    const first = spots[0];
    const stage: HollowStage = status.tonight.stage;
    const minutes = minutesToNight();
    const openStrength = () => {
      strengthOpen = true;
      render();
    };
    const stageChip = chip(NIGHT_TEXT.stageChip(stage), openStrength, 'night-stage-chip');
    // At dusk the row is full: he's just his moon, still a tap away (mockup screen 7, "anytime").
    const moonChip = chip(STAGES[stage].moon, openStrength, 'night-stage-chip');
    moonChip.setAttribute(
      'aria-label',
      NIGHT_TEXT.stageChip(stage).slice(STAGES[stage].moon.length + 1),
    );
    const darkChip = first
      ? chip(
          NIGHT_TEXT.darkSpots(spots.length),
          () => options.showTile?.(first, false),
          'night-dark-chip',
        )
      : null;
    const kinds = nightChips({
      isNight: status.night.isNight,
      minutes,
      darkCount: spots.length,
    });
    const row = kinds.flatMap((kind): HTMLElement[] => {
      switch (kind) {
        case 'night':
          return [chip(NIGHT_TEXT.night, null, 'night-time-chip')];
        case 'night-in':
          return [chip(NIGHT_TEXT.nightIn(minutes ?? 0), null, 'night-time-chip')];
        case 'dark':
          return darkChip ? [darkChip] : [];
        case 'stage':
          return [stageChip];
        case 'moon':
          return [moonChip];
      }
    });
    const labels = row.map((c) => c.textContent).join('|');
    if (chips.dataset['labels'] !== labels) {
      chips.dataset['labels'] = labels;
      chips.replaceChildren(...row);
    }
  }

  /** Asks once a night who of mine sleeps out on dark land, for the nudge's title. */
  function askOutInDark(night: string, spots: readonly PublicTile[]): void {
    const id = mapId;
    if (!id || asking || outNames?.night === night || !options.outInDark) return;
    const out = spots.filter((t) => t.defenders + (t.workers ?? 0) > 0);
    if (out.length === 0) {
      outNames = { night, names: [] };
      return;
    }
    asking = true;
    const at = generation;
    options
      .outInDark(id, out)
      .then((names) => {
        if (at === generation) outNames = { night, names };
      })
      .catch(() => {
        if (at === generation) outNames = { night, names: [] };
      })
      .finally(() => {
        asking = false;
        if (at === generation) render();
      });
  }

  function renderNudge(blocked: boolean): void {
    const spots = dark();
    const first = spots[0];
    const minutes = minutesToNight();
    const night = status?.tonight.night ?? null;
    const due =
      status !== null &&
      night !== null &&
      first !== undefined &&
      nudgeDue(
        { isNight: status.night.isNight, minutes, darkCount: spots.length },
        night,
        stored(nudgeKey),
        glade(),
      );
    nudge.hidden = !due || blocked;
    if (nudge.hidden) delete nudge.dataset['drawn'];
    if (!due) return;
    askOutInDark(night, spots);
    if (nudge.hidden) return;
    const title = NIGHT_TEXT.outInDark(outNames?.night === night ? outNames.names : []);
    // Only a change redraws, so a tap mid-press isn't lost to a rebuild.
    const drawn = `${title}|${String(spots.length)}|${hexKey(first)}`;
    if (nudge.dataset['drawn'] === drawn) return;
    nudge.dataset['drawn'] = drawn;
    const answer = (panel: boolean) => () => {
      store(nudgeKey, night);
      options.showTile?.(first, panel);
      render();
    };
    nudge.replaceChildren(
      el('h2', { class: 'hollow-title', id: 'night-nudge-title' }, title),
      el('p', { class: 'hollow-line' }, NIGHT_TEXT.noLight(spots.length)),
      el(
        'div',
        { class: 'hollow-row' },
        button(NIGHT_TEXT.lightFire, answer(true), { 'data-testid': 'night-nudge-light' }),
        button(NIGHT_TEXT.showMe, answer(false), {
          class: 'auth-button-soft',
          'data-testid': 'night-nudge-show',
        }),
      ),
    );
  }

  function renderStrength(blocked: boolean): void {
    strength.hidden = !strengthOpen || status === null || blocked;
    if (strength.hidden || !status) return;
    const stage = status.tonight.stage;
    const nights = stageNights();
    strength.replaceChildren(
      el('h2', { class: 'hollow-title', id: 'night-strength-title' }, NIGHT_TEXT.sheetTitle),
      el('p', { class: 'hollow-line' }, NIGHT_TEXT.sheetIntro),
      el(
        'ol',
        { class: 'night-stages', 'data-testid': 'night-stages' },
        ...STAGE_ORDER.map((s) =>
          el(
            'li',
            {
              class: `night-stage${s === stage ? ' night-stage-now' : ''}`,
              ...(s === stage ? { 'aria-current': 'true' } : {}),
            },
            el('span', { class: 'night-stage-moon', 'aria-hidden': 'true' }, STAGES[s].moon),
            el('span', { class: 'night-stage-name' }, STAGES[s].name),
            el('small', { class: 'night-stage-nights' }, nights[s]),
          ),
        ),
      ),
      el(
        'p',
        { class: 'hollow-line', 'data-testid': 'night-strength-tonight' },
        el('strong', {}, NIGHT_TEXT.tonight(stage)),
        ` ${reachText(stage, options.pvpMode?.() ?? null)} ${NIGHT_TEXT.lightAll}`,
      ),
      el(
        'div',
        { class: 'hollow-row' },
        button(
          NIGHT_TEXT.okay,
          () => {
            strengthOpen = false;
            render();
          },
          { 'data-testid': 'night-strength-ok' },
        ),
      ),
    );
  }

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
    // Tonight's taken are the live show's to tell, at 7:30 (mockup screen 4).
    const untold = new Set(
      show.strikePending ? (showReport()?.taken ?? []).map((t) => t.squishyId) : [],
    );
    const hollowed = (status?.hollowed ?? []).filter((s) => !untold.has(s.id));
    openButton.hidden = !on || (hollowed.length === 0 && !options.devTools);
    badge.textContent = hollowed.length > 0 ? String(hollowed.length) : '';
    badge.hidden = hollowed.length === 0;

    hint.hidden = !on || status?.fireHint !== true || status.night.isNight;

    const heldBack = options.otherReportOpen?.() ?? false;
    heldBackBefore = heldBack;
    const packed = packedNote();
    renderChips();
    reportBox.hidden =
      !on ||
      (report.length === 0 && !packed) ||
      visitPlaying ||
      show.playing ||
      strengthOpen ||
      heldBack;
    if (!reportBox.hidden) {
      const told =
        report.length > 0
          ? reportText(report, (t) => nameOf(t), status?.fireHint ?? true)
          : { title: HOLLOW_TEXT.packedTitle, lines: [] };
      const { title } = told;
      const lines = [
        ...told.lines,
        ...(packed ? [...HOLLOW_TEXT.packed, describeItems(packed.refund)] : []),
      ];
      const waiting = report.flatMap((r) => r.taken.filter((t) => t.inHollow));
      const rescueFirst = waiting[0];
      const replayOf = replayable();
      const darkFirst = dark()[0];
      reportBox.replaceChildren(
        el('h2', { class: 'hollow-title', id: 'hollow-report-title' }, title),
        ...(replayOf
          ? [
              button(
                NIGHT_TEXT.watchReplay,
                () => {
                  replay(replayOf);
                },
                {
                  class: 'hollow-replay',
                  'data-testid': 'hollow-report-replay',
                },
              ),
            ]
          : []),
        ...(report.some((r) => r.taken.length > 0)
          ? [
              el(
                'div',
                { class: 'hollow-tokens' },
                ...report.flatMap((r) => r.taken.map((t) => token(t.speciesId, t.inHollow))),
              ),
            ]
          : []),
        ...lines.map((line) =>
          typeof line === 'string'
            ? el('p', { class: 'hollow-line' }, line)
            : el(
                'p',
                { class: 'hollow-line hollow-line-icon' },
                el('span', { class: 'hollow-line-pic', 'aria-hidden': 'true' }, line.icon),
                el('span', {}, line.text),
              ),
        ),
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
          darkFirst
            ? button(
                NIGHT_TEXT.lightMyLand,
                () => {
                  dismissReport();
                  options.showTile?.(darkFirst, true);
                },
                {
                  class: rescueFirst ? 'auth-button-soft' : '',
                  'data-testid': 'hollow-report-light',
                },
              )
            : button(HOLLOW_TEXT.ok, dismissReport, {
                class: rescueFirst ? 'auth-button-soft' : '',
                'data-testid': 'hollow-report-ok',
              }),
        ),
      );
    }

    sheet.hidden = !on || !sheetOpen || !reportBox.hidden || heldBack || strengthOpen;
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
        ...(hollowed.length > 0 && HOLLOW_TEXT.saveUp !== ''
          ? [el('p', { class: 'hollow-sub' }, HOLLOW_TEXT.saveUp)]
          : []),
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
    renderNight();
  }

  function renderNight(): void {
    const heldBack = options.otherReportOpen?.() ?? false;
    const busy = options.mapBusy?.() ?? false;
    busyBefore = busy;
    caption?.setHeld(strengthOpen || !sheet.hidden || heldBack || busy);
    renderStrength(heldBack || replaying);
    renderNudge(
      heldBack ||
        busy ||
        show.playing ||
        strengthOpen ||
        !reportBox.hidden ||
        !sheet.hidden ||
        replaying,
    );
  }

  function dismissReport(): void {
    const newest = report[0];
    if (newest) markSeen(newest.night);
    markPackedSeen();
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
    const askedAt = now();
    try {
      const fresh = await api.status(id);
      if (at !== generation) return;
      status = fresh;
      clockOffset = Date.parse(fresh.now) - now();
      options.layer.setNight(replaying || fresh.night.isNight);
      scheduleNightCheck(fresh.night.changesInMinutes);
      report = unseenReports(fresh.reports, seenNight());
      const fall = pendingFall;
      // A status asked for before the event (it answers from before nightfall)
      // leaves the fall for the refresh the event asked for.
      if (fall && askedAt >= fall.receivedAt) {
        pendingFall = null;
        startFall(fresh, fall);
      }
      joinTonight(fresh);
      options.onStatus?.();
    } catch (err) {
      if (at === generation) note = messageOf(err);
      if (at === generation && pendingFall) {
        pendingFall = null;
        visit();
      }
    }
    if (at === generation) render();
  }

  /** His old visit: night fell with no walk to show. */
  function visit(): void {
    const at = generation;
    visitPlaying = options.layer.visit(() => {
      if (at !== generation) return;
      visitPlaying = false;
      render();
    });
  }

  /**
   * Night fell live (#277): every Keeper's walk plays from nightfall, while
   * it's night (dev builds play it whenever the dev route makes night fall).
   * Tonight's show runs from tonight's nightfall, so a server that catches
   * up at 7:40 shows it already over; a night with no walk is his old visit.
   */
  function startFall(
    fresh: HollowStatus,
    fall: { night: string; at: number; walks: ShowWalk[] },
  ): void {
    const plan = fallPlan({
      glade: glade(),
      isNight: fresh.night.isNight,
      devTools: options.devTools === true,
      walks: fall.walks.filter((w) => w.walk.length > 0).length,
    });
    if (plan === 'visit') visit();
    if (plan === 'replay') {
      // The Glade's scripted nightfall is by day: the walk plays at the replay's pace.
      if (!show.play(fall.walks, now(), null, showEnded(fall.night, generation))) visit();
      else showNight = fall.night;
    }
    if (plan !== 'live') return;
    const startedAt = liveStart({
      fallNight: fall.night,
      fallAt: fall.at,
      tonight: fresh.tonight.night,
      nightfallAt: Date.parse(fresh.tonight.nightfallAt) - clockOffset,
    });
    if (!playLive(fall.night, fall.walks, startedAt)) visit();
  }

  /**
   * Opening the app during tonight's prowl (#277): the show joins part way,
   * from nightfall, with my own walk (others' walks only come live).
   */
  function joinTonight(fresh: HollowStatus): void {
    const tonight = fresh.tonight;
    const mine = fresh.reports.find((r) => r.night === tonight.night);
    if (show.playing || !mine) return;
    const joins = joinsTonight({
      isNight: fresh.night.isNight,
      tonight: tonight.night,
      reportNight: mine.night,
      walk: mine.walk.length,
      now: serverNow(),
      strikeAt: Date.parse(tonight.strikeAt),
      watched: stored(watchedKey),
    });
    const walk = joins ? myWalk(mine, false) : null;
    if (walk) playLive(tonight.night, [walk], Date.parse(tonight.nightfallAt) - clockOffset);
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
      show.stop();
      showNight = null;
      strengthOpen = false;
      replaying = false;
      outNames = null;
      pendingFall = null;
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
      show.stop();
      showNight = null;
      strengthOpen = false;
      replaying = false;
      outNames = null;
      pendingFall = null;
      options.layer.setNight(false);
      render();
    },

    reclaimed: (night, h) =>
      status?.reports.some(
        (r) => r.night === night && r.reclaimed.some((t) => t.q === h.q && t.r === h.r),
      ) ?? false,

    viewChanged: () => {
      if (!mapId || !status) return;
      renderChips();
      renderNight();
    },

    otherReportChanged: () => {
      // Only a change redraws: a redraw rebuilds the report's buttons, and a
      // card waiting behind it asks again every few seconds.
      if ((options.otherReportOpen?.() ?? false) !== heldBackBefore) render();
    },

    liveEvent: (event) => {
      if (event.mapId !== mapId) return;
      if (event.type === 'hollow.nightfall') {
        // Live, not a replay after reconnecting: the show plays every
        // Keeper's walk from nightfall (#277), and the report follows when
        // it's over. A night with no walk at all is his old visit.
        if (now() - Date.parse(event.at) < VISIT_FRESH_MS) {
          const fell = GAME_EVENTS['hollow.nightfall'].public.safeParse(event.data);
          if (fell.success) {
            const { night } = fell.data;
            // Played once the status says whether it's really night now
            // (a server catching up on a missed night by day plays no show).
            pendingFall = {
              night,
              at: Date.parse(event.at),
              receivedAt: now(),
              walks: (fell.data.walks ?? []).map((w) => ({
                userId: w.userId,
                walk: w.walk,
                reclaimed: w.reclaimed,
                seed: options.show?.seedOf(w.userId) ?? null,
                story: w.userId === user?.id ? storyFor(night) : null,
              })),
            };
          } else visit();
        }
        void refresh();
      } else if (event.type === 'squishy.hollowed' || event.type === 'squishy.rescued') {
        void refresh();
      } else if (user && changesMyNight(event, user.id)) {
        // A fire, gatherer or guard of mine changed: the "light a fire" hint
        // may come on or be done now.
        void refresh();
      } else {
        // Land or fires may have changed: the dark spots and the nudge follow.
        renderChips();
        renderNight();
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
        show: show.debug,
        chips: [...chips.children].map((c) => c.textContent),
        nudge: !nudge.hidden,
        strength: !strength.hidden,
        replay: !reportBox.hidden && reportBox.querySelector('.hollow-replay') !== null,
        darkSpots: dark().length,
        walking: layer.walking,
      };
    },
  };
}
