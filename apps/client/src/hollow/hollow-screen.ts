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
import { buttonClass } from '../ui/button/button.js';
import { ApiRequestError } from '../net/api.js';
import { el, messageOf } from '../ui/dom.js';
import { hollowApi, type HollowApi } from './hollow-api.js';
import { VISIT_FRESH_MS } from './hollow-config.js';
import { fallPlan, joinsTonight, liveStart, nightChips, nudgeDue } from './night-plan.js';
import type { HollowLayer } from './hollow-layer.js';
import {
  changesMyNight,
  HOLLOW_TEXT,
  reportText,
  tileUseLines,
  trickOrTreatLines,
  unseenReports,
} from './hollow-report.js';
import { placeOf } from './dark-land.js';
import { createNightShow, domCaption, type NightShowDebug, type ShowWalk } from './night-show.js';
import {
  NIGHT_TEXT,
  reachText,
  STAGE_ORDER,
  STAGES,
  stageNights,
  upkeepPausedLine,
  weatherNotesLine,
} from './night-text.js';
import type { UpkeepPaused } from '../heart-coins/heart-coins.js';
import type { Beat, BeatKind, Narration } from './show-timeline.js';
import {
  closingWords,
  gapReply,
  gapState,
  LONG_NIGHT_TEXT,
  noticeChip,
  noticeChipText,
  reportLines,
  rescueReward,
  revealCard,
  weekdayName,
  type LongNightLine,
  type LongNightResult,
  type LongNightStatus,
} from './long-night.js';
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
  /**
   * My buildings that fell asleep for unpaid upkeep at a patch's latest
   * morning (#601 PR 9, the Heart Coins reply after the bag's settle):
   * the morning card says so once a morning. Call `upkeepChanged` when it
   * may have changed.
   */
  upkeepPaused?: () => UpkeepPaused | null;
  /** A patch-mate's name (the map's members), for the Long Night's feed and crown (#727). */
  memberName?: (userId: string) => string | null;
  /** The map's time zone, for the Long Night's "tonight" and "tomorrow" (#727). */
  timeZone?: () => string | null;
  /** The patch's Keeper of the Night (patch stats), for a morning not seen live (#727). */
  nightKeeper?: (mapId: string) => Promise<{ userId: string; night: string } | null>;
}

/** The Long Night's cards and chips as they read (#727). */
export interface LongNightDebug {
  /** The notice chip's words by day, or null. */
  readonly chip: string | null;
  readonly notice: boolean;
  /** The reveal's title on screen, or null. */
  readonly reveal: string | null;
  /** The reveal offers "Go look". */
  readonly revealGoLook: boolean;
  readonly gap: 'none' | 'available' | 'had';
  /** The Gap card's title on screen, or null. */
  readonly gapCard: string | null;
  /** The Gap card's line (a server message shows here as sent). */
  readonly gapLine: string | null;
  /** The morning report's Long Night lines. */
  readonly report: readonly string[];
  /** The Hollow rescue list's boost line shows. */
  readonly rescueBoost: boolean;
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
  readonly longNight: LongNightDebug;
}

export interface HollowScreen {
  /** The map on screen (null: none); fetches the night and my reports. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  /** A live event on the open map (`map-screen`'s `onLiveEvent`). */
  liveEvent: (event: WsEventMessage) => void;
  /** Another card opened or closed (see `otherReportOpen`). */
  otherReportChanged: () => void;
  /** A fresh Heart Coins reply came in (see `upkeepPaused`). */
  upkeepChanged: () => void;
  /** The map on screen redrew (my dark land may have changed): the chips and the nudge follow. */
  viewChanged: () => void;
  /**
   * The week of a Long Night (#727), the line a tile panel's dark-land
   * warning adds: "He'll come looking on Saturday 🔥"; null otherwise.
   */
  darkSoon: () => string | null;
  /** He won this land of mine back on `night` (#277): his report tells it. */
  reclaimed: (night: string, h: Hex) => boolean;
  readonly debug: HollowDebug | null;
}

/** Longest wait before asking whether night fell or morning came (a phone may sleep through it). */
const MAX_NIGHT_CHECK_MS = 30 * 60_000;

const seenKey = (userId: string, mapId: string) => `heartpatch.hollow.seen.${userId}.${mapId}`;
/** The packed-home-fire note seen on this device (#202): its `at`. */
const packedKey = (userId: string, mapId: string) => `heartpatch.hollow.packed.${userId}.${mapId}`;
/** The packed-Training-Grounds note seen on this device (#277): its `at`. */
const groundsKey = (userId: string, mapId: string) =>
  `heartpatch.hollow.packed-grounds.${userId}.${mapId}`;
