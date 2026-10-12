import {
  GAME_DATA,
  visualRegistry,
  type CareListResponse,
  type CinematicShot,
  type HomeResponse,
  type HouseView,
  type JobsView,
  type KeeperConfig,
  type PublicUser,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { HOME_SHEET } from '../home/home-config.js';
import { afterHandle } from '../home/home-peek.js';
import { TapDetector } from '../map/tap-detector.js';
import { el, messageOf } from '../ui/dom.js';
import { houseApi, type HouseApi } from './house-api.js';
import { createHouseBuilder } from './house-build.js';
import { confirmPanel, growPanel, houseButton, sparkle } from './house-grow.js';
import { builtLine, sparkleSpot } from './house-grow-view.js';
import { floorAfterGrowing, roomBox } from './house-layout.js';
import { createViewSync } from './house-view-sync.js';
import {
  blend,
  clampZoom,
  entryGlide,
  glidePose,
  kidPose,
  pinchedOut,
  pinchZoom,
  roofAt,
  walkedIn,
  walkZoom,
  type HousePose,
  type HouseViewport,
} from './house-camera.js';
import { HouseScene, type HouseCastMember, type HouseSceneStats } from './house-scene.js';
import { HOUSE_CAMERA, HOUSE_SHEET } from './house-config.js';
import { createOpenGate } from './house-open-gate.js';
import { framedRoomId, framesAboveSheet, sheetBands } from './house-frame.js';
import { createHousePan, type PanFrame } from './house-pan.js';
import { GROW_TEXT, HOUSE_TEXT, keepTail, peekLine, RESIDENT_TEXT } from './house-view.js';
import { careApi, type CareApi } from '../care/care-api.js';
import type { Portraits } from '../procedural/portraits.js';
import { jobsApi, type JobsApi } from '../squishies/jobs/jobs-api.js';
import { mergeRoster, type RosterRow } from '../squishies/roster/roster-view.js';
import { createResidentMover } from './house-move.js';
import { bedsPanel, moveOutPanel, pickerPanel } from './house-residents.js';
import {
  castKey,
  movedLine,
  MOVE_BACK_IN_HOURS,
  pickerFor,
  roomBeds,
  roomFor,
} from './house-residents-view.js';
import './house.css';

// The Keeper's house (#381 plan §10): "Go inside" on the home's house card,
// or a tap on the cottage, lifts the roof off and settles above the whole
// dollhouse. Back (or Escape, or a pinch out past the dollhouse) goes home.
// Like the close-up, it owns the screen while open and swaps its scene onto
// the one shared stage.

export interface HouseScreenOptions {
  root: HTMLElement;
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  /** The player's Keeper, standing by the hearth. */
  keeper: () => KeeperConfig | null;
  keeperWearing?: () => readonly string[];
  /** Covered by the account chip at the top of the screen (CSS px from the top). */
  coveredTop?: () => number;
  /** The house opened: home and the map step out. */
  onOpen: (mapId: string) => void;
  /** Back home. */
  onClosed: (mapId: string) => void;
  /** The house couldn't open (offline): say why where the player is looking. */
  onProblem: (message: string) => void;
  api?: HouseApi;
  /** `prefers-reduced-motion` (the dev gallery pins it to skip the glide). */
  reducedMotion?: Pick<MediaQueryList, 'matches'> &
    Partial<Pick<MediaQueryList, 'addEventListener'>>;
  /**
   * Still wanted when the reply lands (home still open on this patch): a
   * player who left Home mid-fetch never gets the house over the map.
   */
  canOpen?: (mapId: string) => boolean;
  /** The squishies' real pictures on the beds and in the picker; without, plain blobs. */
  portraits?: Portraits;
  /** Moods and away states for the beds and the picker (the roster's reads, #375). */
  care?: Pick<CareApi, 'list'>;
  jobs?: Pick<JobsApi, 'view'>;
}

/**
 * The bottom sheet (#381 plan §10.2): folded to the peek bar so the house
 * fills the screen, opened to the rooms' beds and Grow the house, the Grow
 * sheet itself, the build's confirm, the move-in picker (C2b) or the
 * move-out confirm.
 */
export type HouseSheet = 'peek' | 'open' | 'grow' | 'confirm' | 'picker' | 'move-out';

/** The sheets that are a page of their own over a dimmed house (scrim, ✕, the HUD inert). */
const isPage = (s: HouseSheet): boolean =>
  s === 'grow' || s === 'confirm' || s === 'picker' || s === 'move-out';

/** How the house opens: from the roster's "Move into the house", straight to the picker. */
export interface HouseOpenOptions {
  /** The squishy the picker opens on (#375's row detail). */
  readonly pick?: string;
  /** The room the picker opens on (the dev gallery's `?picker=`); else the first with a free bed. */
  readonly room?: string;
}

/** Read-only state for the dev hook (Playwright asserts on it, not pixels). */
export interface HouseDebug {
  readonly mapId: string;
  readonly open: boolean;
  readonly level: number;
  readonly rooms: number;
  /** `glide` while the roof lifts off, `walk` while Walk in or Step out moves, else `dollhouse` or `kid`. */
  readonly pose: 'glide' | 'walk' | 'dollhouse' | 'kid';
  readonly zoom: number;
  readonly scene: HouseSceneStats | null;
  /** Residents whose faces the camera sees, of those drawn. */
  readonly faces: { visible: number; total: number } | null;
  readonly sheet: HouseSheet;
  /** A build is in flight. */
  readonly building: boolean;
  /** Sparkle bursts played after builds (none under reduced motion). */
  readonly sparkles: number;
  /** A move in or out is in flight. */
  readonly moving: boolean;
  /** The room the move-in picker fills, while it's open. */
  readonly pickRoom: string | null;
  /**
   * Re-reads the house now, as opening the sheet does. Dev hook only: e2e
   * starts a read while a build is in flight (the UI can't) to prove the
   * build's reply wins.
   */
  readonly reread: () => void;
}

export interface HouseScreen {
  setUser: (user: PublicUser | null) => void;
  /** Opens the house of this patch; the home reply says who the residents are. */
  open: (
    mapId: string,
    home: Pick<HomeResponse, 'squishies' | 'speciesDefs'>,
    how?: HouseOpenOptions,
  ) => Promise<void>;
  close: () => void;
  readonly isOpen: boolean;
  /** The patch whose house is open, or null (cheap: no scene stats). */
  readonly mapId: string | null;
  readonly debug: HouseDebug | null;
}

export function createHouseScreen(options: HouseScreenOptions): HouseScreen {
  const api = options.api ?? houseApi;
  const registry = visualRegistry(GAME_DATA);
  const reducedMotion =
    options.reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)');
  // Turned on mid-glide: cut to the end, as the close-up does.
  reducedMotion.addEventListener?.('change', () => {
    if (!reducedMotion.matches) return;
    skipGlide();
    if (walk) {
      zoom = walk.goal;
      walk = null;
      renderWalk();
      draw();
    }
  });
  /** One open at a time; a late reply after Back, a logout or another player is dropped. */
  const gate = createOpenGate();

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let view: HouseView | null = null;
  let cast = new Map<string, HouseCastMember>();
  let isOpen = false;
  let scene3d: HouseScene | null = null;
  let builtTier: QualityTier | null = null;
  /** The fitted dollhouse pose for the screen as it is now. */
  let base: HousePose | null = null;
  /** The sideways drag on a tall phone: fits once, slides per frame (house-pan.ts). */
  const panner = createHousePan({
    measure: () => {
      const s = scene3d;
      if (!s) throw new Error('no house to fit');
      // C2b: a residents page frames its own room on a tall phone.
      const room = pageRoom() ?? s.focusRoom;
      return { vp: viewport(), bounds: s.frameBounds, room, spots: s.residentSpots };
    },
    frameOutside: (pose, vp) => {
      const height = Math.max(1, vp.height);
      scene3d?.frameOutside({ pose, aspect: vp.width / height, topBar: 1 - (2 * vp.top) / height });
    },
  });
  let glide: { shot: CinematicShot; start: number | null } | null = null;
  /** Kid height in the focus room, for the screen as it is now. */
  let kid: HousePose | null = null;
  /** 0 the dollhouse, 1 kid height. */
  let zoom = 0;
  /** The floor the dollhouse shows (kid height walks in on the ground floor). */
  let floor = 0;
  /** Walk in or Step out under way: from where, to where, since when (ms). */
  let walk: { from: number; goal: number; start: number | null } | null = null;
  let frame = 0;
  let sheet: HouseSheet = 'peek';
  /** The sheet's status line: the build's ta-da, or a kind word on a problem. */
  let note = '';
  /** A ta-da reads green; a refusal or a problem reads calm. */
  let noteKind: 'ok' | 'calm' = 'ok';
  let building = false;
  /** The Grow sheet's sticky header, a direct child of the sheet's scroll. */
  let head: HTMLElement | null = null;
  /** What gets focus after the next render (a `data-testid`), when the sheet moved. */
  let focusNext: string | null = null;
  /** A build just landed: sparkle once the new room has drawn its first frame. */
  let celebrate = false;
  /** Sparkle bursts played (the dev hook proves the ta-da happened). */
  let sparkles = 0;
  /** The newest house reply wins: a read a build overtook is dropped. */
  const sync = createViewSync();
  /** The bottom band the folded sheet covers, kept while it's open so the house doesn't jump. */
  let foldedBand = 0;
  /** The folded sheet's own band (B4: the yard may run on under Walk in, down to it). */
  let foldedSheet = 0;
  const builder = createHouseBuilder({
    build: (id, toLevel, key) => api.build(id, toLevel, key),
  });

  // ── Residents (C2b) ───────────────────────────────────────────────────
  const careCalls = options.care ?? careApi;
  const jobCalls = options.jobs ?? jobsApi;
  const mover = createResidentMover({
    move: (id, squishyId, roomId, key) => api.moveResident(id, squishyId, roomId, key),
  });
  /** The home reply the house opened with: my squishies, for names and pictures. */
  let homeData: Pick<HomeResponse, 'squishies' | 'speciesDefs'> | null = null;
  /** The roster's other reads (moods, away ones), or null until they land (#375). */
  let careRead: CareListResponse | null = null;
  let jobsRead: JobsView | null = null;
  /** My squishies as the roster shows them, by id. */
  let people = new Map<string, RosterRow>();
  /** Bumped by every people read and by closing, so a late one is dropped. */
  let peopleTicket = 0;
  /** When the current `view` arrived (device ms), to run its `now` forward. */
  let viewAt = 0;
  /** The room the picker fills, the squishy it opened on, and the opened bed chip. */
  let pickRoom: string | null = null;
  let pickFocus: string | null = null;
  let chosen: string | null = null;
  let moving = false;

  // ── DOM ───────────────────────────────────────────────────────────────
  const touch = el('div', { class: 'house-touch', 'data-testid': 'house-touch' });
  const back = el(
    'button',
    { type: 'button', class: 'house-back', 'data-testid': 'house-back' },
    `‹ ${HOUSE_TEXT.back}`,
  );
  const pill = el('span', { class: 'house-pill', 'data-testid': 'house-pill' });
  const top = el('div', { class: 'house-top' }, back, pill);
  const walkButton = el('button', {
    type: 'button',
    class: 'house-walk',
    'data-testid': 'house-walk',
  });
  // B4 floor switch: shown when the house has more than one floor, in the dollhouse.
  const floorButton = el('button', {
    type: 'button',
    class: 'house-floor',
    'data-testid': 'house-floor',
  });
  // "More this way" at a side the phone's frame crops (B4), a soft fade and a chevron.
  const moreLeft = el('div', { class: 'house-more house-more-left', 'aria-hidden': 'true' }, '‹');
  const moreRight = el('div', { class: 'house-more house-more-right', 'aria-hidden': 'true' }, '›');
  const peekText = el('span', { class: 'house-peek-line', 'data-testid': 'house-peek-line' });
  // The sheet's handle, as home's (#412): a tap opens or folds it, a swipe
  // goes the finger's way; a click with no press before it (keyboard,
  // VoiceOver) toggles.
  const handle = el('button', {
    type: 'button',
    class: 'house-peek-handle',
    'data-testid': 'house-peek-handle',
    'aria-label': HOUSE_TEXT.sheetHandle,
    'aria-expanded': 'false',
  });
  // One live region that never moves: only its words change.
  const noteLine = el('p', {
    class: 'house-note',
    role: 'status',
    tabindex: '-1',
    'data-testid': 'house-note',
  });
  const sheetBody = el('div', { class: 'house-sheet-body', 'data-testid': 'house-sheet-body' });
  const peek = el(
    'section',
    { class: 'house-peek', 'data-testid': 'house-peek', 'aria-label': HOUSE_TEXT.yourHouse },
    handle,
    peekText,
    noteLine,
    sheetBody,
  );
  // Behind an open Grow sheet the scene and the HUD dim, and a tap there
  // closes the sheet (the HUD's Back can't be mistaken for the sheet's way out).
  const scrim = el('div', { class: 'house-scrim', 'data-testid': 'house-scrim' });
  scrim.hidden = true;
  // A press on the scrim never takes focus out of the sheet (it would land on the page).
  scrim.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
  scrim.addEventListener('click', () => {
    // While building or moving, the page stays put ("Building…" can't be dismissed).
    if (!building && !moving) setSheet('peek');
  });
  const overlay = el(
    'div',
    { class: 'house', 'data-testid': 'house', role: 'dialog', 'aria-label': HOUSE_TEXT.yourHouse },
    touch,
    top,
    walkButton,
    floorButton,
    moreLeft,
    moreRight,
    scrim,
    peek,
  );
  overlay.hidden = true;
  options.root.append(overlay);
  back.addEventListener('click', () => {
    close();
  });
  let pressY: number | null = null;
  let releasedAt = -Infinity;
  handle.addEventListener('pointerdown', (e) => {
    pressY = e.clientY;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or already-released pointer can't be captured; harmless.
    }
  });
  handle.addEventListener('pointerup', (e) => {
    if (pressY === null) return;
    const dy = e.clientY - pressY;
    pressY = null;
    releasedAt = performance.now();
    setSheet(afterHandle(sheet !== 'peek', dy, HOME_SHEET.swipePx) ? 'open' : 'peek');
  });
  handle.addEventListener('pointercancel', () => {
    pressY = null;
  });
  handle.addEventListener('click', () => {
    if (performance.now() - releasedAt < HOME_SHEET.clickAfterMs) return;
    setSheet(sheet === 'peek' ? 'open' : 'peek');
  });
  // The click a touch fires after the handle's release lands wherever the
  // finger was, which by then is the opened sheet's Grow button: swallow it.
  peek.addEventListener(
    'click',
    (e) => {
      if (e.target === handle || performance.now() - releasedAt >= HOUSE_SHEET.ghostClickMs) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  // The folded bar's room line opens it too (a bigger target than the grip).
  peekText.addEventListener('click', () => {
    if (sheet === 'peek') setSheet('open');
  });
  // The button alternative to the pinch (style guide §3.3).
  walkButton.addEventListener('click', () => {
    skipGlide();
    walk = { from: zoom, goal: walkedIn(zoom) ? 0 : 1, start: null };
    renderWalk();
    draw();
  });

  floorButton.addEventListener('click', () => {
    skipGlide();
    showFloor(floor === 0 ? (scene3d?.floors.at(-1) ?? 0) : 0);
  });

  /** The dollhouse shows floor `n` (the floors above taken away) and refits to it. */
  function showFloor(n: number): void {
    floor = n;
    scene3d?.setFloor(n);
    renderFloor();
    refit();
  }

  /** Upstairs or Downstairs: only with more than one floor, and only in the dollhouse. */
  function renderFloor(): void {
    // Hidden while the sheet is open, as Walk in is (B3b: the HUD behind it is inert).
    const dollhouse = walk === null && zoom <= 0 && sheet === 'peek';
    moreLeft.hidden = !dollhouse || panner.pan <= panner.limits.min + 0.05;
    moreRight.hidden = !dollhouse || panner.pan >= panner.limits.max - 0.05;
    const floors = scene3d?.floors ?? [];
    floorButton.hidden = floors.length < 2 || !dollhouse;
    const up = floor === 0;
    if (floorButton.dataset['up'] === String(up)) return;
    floorButton.dataset['up'] = String(up);
    floorButton.replaceChildren(
      el(
        'span',
        { 'aria-hidden': 'true' },
        up ? HOUSE_TEXT.upstairsIcon : HOUSE_TEXT.downstairsIcon,
      ),
      ` ${up ? HOUSE_TEXT.upstairs : HOUSE_TEXT.downstairs}`,
    );
  }

  /** Walk in or Step out, by where the camera is going (or is). */
  function renderWalk(): void {
    const inside = walk ? walk.goal === 1 : walkedIn(zoom);
    // The emoji is decoration: screen readers hear just the words.
    walkButton.replaceChildren(
      el(
        'span',
        { class: 'house-walk-icon', 'aria-hidden': 'true' },
        inside ? HOUSE_TEXT.stepOutIcon : HOUSE_TEXT.walkInIcon,
      ),
      ` ${inside ? HOUSE_TEXT.stepOut : HOUSE_TEXT.walkIn}`,
    );
    renderFloor();
  }

  const owner = () => user?.username ?? null;

  function render(): void {
    overlay.hidden = !isOpen;
    if (!isOpen || !view) return;
    top.style.top = `${String(Math.max(0, options.coveredTop?.() ?? 0))}px`;
    pill.textContent = HOUSE_TEXT.pill(view.level);
    peekText.textContent = peekLine(view);
    renderWalk();
    renderSheet();
  }

  /** Opens, folds or moves the sheet; opening it re-reads the house (plan §10: fetch on open). */
  function setSheet(next: HouseSheet): void {
    if (next === sheet || !isOpen) return;
    const from = sheet;
    sheet = next;
    note = '';
    focusNext = focusFor(from, next);
    renderSheet();
    reframeForSheet(from, next);
    if (from === 'peek') void refresh();
  }

  /**
   * Where focus goes when the sheet moves (the HUD behind is inert): the ✕
   * on the Grow sheet, Build it! on the confirm, then back to what opened it.
   */
  function focusFor(from: HouseSheet, to: HouseSheet): string | null {
    switch (to) {
      case 'grow':
        return 'house-grow-close';
      case 'confirm':
        return 'house-grow-yes';
      case 'picker':
      case 'move-out':
        return residentFocus(from, to);
      case 'open':
        if (from === 'picker' || from === 'move-out') return residentFocus(from, to);
        return from === 'peek' ? null : 'house-grow-open';
      case 'peek':
        return from === 'peek' ? null : 'house-peek-handle';
    }
  }

  /** Focuses the sheet's element with this `data-testid`, if it's there and reachable. */
  function focusIn(testid: string): boolean {
    const target = overlay.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
    if (!target?.isConnected || target.hidden || target.closest('[inert], [hidden]')) return false;
    target.focus({ preventScroll: true });
    return true;
  }

  /**
   * Draws the sheet and keeps focus sensible: the target the move asked
   * for, or the same control again when a re-render replaced it.
   */
  function renderSheet(): void {
    const active = document.activeElement;
    const kept =
      active instanceof HTMLElement && peek.contains(active)
        ? (active.dataset['testid'] ?? null)
        : null;
    drawSheet();
    const want = focusNext;
    focusNext = null;
    if (want) {
      if (!focusIn(want)) focusIn('house-peek-handle');
      return;
    }
    const now = document.activeElement;
    if (kept && !(now instanceof HTMLElement && peek.contains(now))) focusIn(kept);
  }

  function drawSheet(): void {
    const current = view;
    const open = sheet !== 'peek';
    const growing = isPage(sheet);
    peek.classList.toggle('house-peek-open', open);
    peek.classList.toggle('house-peek-grow', growing);
    handle.setAttribute('aria-expanded', String(open));
    walkButton.hidden = open;
    renderFloor();
    peekText.hidden = growing;
    // The Grow sheet has its own ✕; the grip comes back with the room line.
    handle.hidden = growing;
    scrim.hidden = !growing;
    for (const behind of [touch, top, walkButton, floorButton]) {
      behind.toggleAttribute('inert', growing);
      if (growing) behind.setAttribute('aria-hidden', 'true');
      else behind.removeAttribute('aria-hidden');
    }
    noteLine.textContent = keepTail(note);
    noteLine.hidden = note === '';
    noteLine.classList.toggle('house-note-calm', noteKind === 'calm');
    head?.remove();
    head = null;
    const next = current?.next ?? null;
    if (!current || sheet === 'peek') {
      sheetBody.replaceChildren();
      return;
    }
    if (sheet === 'picker' || sheet === 'move-out') {
      drawResidentPage(current);
      return;
    }
    if (sheet === 'open' || !next) {
      sheetBody.replaceChildren(
        ...drawBeds(current),
        next
          ? houseButton(
              `${GROW_TEXT.openIcon} ${GROW_TEXT.open}`,
              () => {
                setSheet('grow');
              },
              { class: 'house-grow-open', 'data-testid': 'house-grow-open' },
            )
          : el(
              'p',
              { class: 'house-all-grown', 'data-testid': 'house-all-grown' },
              GROW_TEXT.allGrown,
            ),
      );
      return;
    }
    const [header, ...rest] =
      sheet === 'grow'
        ? growPanel(current, next, {
            onBuild: () => {
              setSheet('confirm');
            },
            onClose: () => {
              setSheet('peek');
            },
          })
        : confirmPanel(current, next, building, {
            onYes: () => void buildNext(),
            onNo: () => {
              setSheet('grow');
            },
          });
    // The header goes above the note line, so the live region never moves.
    if (header) {
      head = header;
      peek.insertBefore(header, noteLine);
    }
    sheetBody.replaceChildren(...rest);
  }

  /** Takes a fresh house: a new level rebuilds the scene with its new room. */
  function applyView(fresh: HouseView): void {
    const grew = view !== null && fresh.level !== view.level;
    // The scene seats residents when it's built: a move (or one home from a job) rebuilds it.
    const recast = view !== null && castKey(fresh) !== castKey(view);
    view = fresh;
    viewAt = Date.now();
    render();
    if (grew) {
      // A new room upstairs: show its floor (B4 review), in the dollhouse.
      const next = floorAfterGrowing(fresh.rooms, fresh.level, floor);
      if (next !== floor) {
        floor = next;
        zoom = 0;
        walk = null;
      }
    }
    if (grew || recast) options.showScene(build);
  }

  /** Re-reads the house (the sheet opened): requirements and the bag move all the time. */
  async function refresh(): Promise<void> {
    const id = mapId;
    if (!id) return;
    const newest = sync.begin();
    const still = () => newest() && isOpen && mapId === id;
    void loadPeople();
    try {
      const fresh = await api.get(id);
      if (still()) applyView(fresh);
    } catch (err) {
      // A refusal the server just gave stays up; a failed re-read doesn't replace it.
      if (!still() || (note !== '' && noteKind === 'calm')) return;
      note = messageOf(err);
      noteKind = 'calm';
      renderSheet();
    }
  }

  /** Build it! confirmed: one build, then the new house (or the server's kind word). */
  async function buildNext(): Promise<void> {
    const id = mapId;
    const toLevel = view?.next?.level;
    if (!id || toLevel === undefined || building) return;
    const fromLevel = view?.level ?? 0;
    building = true;
    sync.drop(); // the build's reply is newer than any read in flight
    renderSheet();
    const outcome = await builder.build(id, toLevel, () => isOpen && mapId === id);
    building = false;
    if (!isOpen || mapId !== id) return;
    if (outcome.kind === 'dropped') {
      renderSheet();
      return;
    }
    if (outcome.kind === 'failed') {
      // Back to the list from the confirm; never reopen a sheet that's folded.
      if (sheet === 'confirm') sheet = 'grow';
      note = outcome.message;
      noteKind = 'calm';
      focusNext = 'house-note';
      renderSheet();
      // What the house needs may have moved (another device, midnight).
      void refresh();
      return;
    }
    // A read sent while building may land after this reply: drop it.
    sync.drop();
    if (sheet !== 'peek') sheet = 'open';
    note = builtLine(outcome.view);
    noteKind = 'ok';
    focusNext = 'house-note';
    // The scene rebuilds first (a heavy frame); the sparkle waits for it.
    celebrate = outcome.view.level > fromLevel;
    applyView(outcome.view);
  }

  // ── Residents (C2b): the beds, the picker, moving in and out ─────────

  /** My squishies as the roster's rows, from the home reply and whatever reads have landed. */
  function remergePeople(): void {
    people = new Map(
      homeData
        ? mergeRoster({ home: homeData, care: careRead, jobs: jobsRead }).map((r) => [r.id, r])
        : [],
    );
  }

  /** Reads moods and away states (the roster's reads) for the beds and the picker; best effort. */
  async function loadPeople(): Promise<void> {
    const id = mapId;
    if (!id) return;
    peopleTicket += 1;
    const mine = peopleTicket;
    const [c, j] = await Promise.allSettled([careCalls.list(id), jobCalls.view(id)]);
    if (mine !== peopleTicket || !isOpen || mapId !== id) return;
    if (c.status === 'fulfilled') careRead = c.value;
    if (j.status === 'fulfilled') jobsRead = j.value;
    remergePeople();
    if (sheet !== 'peek') renderSheet();
  }

  /** The server's clock now, run forward from the house reply (for "Back in 5 h"). */
  const serverNow = (): number =>
    (view ? Date.parse(view.now) : Date.now()) + (viewAt ? Date.now() - viewAt : 0);

  /**
   * A residents page opened or closed: fit the house once (through
   * `panner.fit()`) above the open sheet, or back above the folded one.
   */
  function reframeForSheet(from: HouseSheet, to: HouseSheet): void {
    if (framesAboveSheet(from) !== framesAboveSheet(to)) refit();
  }

  /** The room a residents page is about, as the framing wants it (x only), or null. */
  function pageRoom(): { minX: number; maxX: number } | null {
    const movingOutOf =
      view?.rooms.find((r) => r.residents.some((x) => x.squishyId === chosen))?.id ?? null;
    const id = framedRoomId(sheet, pickRoom, movingOutOf);
    const room = id ? view?.rooms.find((r) => r.id === id) : undefined;
    if (!room) return null;
    const box = roomBox(room);
    return { minX: box.x0, maxX: box.x1 };
  }

  /** Where focus goes when a resident page opens or closes. */
  function residentFocus(from: HouseSheet, to: HouseSheet): string | null {
    if (to === 'picker') return 'house-picker-close';
    if (to === 'move-out') return 'house-move-out-yes';
    // Back on the beds: the room the page was about.
    const room =
      from === 'picker'
        ? pickRoom
        : view?.rooms.find((r) => r.residents.some((x) => x.squishyId === chosen))?.id;
    return room ? `house-room-${room}` : 'house-grow-open';
  }

  /** The open sheet's beds, room by room. */
  function drawBeds(current: HouseView): HTMLElement[] {
    // One room: its bed line ("The Snug · 1 of 2 beds") says it all, so the
    // peek line steps aside while the sheet is open (drawSheet shows it again).
    if (current.rooms.length === 1) peekText.hidden = true;
    return bedsPanel(
      roomBeds(current, people),
      chosen,
      moving,
      {
        onMoveIn: (roomId) => {
          openPicker(roomId, null);
        },
        onChoose: (squishyId) => {
          chosen = chosen === squishyId ? null : squishyId;
          note = '';
          renderSheet();
        },
        onMoveOut: (squishyId) => {
          chosen = squishyId;
          setSheet('move-out');
        },
      },
      options.portraits,
    );
  }

  /** The picker or the move-out confirm, a page of its own like Grow. */
  function drawResidentPage(current: HouseView): void {
    let parts: HTMLElement[];
    if (sheet === 'picker') {
      const picker = pickRoom
        ? pickerFor(current, pickRoom, [...people.values()], serverNow())
        : null;
      if (!picker) {
        sheet = 'open';
        drawSheet();
        return;
      }
      parts = pickerPanel(
        picker,
        moving,
        pickFocus,
        {
          onPick: (squishyId) => void moveSquishy(squishyId, picker.room.id),
          onClose: () => {
            setSheet('open');
          },
        },
        options.portraits,
      );
    } else {
      const who = chosen;
      const name = who ? nameOf(who) : '';
      if (!who) {
        sheet = 'open';
        drawSheet();
        return;
      }
      parts = moveOutPanel(name, RESIDENT_TEXT.moveOutAsk(name, MOVE_BACK_IN_HOURS), moving, {
        onYes: () => void moveSquishy(who, null),
        onNo: () => {
          setSheet('open');
        },
      });
    }
    const [header, ...rest] = parts;
    // The header goes above the note line, so the live region never moves.
    if (header) {
      head = header;
      peek.insertBefore(header, noteLine);
    }
    sheetBody.replaceChildren(...rest);
  }

  /** A squishy's name as the roster says it. */
  const nameOf = (squishyId: string): string => people.get(squishyId)?.name ?? 'Your squishy';

  /** Opens the picker for a room, on one squishy's row when the roster sent it. */
  function openPicker(roomId: string, focus: string | null): void {
    pickRoom = roomId;
    pickFocus = focus;
    chosen = null;
    setSheet('picker');
    if (focus) focusPickRow(focus);
  }

  /** Puts focus on one picker row and scrolls it into view (opened from the roster). */
  function focusPickRow(squishyId: string): void {
    const row = [...peek.querySelectorAll<HTMLElement>('.house-pick')].find(
      (b) => b.dataset['squishy'] === squishyId,
    );
    if (!row) return;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
  }

  /**
   * One tap in the picker (a room) or on Move out (null): one move, then the
   * house it replies with (the scene seats the resident), or the server's
   * kind word. Like a build, it drops every read in flight.
   */
  async function moveSquishy(squishyId: string, roomId: string | null): Promise<void> {
    const id = mapId;
    if (!id || moving) return;
    const name = nameOf(squishyId);
    moving = true;
    sync.drop(); // the move's reply is newer than any read in flight
    note = '';
    renderSheet();
    const outcome = await mover.move(id, squishyId, roomId, () => isOpen && mapId === id);
    moving = false;
    if (!isOpen || mapId !== id) return;
    if (outcome.kind === 'dropped') {
      renderSheet();
      return;
    }
    const was = sheet;
    if (outcome.kind === 'failed') {
      // The picker stays up with the server's kind word; a move-out goes back to the beds.
      if (sheet === 'move-out') sheet = 'open';
      note = outcome.message;
      noteKind = 'calm';
      focusNext = 'house-note';
      renderSheet();
      reframeForSheet(was, sheet);
      // Who can come may have moved (another device, a trade, the Hollow).
      void refresh();
      return;
    }
    // A read sent while moving may land after this reply: drop it.
    sync.drop();
    if (sheet !== 'peek') sheet = 'open';
    note = roomId ? movedLine(outcome.view, name, roomId) : RESIDENT_TEXT.movedOut(name);
    noteKind = 'ok';
    focusNext = 'house-note';
    chosen = null;
    pickFocus = null;
    applyView(outcome.view);
    // Back on the beds: the house fits above the folded sheet again.
    reframeForSheet(was, sheet);
  }

  function playSparkle(): void {
    if (!celebrate || !isOpen) return;
    celebrate = false;
    if (reducedMotion.matches) return;
    sparkles += 1;
    // Over the new room as the camera sees it, above the folded sheet.
    const room = view?.rooms.find((r) => r.level === view?.level) ?? null;
    const pose = base ? (kid ? blend(base, kid, zoom) : base) : null;
    sparkle(overlay, sparkleSpot(pose, room ? roomBox(room) : null, viewport()), false);
  }

  /** The canvas and the bands the HUD covers, for fitting the house between them. */
  function viewport(): HouseViewport {
    const box = overlay.getBoundingClientRect();
    const width = box.width || window.innerWidth;
    const height = box.height || window.innerHeight;
    const topBand = top.getBoundingClientRect().bottom - box.top;
    // The house fits above the folded sheet; an open sheet floats over it.
    if (sheet === 'peek' || foldedBand === 0) {
      const peekTop = peek.getBoundingClientRect().top;
      foldedBand = box.bottom - Math.min(peekTop, walkButton.getBoundingClientRect().top);
      // The folded sheet alone (B4: the yard may run on under Walk in, down to it).
      foldedSheet = box.bottom - peekTop;
    }
    // C2b: a residents page frames the house above its open sheet.
    const bands = sheetBands(
      { bottom: Math.max(0, foldedBand), sheet: Math.max(0, foldedSheet) },
      framesAboveSheet(sheet) ? box.bottom - peek.getBoundingClientRect().top : null,
    );
    return { width, height, top: Math.max(0, topBand), ...bands };
  }

  // ── Camera ────────────────────────────────────────────────────────────

  /** The pose now: the glide while it plays, then the dollhouse with the pinch's zoom. */
  function poseNow(now: number): HousePose | null {
    if (!base) return null;
    if (glide) {
      glide.start ??= now;
      const local = (now - glide.start) / 1000;
      if (local < glide.shot.duration && !reducedMotion.matches) {
        scene3d?.setRoof(roofAt(local, false));
        return glidePose(glide.shot, local, false);
      }
      glide = null;
      scene3d?.setRoof(1);
    }
    if (walk) {
      walk.start ??= now;
      zoom = walkZoom(walk.from, walk.goal, (now - walk.start) / 1000, reducedMotion.matches);
      if (zoom === walk.goal) walk = null;
      renderWalk();
    }
    return kid ? blend(base, kid, zoom) : base;
  }

  /** Puts the camera where it is now and draws; keeps drawing while the glide plays. */
  function draw(): void {
    if (frame !== 0) return;
    frame = requestAnimationFrame(step);
  }

  function step(now: number): void {
    frame = 0;
    const s = scene3d;
    if (!s || !isOpen) return;
    // The governor stepped the tier: rebuild the house for it (lights, shadows, detail).
    if (builtTier !== null && options.tier() !== builtTier) {
      options.showScene(build);
      return;
    }
    // Kid height walks into the Keeper's room, on the ground floor.
    if (floor !== 0 && (zoom > 0 || walk?.goal === 1)) {
      floor = 0;
      s.setFloor(0);
      fit(s);
    }
    const slid = panner.step();
    if (slid) showPan(slid);
    const pose = poseNow(now);
    if (pose) s.setPose(pose, glide ? 0 : clampZoom(zoom));
    renderFloor();
    options.invalidate();
    if (glide || walk) draw();
  }

  /** Refits the dollhouse to the screen (a turn, a resize). */
  function refit(): void {
    if (!isOpen || !scene3d) return;
    fit(scene3d);
    draw();
  }
  window.addEventListener('resize', refit);

  /** The dollhouse and kid-height poses for the screen as it is now. */
  function fit(s: HouseScene): void {
    // B4: a tall phone fits the Keeper's room and drags sideways to the rest.
    showPan(panner.fit());
    const room = s.focusRoom;
    kid = room ? kidPose(room, viewport()) : null;
  }

  /** The dollhouse where the drag has slid it, the chevrons clear of every resident's face. */
  function showPan(frame: PanFrame): void {
    base = frame.base;
    moreLeft.style.top = `${String(frame.cues.left.y0)}px`;
    moreRight.style.top = `${String(frame.cues.right.y0)}px`;
  }

  /** Skips the glide to the dollhouse (a tap, or reduced motion). */
  function skipGlide(): void {
    if (!glide) return;
    glide = null;
    scene3d?.setRoof(1);
    draw();
  }

  // ── Gestures ──────────────────────────────────────────────────────────
  // The touch layer covers the canvas, so the stage's map camera never sees
  // a finger: one finger taps (skips the glide), two pinch the zoom.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { spread: number; zoom: number } | null = null;
  const taps = new TapDetector(() => {
    skipGlide();
  });
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const sample = (e: PointerEvent) => ({
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    t: e.timeStamp,
  });
  touch.addEventListener('pointerdown', (e) => {
    touch.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    taps.pointerDown(sample(e));
    if (pointers.size === 1) panner.down(e.clientX);
    if (pointers.size === 2) {
      skipGlide();
      walk = null;
      pinch = { spread: spread(), zoom };
    }
  });
  touch.addEventListener('pointermove', (e) => {
    const was = pointers.get(e.pointerId);
    if (!was) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // One finger in the dollhouse slides it sideways (a tall phone shows one
    // room or two), gathered and applied once a frame in step().
    if (pointers.size === 1 && zoom === 0 && !walk && panner.move(e.clientX)) {
      skipGlide();
      draw();
    }
    taps.pointerMove(sample(e));
    if (pinch && pointers.size === 2) {
      zoom = pinchZoom(pinch.zoom, pinch.spread, spread());
      renderWalk();
      draw();
    }
  });
  const lift = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (e.type === 'pointercancel') taps.pointerCancel(sample(e));
    else taps.pointerUp(sample(e));
    if (pointers.size === 0) {
      const last = panner.up();
      if (last) {
        showPan(last);
        draw();
      }
    }
    if (pinch && pointers.size < 2) {
      pinch = null;
      if (pinchedOut(zoom)) {
        close();
        return;
      }
      zoom = clampZoom(zoom);
      draw();
    }
  };
  touch.addEventListener('pointerup', lift);
  touch.addEventListener('pointercancel', lift);
  touch.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      skipGlide();
      walk = null;
      zoom -= e.deltaY / HOUSE_CAMERA.wheelPerZoom;
      if (pinchedOut(zoom)) {
        close();
        return;
      }
      zoom = clampZoom(zoom);
      draw();
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if (!isOpen || e.key !== 'Escape') return;
    // While building or moving, the page stays put ("Building…" can't be dismissed).
    if ((building || moving) && sheet !== 'peek') return;
    // Escape steps back one sheet at a time, then leaves the house.
    if (sheet === 'confirm') setSheet('grow');
    else if (sheet === 'grow' || sheet === 'picker' || sheet === 'move-out') setSheet('open');
    else if (sheet === 'open') setSheet('peek');
    else close();
  });

  // ── Scene ─────────────────────────────────────────────────────────────

  const build = (scene: Scene): SceneContent => {
    if (!view) throw new Error('no house to build');
    const tier = options.tier();
    const fresh = builtTier === null;
    builtTier = tier;
    const built = new HouseScene(scene, view, {
      tier,
      registry,
      keeper: options.keeper(),
      keeperWearing: options.keeperWearing?.() ?? [],
      cast,
      signText: owner() ? HOUSE_TEXT.sign(owner() ?? '') : HOUSE_TEXT.yourHouse,
    });
    scene3d = built;
    built.setFloor(floor);
    fit(built);
    renderFloor();
    if (!base) throw new Error('no dollhouse pose');
    // The roof lifts off as you arrive; a rebuild for a new tier doesn't glide again.
    glide = fresh && !reducedMotion.matches ? { shot: entryGlide(base), start: null } : null;
    built.setRoof(glide ? 0 : 1);
    const pose = poseNow(performance.now());
    if (pose) built.setPose(pose, glide ? 0 : clampZoom(zoom));
    scene.onDisposeObservable.addOnce(() => {
      built.dispose();
      if (scene3d === built) scene3d = null;
    });
    // The glide waits for the first real frame (shaders compile first).
    scene.onAfterRenderObservable.addOnce(() => {
      draw();
      playSparkle();
    });
    return built.content;
  };

  async function open(
    id: string,
    home: Pick<HomeResponse, 'squishies' | 'speciesDefs'>,
    how: HouseOpenOptions = {},
  ): Promise<void> {
    if (isOpen) return;
    await gate.open(
      () => api.get(id),
      (fresh) => {
        if (isOpen || options.canOpen?.(id) === false) return;
        show(id, fresh, home);
        openOn(how);
      },
      (err) => {
        options.onProblem(messageOf(err));
      },
    );
  }

  function show(
    id: string,
    fresh: HouseView,
    home: Pick<HomeResponse, 'squishies' | 'speciesDefs'>,
  ): void {
    const species = new Map([...GAME_DATA.species, ...home.speciesDefs].map((s) => [s.id, s]));
    cast = new Map();
    for (const s of home.squishies) {
      const kind = species.get(s.speciesId);
      if (kind) cast.set(s.id, { species: kind, accessory: s.accessory });
    }
    mapId = id;
    view = fresh;
    zoom = 0;
    floor = 0;
    panner.reset();
    walk = null;
    builtTier = null;
    sheet = 'peek';
    note = '';
    foldedBand = 0;
    foldedSheet = 0;
    celebrate = false;
    resetResidents(home);
    isOpen = true;
    options.onOpen(id);
    render();
    options.showScene(build);
  }

  function hide(): void {
    gate.cancel();
    isOpen = false;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    glide = null;
    walk = null;
    pointers.clear();
    pinch = null;
    scene3d = null;
    sheet = 'peek';
    note = '';
    sync.drop();
    celebrate = false;
    resetResidents(null);
    render();
  }

  /** Residents (C2b): a fresh start for the beds and the picker on every open and close. */
  function resetResidents(home: Pick<HomeResponse, 'squishies' | 'speciesDefs'> | null): void {
    homeData = home;
    careRead = null;
    jobsRead = null;
    peopleTicket += 1;
    viewAt = Date.now();
    pickRoom = null;
    pickFocus = null;
    chosen = null;
    remergePeople();
  }

  /** Opened from the roster's "Move into the house": straight to the picker, on that squishy. */
  function openOn(how: HouseOpenOptions): void {
    if (!view || (!how.pick && !how.room)) return;
    const room = how.room ?? roomFor(view);
    if (room) openPicker(room, how.pick ?? null);
  }

  function close(): void {
    if (!isOpen) return;
    const id = mapId;
    hide();
    options.showScene(null);
    if (id) options.onClosed(id);
  }

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      gate.cancel();
      if (isOpen) hide();
      mapId = null;
      view = null;
    },
    open,
    close,
    get mapId() {
      return isOpen ? mapId : null;
    },
    get isOpen() {
      return isOpen;
    },
    get debug(): HouseDebug | null {
      if (!mapId || !view) return null;
      return {
        mapId,
        open: isOpen,
        level: view.level,
        rooms: view.rooms.length,
        pose: glide ? 'glide' : walk ? 'walk' : walkedIn(zoom) ? 'kid' : 'dollhouse',
        zoom,
        scene: scene3d?.stats ?? null,
        faces: scene3d?.faceReport() ?? null,
        sheet,
        building,
        sparkles,
        moving,
        pickRoom: sheet === 'picker' ? pickRoom : null,
        reread: () => {
          void refresh();
        },
      };
    },
  };
}