/** The one-building-a-tile tidy-up note seen on this device (#295): its `at`. */
const tidyKey = (userId: string, mapId: string) => `heartpatch.hollow.tidy.${userId}.${mapId}`;
/** The crowded-tile pack-up note seen on this device (#295, migration B): its `at`. */
const crowdedKey = (userId: string, mapId: string) =>
  `heartpatch.hollow.packed-crowded.${userId}.${mapId}`;
/** The trick-or-treat note seen on this device (#515): its day. */
const trickKey = (userId: string, mapId: string) =>
  `heartpatch.hollow.trick-or-treat.${userId}.${mapId}`;
/** The last night whose show this device played to the end or skipped (#277). */
const watchedKey = (userId: string, mapId: string) => `heartpatch.hollow.show.${userId}.${mapId}`;
/** The last night whose dark-land nudge was answered on this device (#277). */
const nudgeKey = (userId: string, mapId: string) => `heartpatch.hollow.nudge.${userId}.${mapId}`;
/** The last morning whose upkeep pauses were told (#601 PR 9). */
const weatherKey = (userId: string, mapId: string) =>
  `heartpatch.hollow.weather-knocks.${userId}.${mapId}`;
const upkeepKey = (userId: string, mapId: string) =>
  `heartpatch.hollow.upkeep-paused.${userId}.${mapId}`;
/** The last Long Night whose result this device told (the reveal or the morning's block, #727). */
const revealKey = (userId: string, mapId: string) =>
  `heartpatch.long-night.told.${userId}.${mapId}`;
/** The latest Long Night's result this device saw live (#727): the morning tells it. */
const resultKey = (userId: string, mapId: string) =>
  `heartpatch.long-night.result.${userId}.${mapId}`;
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
  /** Status requests made, and the newest whose reply is shown. */
  let asks = 0;
  let shownAsk = 0;
  /** Night just fell live: its walks wait for the status to say it's night. */
  let pendingFall: { night: string; at: number; receivedAt: number; walks: ShowWalk[] } | null =
    null;
  const serverNow = () => now() + clockOffset;
  /** The latest Long Night's result seen live on this device (#727), or null. */
  let lnResult: LongNightResult | null = null;
  /** The notice sheet (the Long Night chip tapped) and the Gap sheet are open. */
  let noticeOpen = false;
  let gapOpen = false;
  /** The Gap card's words for now: the server's message, or "one battle at a time". */
  let gapMessage: { title: string; line: string } | null = null;
  /** The map I just had my look on: the Gap says so once. Kept through
   *  the battle (it leaves the map and comes back), dropped on dismiss. */
  let hadLookOn: string | null = null;
  /** Keeper of the Night from patch stats, for a held Night this device didn't see live. */
  let statsKeeper: { userId: string; night: string } | null = null;
  let askedKeeper: string | null = null;

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
  // The Long Night (#727): the notice sheet, the 7:30 reveal and Juniper's Gap.
  const noticeBox = el('div', {
    class: 'hollow-card long-night-notice',
    role: 'dialog',
    'aria-labelledby': 'long-night-notice-title',
    'data-testid': 'long-night-notice',
  });
  noticeBox.hidden = true;
  const revealBox = el('div', {
    class: 'hollow-card long-night-reveal',
    role: 'dialog',
    'aria-labelledby': 'long-night-reveal-title',
    'data-testid': 'long-night-reveal',
  });
  revealBox.hidden = true;
  const gapBox = el('div', {
    class: 'hollow-card long-night-gap',
    role: 'dialog',
    'aria-labelledby': 'long-night-gap-title',
    'data-testid': 'long-night-gap',
  });
  gapBox.hidden = true;
  options.root.append(chips, nudge, strength, noticeBox, revealBox, gapBox);
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
  /**
   * A one-time note (packed-up home fires #202 and Training Grounds #277, the
   * one-building-a-tile tidy-up #295), while this device hasn't shown it, and
   * the mark that it has.
   */
  const oneTimeNote = <N extends { at: string }>(
    pick: (s: HollowStatus) => N | null,
    key: (userId: string, mapId: string) => string,
  ) => ({
    note: (): N | null => {
      const packed = status ? pick(status) : null;
      if (!packed || !user || !mapId) return null;
      try {
        return storage?.getItem(key(user.id, mapId)) === packed.at ? null : packed;
      } catch {
        return packed;
      }
    },
    markSeen: (): void => {
      const packed = status ? pick(status) : null;
      if (!packed || !user || !mapId) return;
      try {
        storage?.setItem(key(user.id, mapId), packed.at);
      } catch {
        // Private mode or full storage: the note may show again next time.
      }
    },
  });
  const firesNote = oneTimeNote((s) => s.homeFirePacked, packedKey);
  const groundsNote = oneTimeNote((s) => s.trainingGroundsPacked, groundsKey);
  const tidyNote = oneTimeNote((s) => s.tileUseNote ?? null, tidyKey);
  const crowdedNote = oneTimeNote((s) => s.crowdedTilesPacked ?? null, crowdedKey);
  // Once per device per day: the note's day is its mark.
  const trickNote = oneTimeNote(
    (s) => (s.trickOrTreat ? { ...s.trickOrTreat, at: s.trickOrTreat.day } : null),
    trickKey,
  );
  /** What the morning card last told of upkeep pauses, so only a change redraws it. */
  let upkeepToldBefore: string | null = null;
  // Once per device per morning: the morning is its mark.
  const upkeepNote = oneTimeNote(() => {
    const paused = options.upkeepPaused?.() ?? null;
    return paused && paused.mapId === mapId && paused.buildings.length > 0
      ? { ...paused, at: paused.morning }
      : null;
  }, upkeepKey);
  // Once per device per storm: the newest knock's time is its mark (#621).
  const weatherNote = oneTimeNote((s) => {
    const notes = s.weatherNotes ?? [];
    const newest = notes[0];
    return newest ? { notes, at: newest.at } : null;
  }, weatherKey);
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

  // The Long Night (#727): every day and time from the status and the map's zone.
  const ln = (): LongNightStatus | undefined => status?.longNight;
  const zone = (): string | null => options.timeZone?.() ?? null;
  const lnNotice = () =>
    status && !glade()
      ? noticeChip({ ln: ln(), isNight: status.night.isNight, now: serverNow(), timeZone: zone() })
      : null;
  const gapNow = () => gapState(ln(), serverNow());
  const nameOfKeeper = (userId: string): string | null =>
    userId === user?.id ? user.username : (options.memberName?.(userId) ?? null);

  /** A Long Night's feed line for a Keeper's stop (#727): by place and name; lost land never named. */
  const feedFor =
    (userId: string) =>
    (beat: Beat): string | null => {
      const name = nameOfKeeper(userId);
      if (!name) return null;
      const tile = options.show?.tileAt(beat);
      switch (beat.kind) {
        case 'enter':
          return LONG_NIGHT_TEXT.feedAt(name, placeOf(tile).replace(/^your /, ''));
        case 'recoil':
          return (tile?.homeSlot ?? null) !== null
            ? LONG_NIGHT_TEXT.feedHome(name)
            : LONG_NIGHT_TEXT.feedRecoil(name);
        case 'strike':
          // Mine keeps my own story (who was taken, and the rescue).
          return userId === user?.id ? null : LONG_NIGHT_TEXT.feedFound;
        case 'leave':
          return null;
      }
    };

  /**
   * The Long Night to reveal on this device (#727): the result seen live,
   * once the strike has landed (or the show was watched or skipped), or a
   * held Night told by the status's open Gap while it's still night.
   */
  function revealDue(): LongNightResult | null {
    if (!status || glade()) return null;
    const told = stored(revealKey);
    const live = lnResult;
    // Only while it's still current: tonight's, or the Night whose Gap is open.
    const current =
      live !== null && (live.night === status.tonight.night || ln()?.gap?.night === live.night);
    if (live && current && told !== live.night) {
      const tonight = live.night === status.tonight.night;
      const landed =
        !tonight ||
        serverNow() >= Date.parse(status.tonight.strikeAt) ||
        stored(watchedKey) === live.night;
      if (landed) return live;
      return null;
    }
    const gap = ln()?.gap;
    if (gap && status.night.isNight && told !== gap.night && gapNow() !== 'none') {
      return {
        night: gap.night,
        held: true,
        heldBy: [],
        keeperOfNight: null,
        gapClosesAt: gap.closesAt,
      };
    }
    return null;
  }

  /** The morning report's Long Night block (#727), for an unseen report's Long Night. */
  function reportLongNight(): { night: string; lines: LongNightLine[]; goLook: boolean } | null {
    if (!status) return null;
    const gapNight = ln()?.gap?.night ?? null;
    const night = report.find((r) => r.night === lnResult?.night || r.night === gapNight)?.night;
    if (!night || stored(revealKey) === night) return null;
    const live = lnResult?.night === night ? lnResult : null;
    const held = live ? live.held : true;
    const keeper = live
      ? live.keeperOfNight
      : statsKeeper?.night === night
        ? statsKeeper.userId
        : null;
    return {
      night,
      lines: reportLines({
        held,
        keeperOfNight: keeper,
        me: user?.id ?? null,
        nameOf: nameOfKeeper,
        ln: ln(),
        now: serverNow(),
        timeZone: zone(),
      }),
      goLook: held && gapNow() === 'available',
    };
  }

  /**
   * The device's cache of the latest Long Night's result seen live (#727):
   * the only way a not-held Night reaches the morning, until the status
   * carries it (727e2 swaps this out). With no cache nothing is told but
   * what the status says (an open Gap means it held).
   */
  const saveResult = (result: LongNightResult): void => {
    store(resultKey, JSON.stringify(result));
  };
  const loadResult = (): LongNightResult | null => {
    const raw = stored(resultKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as LongNightResult;
      return typeof parsed.night === 'string' && Array.isArray(parsed.heldBy) ? parsed : null;
    } catch {
      return null;
    }
  };

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
    // The Long Night (#727): its notice chip by day (its minutes stand in
    // for "Night in N min", so never a second chip), "Long Night" at night,
    // and the gold Gap chip while my look waits. With one up front, his
    // stage shrinks to its moon, still a tap away.
    const notice = lnNotice();
    const longTonight =
      (ln()?.tonight ?? false) || (lnResult !== null && lnResult.night === status.tonight.night);
    const front = [
      ...(notice
        ? [
            chip(
              noticeChipText(notice),
              () => {
                noticeOpen = true;
                gapOpen = false;
                gapMessage = null;
                render();
              },
              'long-night-chip',
            ),
          ]
        : []),
      ...(gapNow() === 'available'
        ? [
            chip(
              LONG_NIGHT_TEXT.gapChip,
              () => {
                gapOpen = true;
                gapMessage = null;
                noticeOpen = false;
                render();
              },
              'gap-chip',
            ),
          ]
        : []),
    ];
    front.find((c) => c.dataset['testid'] === 'gap-chip')?.classList.add('night-chip-gold');
    const lnKinds = front.length > 0 ? kinds.map((k) => (k === 'stage' ? 'moon' : k)) : kinds;
    const row = [
      ...front,
      ...lnKinds.flatMap((kind): HTMLElement[] => {
        switch (kind) {
          case 'night':
            return [
              chip(longTonight ? LONG_NIGHT_TEXT.night : NIGHT_TEXT.night, null, 'night-time-chip'),
            ];
          case 'night-in':
            return notice?.kind === 'minutes'
              ? []
              : [chip(NIGHT_TEXT.nightIn(minutes ?? 0), null, 'night-time-chip')];
          case 'dark':
            return darkChip ? [darkChip] : [];
          case 'stage':
            return [stageChip];
          case 'moon':
            return [moonChip];
        }
      }),
    ];
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
        button(NIGHT_TEXT.showMe, answer(false), { 'data-testid': 'night-nudge-show' }, true),
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

  const button = (
    label: string,
    onClick: () => void,
    attrs: Record<string, string> = {},
    soft = false,
  ) => {
    const { class: more = '', ...rest } = attrs;
    const b = el(
      'button',
      {
        type: 'button',
        class:
          `${buttonClass({ variant: soft ? 'secondary' : 'primary', small: true })} ${more}`.trim(),
        ...rest,
      },
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
    const packed = firesNote.note();
    const packedGrounds = groundsNote.note();
    const tidy = tidyNote.note();
    const tidyLines = tidy ? tileUseLines(tidy) : [];
    const crowded = crowdedNote.note();
    const treated = trickNote.note();
    const upkeep = upkeepNote.note();
    upkeepToldBefore = upkeep
      ? `${upkeep.at}:${upkeep.buildings.map((b) => b.buildingId).join(',')}`
      : null;
    const upkeepLine = upkeep ? upkeepPausedLine(upkeep.buildings) : null;
    const stormLine = weatherNotesLine(weatherNote.note()?.notes ?? []);
    renderChips();
    // The Long Night's cards (#727) come first: one card at a time.
    // A sheet whose chip has gone (Off, or the Gap closed) closes first.
    if (noticeOpen && (!weekdayName(ln()) || !lnNotice())) noticeOpen = false;
    if (gapOpen && gapNow() !== 'available') gapOpen = false;
    const lnCard = lnBlocked(heldBack);
    const revealing = revealDue() !== null && !lnCard;
    const lnUp = revealing || noticeOpen || gapUp();
    reportBox.hidden =
      !on ||
      (report.length === 0 &&
        !packed &&
        !packedGrounds &&
        tidyLines.length === 0 &&
        !crowded &&
        !treated &&
        !upkeepLine &&
        !stormLine) ||
      visitPlaying ||
      show.playing ||
      strengthOpen ||
      lnUp ||
      heldBack;
    lnReportNight = null;
    if (!reportBox.hidden) {
      const told =
        report.length > 0
          ? reportText(report, (t) => nameOf(t), status?.fireHint ?? true)
          : { title: HOLLOW_TEXT.packedTitle, lines: [] };
      const { title } = told;
      const lines = [
        ...told.lines,
        ...(packed ? [...HOLLOW_TEXT.packed, describeItems(packed.refund)] : []),
        ...(packedGrounds
          ? [...HOLLOW_TEXT.packedGrounds, describeItems(packedGrounds.refund)]
          : []),
        ...tidyLines,
        ...(tidy && tidy.packed.length > 0 ? [describeItems(tidy.refund)] : []),
        ...(crowded ? [...HOLLOW_TEXT.packedCrowded, describeItems(crowded.refund)] : []),
        ...(treated ? trickOrTreatLines(treated) : []),
        ...(upkeepLine ? [upkeepLine] : []),
        ...(stormLine ? [stormLine] : []),
      ];
      const waiting = report.flatMap((r) => r.taken.filter((t) => t.inHollow));
      const rescueFirst = waiting[0];
      const replayOf = replayable();
      const darkFirst = dark()[0];
      const lnBlock = reportLongNight();
      lnReportNight = lnBlock?.night ?? null;
      reportBox.replaceChildren(
        ...(lnBlock
          ? [
              el('span', { class: 'long-night-tag' }, LONG_NIGHT_TEXT.reportTag),
              el(
                'ul',
                { class: 'long-night-lines', 'data-testid': 'long-night-report' },
                ...lnBlock.lines.map((l) =>
                  el(
                    'li',
                    { class: 'hollow-line hollow-line-icon' },
                    el('span', { class: 'hollow-line-pic', 'aria-hidden': 'true' }, l.icon),
                    el('span', {}, l.text),
                  ),
                ),
              ),
              ...(lnBlock.goLook
                ? [
                    el(
                      'div',
                      { class: 'hollow-row' },
                      button(
                        LONG_NIGHT_TEXT.goLook,
                        () => {
                          dismissReport();
                          void goLook();
                        },
                        { 'data-testid': 'long-night-report-go' },
                      ),
                    ),
                  ]
                : []),
              el('hr', { class: 'long-night-rule' }),
            ]
          : []),
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
          // A morning with no night to tell but buildings that need 💛 (#601
          // PR 9) isn't about fires: it's an Okay.
          darkFirst && (report.length > 0 || !upkeepLine)
            ? button(
                NIGHT_TEXT.lightMyLand,
                () => {
                  dismissReport();
                  options.showTile?.(darkFirst, true);
                },
                { 'data-testid': 'hollow-report-light' },
                rescueFirst !== undefined,
              )
            : button(
                HOLLOW_TEXT.ok,
                dismissReport,
                { 'data-testid': 'hollow-report-ok' },
                rescueFirst !== undefined,
              ),
        ),
      );
    }

    sheet.hidden = !on || !sheetOpen || !reportBox.hidden || heldBack || strengthOpen || lnUp;
    if (!sheet.hidden && status) {
      const reward = rescueReward(status.rescue, Boolean(status.longNight?.gap));
      sheet.replaceChildren(
        el('h2', { class: 'hollow-title', id: 'hollow-sheet-title' }, HOLLOW_TEXT.sheetTitle),
        el(
          'p',
          { class: 'hollow-line' },
          hollowed.length > 0 ? HOLLOW_TEXT.sheetIntro : HOLLOW_TEXT.empty,
        ),
        ...(hollowed.length > 0 && reward.boost
          ? [
              // While the Gap is open more rescues earn a reward (#727): the number already says so.
              el(
                'p',
                { class: 'hollow-note long-night-boost', 'data-testid': 'long-night-boost' },
                LONG_NIGHT_TEXT.rescueBoost,
              ),
            ]
          : []),
        ...(hollowed.length > 0 ? [el('p', { class: 'hollow-sub' }, reward.line)] : []),
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
                button(
                  HOLLOW_TEXT.devNightfall,
                  () => void devNightfall(),
                  { 'data-testid': 'hollow-dev-nightfall' },
                  true,
                ),
              ]
            : []),
          button(
            HOLLOW_TEXT.back,
            () => {
              sheetOpen = false;
              render();
            },
            { 'data-testid': 'hollow-back' },
            true,
          ),
        ),
      );
    }
    renderNight();
  }

  /** What holds the Long Night's cards back: the show, his visit, another card. */
  const lnBlocked = (heldBack: boolean): boolean =>
    !mapId || !status || show.playing || visitPlaying || replaying || strengthOpen || heldBack;
  /** The Gap card is up: its sheet, a message, or "you've had your look". */
  const gapUp = (): boolean =>
    gapMessage !== null ||
    (hadLookOn !== null && hadLookOn === mapId && gapNow() === 'had') ||
    (gapOpen && gapNow() === 'available');
  /** The night of the Long Night block on the report card now (null: none). */
  let lnReportNight: string | null = null;

  function renderLongNight(heldBack: boolean): void {
    const blocked = lnBlocked(heldBack);
    // The reveal first, then a sheet the kid opened.
    const result = blocked ? null : revealDue();
    revealBox.hidden = result === null;
    if (result) {
      const card = revealCard({
        result,
        me: user?.id ?? null,
        ln: ln(),
        now: serverNow(),
        timeZone: zone(),
      });
      const drawn = `${JSON.stringify(card)}|${String(working)}`;
      if (revealBox.dataset['drawn'] !== drawn) {
        revealBox.dataset['drawn'] = drawn;
        const close = () => {
          store(revealKey, result.night);
          render();
        };
        revealBox.replaceChildren(
          el('span', { class: 'long-night-who' }, LONG_NIGHT_TEXT.who),
          el('h2', { class: 'hollow-title', id: 'long-night-reveal-title' }, card.title),
          el(
            'p',
            { class: 'hollow-line', 'data-testid': 'long-night-reveal-line' },
            ...(card.lead ? [el('span', { class: 'long-night-wide' }, card.lead)] : []),
            card.line,
          ),
          ...(card.sub ? [el('p', { class: 'hollow-sub' }, card.sub)] : []),
          el(
            'div',
            { class: 'hollow-row' },
            ...(card.goLook
              ? [
                  button(
                    LONG_NIGHT_TEXT.goLook,
                    () => {
                      close();
                      void goLook();
                    },
                    { 'data-testid': 'long-night-go' },
                  ),
                  quietButton(LONG_NIGHT_TEXT.later, close, 'long-night-later'),
                ]
              : [button(LONG_NIGHT_TEXT.okay, close, { 'data-testid': 'long-night-ok' })]),
          ),
        );
      }
    } else delete revealBox.dataset['drawn'];

    const sheetsBlocked = blocked || result !== null || !reportBox.hidden;
    const day = weekdayName(ln());
    if (noticeOpen && (!day || !lnNotice())) noticeOpen = false;
    noticeBox.hidden = !noticeOpen || sheetsBlocked;
    const first = dark()[0];
    // Only a change redraws, so a tap mid-press isn't lost to a rebuild.
    const noticeDrawn = `${day ?? ''}|${first ? hexKey(first) : ''}|${String(working)}`;
    if (noticeBox.hidden) delete noticeBox.dataset['drawn'];
    if (!noticeBox.hidden && day && noticeBox.dataset['drawn'] !== noticeDrawn) {
      noticeBox.dataset['drawn'] = noticeDrawn;
      const shut = () => {
        noticeOpen = false;
        render();
      };
      noticeBox.replaceChildren(
        el(
          'h2',
          { class: 'hollow-title', id: 'long-night-notice-title' },
          LONG_NIGHT_TEXT.noticeTitle(day),
        ),
        el('p', { class: 'hollow-line' }, LONG_NIGHT_TEXT.noticeLine(day)),
        el(
          'p',
          { class: 'hollow-sub' },
          LONG_NIGHT_TEXT.noticeSubHold,
          el('span', { class: 'long-night-wide' }, LONG_NIGHT_TEXT.noticeSubWhole),
          LONG_NIGHT_TEXT.noticeSub,
          el('span', { class: 'long-night-wide' }, LONG_NIGHT_TEXT.noticeSubWide),
          el('span', { class: 'long-night-short' }, LONG_NIGHT_TEXT.noticeSubShort),
        ),
        el(
          'div',
          { class: 'hollow-row' },
          ...(first
            ? [
                button(
                  LONG_NIGHT_TEXT.lightMyLand,
                  () => {
                    noticeOpen = false;
                    options.showTile?.(first, true);
                    render();
                  },
                  { 'data-testid': 'long-night-notice-light' },
                  true,
                ),
              ]
            : []),
          button(LONG_NIGHT_TEXT.okay, shut, { 'data-testid': 'long-night-notice-ok' }),
        ),
      );
    }

    const state = gapNow();
    if (gapOpen && state !== 'available') gapOpen = false;
    gapBox.hidden = !gapUp() || sheetsBlocked;
    if (gapBox.hidden) {
      delete gapBox.dataset['drawn'];
      return;
    }
    const shutGap = () => {
      gapOpen = false;
      gapMessage = null;
      hadLookOn = null;
      render();
    };
    const closes = ln()?.gap?.closesAt;
    const when = closes ? closingWords(closes, serverNow(), zone()) : LONG_NIGHT_TEXT.closesTonight;
    const gapDrawn = `${state}|${gapMessage?.line ?? ''}|${when}|${String(working)}`;
    if (gapBox.dataset['drawn'] === gapDrawn) return;
    gapBox.dataset['drawn'] = gapDrawn;
    if (gapMessage || state !== 'available') {
      const title = gapMessage?.title ?? LONG_NIGHT_TEXT.hadLookTitle;
      const line = gapMessage?.line ?? LONG_NIGHT_TEXT.hadLookLine(when);
      gapBox.replaceChildren(
        el('h2', { class: 'hollow-title', id: 'long-night-gap-title' }, title),
        el('p', { class: 'hollow-line', 'data-testid': 'long-night-gap-line' }, line),
        el(
          'div',
          { class: 'hollow-row' },
          button(LONG_NIGHT_TEXT.okay, shutGap, { 'data-testid': 'long-night-gap-ok' }),
        ),
      );
      return;
    }
    gapBox.replaceChildren(
      el(
        'div',
        { class: 'long-night-gate', 'aria-hidden': 'true' },
        el('i', {}),
        el('s', { class: 'long-night-spark-a' }, '✨'),
        el('s', { class: 'long-night-spark-b' }, '✨'),
      ),
      el('h2', { class: 'hollow-title', id: 'long-night-gap-title' }, LONG_NIGHT_TEXT.gapTitle),
      el(
        'p',
        { class: 'hollow-line', 'data-testid': 'long-night-gap-line' },
        LONG_NIGHT_TEXT.gapLine,
      ),
      el(
        'p',
        { class: 'hollow-sub' },
        LONG_NIGHT_TEXT.gapOneLook,
        el('span', { class: 'long-night-wide' }, LONG_NIGHT_TEXT.gapCount),
        LONG_NIGHT_TEXT.gapTill(when),
      ),
      el('p', { class: 'hollow-sub long-night-boost' }, LONG_NIGHT_TEXT.gapRescue),
      el(
        'div',
        { class: 'hollow-row' },
        button(
          LONG_NIGHT_TEXT.goLook,
          () => {
            gapOpen = false;
            void goLook();
          },
          { 'data-testid': 'long-night-gap-go' },
        ),
        quietButton(LONG_NIGHT_TEXT.notNow, shutGap, 'long-night-gap-later'),
      ),
    );
  }

  function quietButton(label: string, onClick: () => void, testId: string): HTMLElement {
    const b = el(
      'button',
      {
        type: 'button',
        class: buttonClass({ variant: 'quiet', small: true }),
        'data-testid': testId,
      },
      label,
    );
    b.disabled = working;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderNight(): void {
    const heldBack = options.otherReportOpen?.() ?? false;
    const busy = options.mapBusy?.() ?? false;
    busyBefore = busy;
    renderLongNight(heldBack);
    const lnShown = !revealBox.hidden || !noticeBox.hidden || !gapBox.hidden;
    caption?.setHeld(strengthOpen || !sheet.hidden || heldBack || busy || lnShown);
    renderStrength(heldBack || replaying);
    renderNudge(
      heldBack ||
        lnShown ||
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
    // The morning's Long Night block told it: no reveal for it after.
    if (lnReportNight) store(revealKey, lnReportNight);
    firesNote.markSeen();
    groundsNote.markSeen();
    tidyNote.markSeen();
    crowdedNote.markSeen();
    trickNote.markSeen();
    upkeepNote.markSeen();
    weatherNote.markSeen();
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
    const asked = (asks += 1);
    try {
      const fresh = await api.status(id);
      // A reply older than one already shown (night fell as a timer asked) is stale.
      if (at !== generation || asked < shownAsk) return;
      shownAsk = asked;
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
      askNightKeeper(fresh);
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

  /**
   * A held Night this device didn't see live (#727): Keeper of the Night
   * comes from patch stats, asked once per Night.
   */
  function askNightKeeper(fresh: HollowStatus): void {
    const id = mapId;
    const night = fresh.longNight?.gap?.night;
    if (!id || !night || !options.nightKeeper) return;
    if (lnResult?.night === night || askedKeeper === night) return;
    askedKeeper = night;
    const at = generation;
    options
      .nightKeeper(id)
      .then((keeper) => {
        if (at !== generation) return;
        statsKeeper = keeper;
        render();
      })
      .catch(() => undefined);
  }

  /**
   * My one look in Juniper's Gap (#727): an ordinary wild battle starts. A
   * resumed battle of another kind waits to be finished first; a stale read
   * (closed, claimed, not a Keeper) shows the server's own words, and the
   * Gap switched off just hides it all. The status is asked again after.
   */
  async function goLook(): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    const stillHere = () => at === generation && mapId === id;
    working = true;
    gapMessage = null;
    render();
    try {
      const battle = await sendCommand(sendDeps, (key) => api.gapEncounter(id, key), stillHere);
      if (battle && stillHere()) {
        const reply = gapReply({ battle });
        if (reply.kind === 'battle') {
          hadLookOn = id;
          options.openBattle(battle);
        } else if (reply.kind === 'message') gapMessage = reply;
      }
    } catch (err) {
      const reply = gapReply(
        err instanceof ApiRequestError ? err : { code: 'INTERNAL', message: messageOf(err) },
      );
      if (stillHere() && reply.kind === 'message') gapMessage = reply;
    } finally {
      working = false;
      gapOpen = false;
      if (stillHere()) await refresh();
    }
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
      // The Glade's scripted nightfall is by day: the sky dims (design doc §26
      // step 10) and the walk plays at the replay's pace.
      replaying = true;
      options.layer.setNight(true);
      if (show.play(fall.walks, now(), null, showEnded(fall.night, generation))) {
        showNight = fall.night;
      } else {
        replaying = false;
        options.layer.setNight(fresh.night.isNight);
        visit();
      }
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
      noticeOpen = false;
      gapOpen = false;
      gapMessage = null;
      statsKeeper = null;
      askedKeeper = null;
      lnResult = loadResult();
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
      noticeOpen = false;
      gapOpen = false;
      gapMessage = null;
      hadLookOn = null;
      statsKeeper = null;
      askedKeeper = null;
      lnResult = loadResult();
      options.layer.setNight(false);
      render();
    },

    darkSoon: () => {
      const day = weekdayName(ln());
      return day && lnNotice() ? LONG_NIGHT_TEXT.darkSoon(day) : null;
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

    upkeepChanged: () => {
      // Only a change redraws (as `otherReportChanged`): a redraw rebuilds the report's buttons.
      const upkeep = upkeepNote.note();
      const told = upkeep
        ? `${upkeep.at}:${upkeep.buildings.map((b) => b.buildingId).join(',')}`
        : null;
      if (mapId && status && told !== upkeepToldBefore) render();
    },

    otherReportChanged: () => {
      // Only a change redraws: a redraw rebuilds the report's buttons, and a
      // card waiting behind it asks again every few seconds.
      if ((options.otherReportOpen?.() ?? false) !== heldBackBefore) render();
    },

    liveEvent: (event) => {
      if (event.mapId !== mapId) return;
      if (event.type === 'hollow.nightfall') {
        // A Long Night's result (#727), live or replayed after reconnecting:
        // the reveal and the morning tell it.
        const result = GAME_EVENTS['hollow.nightfall'].public.safeParse(event.data);
        const lnFell = result.success ? result.data.longNight : undefined;
        if (result.success && lnFell) {
          lnResult = { night: result.data.night, ...lnFell };
          saveResult(lnResult);
        }
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
                // A Long Night narrates every Keeper's walk in one feed (#727).
                feed: lnFell ? feedFor(w.userId) : null,
              })),
            };
          } else visit();
        }
        void refresh();
      } else if (
        event.type === 'squishy.hollowed' ||
        event.type === 'squishy.rescued' ||
        event.type === 'gap.opened' ||
        // The owner moved the Long Night (#727): when it comes is worked out again.
        (event.type === 'map.updated' && 'longNightWeekday' in event.data)
      ) {
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
        longNight: {
          chip: (() => {
            const n = lnNotice();
            return n ? noticeChipText(n) : null;
          })(),
          notice: !noticeBox.hidden,
          reveal: revealBox.hidden ? null : (revealBox.querySelector('h2')?.textContent ?? null),
          revealGoLook:
            !revealBox.hidden && revealBox.querySelector('[data-testid="long-night-go"]') !== null,
          gap: gapNow(),
          gapCard: gapBox.hidden ? null : (gapBox.querySelector('h2')?.textContent ?? null),
          gapLine: gapBox.hidden
            ? null
            : (gapBox.querySelector('[data-testid="long-night-gap-line"]')?.textContent ?? null),
          report: reportBox.hidden
            ? []
            : [...reportBox.querySelectorAll('.long-night-lines li')].map((li) => li.textContent),
          rescueBoost: !sheet.hidden && sheet.querySelector('.long-night-boost') !== null,
        },
      };
    },
  };
}
