import {
  GAME_DATA,
  visualRegistry,
  type CinematicShot,
  type HomeResponse,
  type HouseView,
  type KeeperConfig,
  type PublicUser,
} from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { CueName } from '../audio/cues.js';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { HOME_SHEET } from '../home/home-config.js';
import { afterHandle } from '../home/home-peek.js';
import { speciesMap, squishyName } from '../home/home-view.js';
import { TapDetector } from '../map/tap-detector.js';
import { el, messageOf } from '../ui/dom.js';
import { houseApi, type HouseApi } from './house-api.js';
import { createHouseBuilder } from './house-build.js';
import { createFlicker } from './house-flicker.js';
import { giftPanel, giftPop } from './house-gift.js';
import { createGiftOpener } from './house-gift-open.js';
import {
  giftPeek,
  giftPlacement,
  giftToast,
  placementKey,
  rereadAfterOpen,
  shouldReread,
  wrappedGift,
} from './house-gift-view.js';
import { houseLookNow, sameHouseLook, type HouseLightLook } from './house-light-look.js';
import { localDayIn, welcomeOnce, welcomeStorage, type WelcomeStorage } from './house-welcome.js';
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
  project,
  roofAt,
  walkedIn,
  walkZoom,
  type HousePose,
  type HouseViewport,
} from './house-camera.js';
import { HouseScene, type HouseCastMember, type HouseSceneStats } from './house-scene.js';
import {
  HOUSE_CAMERA,
  HOUSE_FLICKER,
  HOUSE_GIFT,
  HOUSE_LOOK_EVERY_MS,
  HOUSE_SHEET,
  HOUSE_WELCOME,
} from './house-config.js';
import { createOpenGate } from './house-open-gate.js';
import { createHousePan, type PanFrame } from './house-pan.js';
import { GROW_TEXT, HOUSE_TEXT, keepTail, peekLine, WELCOME_TEXT } from './house-view.js';
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
  /** Draws one frame (`Stage.requestFrame`), for the flicker's ticks; `invalidate` if left out. */
  requestFrame?: () => void;
  /** The patch's time zone (the windows follow its clock); read as the house opens. */
  timeZone?: (mapId: string) => string | null;
  /** The clock (the dev gallery pins a time of day). */
  now?: () => Date;
  /** A soft sound for a moment (the audio cue system, #25). */
  cue?: (name: CueName) => void;
  /** Where welcome home remembers the day (localStorage; null: never welcomes). */
  storage?: WelcomeStorage | null;
  /** How long welcome home's line stays, ms (0: until the sheet moves; the gallery's captures). */
  welcomeLineMs?: number;
}

/**
 * The bottom sheet (#381 plan §10.2): folded to the peek bar so the house
 * fills the screen, opened to the room line and Grow the house, the Grow
 * sheet itself, or the build's confirm.
 */
export type HouseSheet = 'peek' | 'open' | 'grow' | 'confirm' | 'gift';

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
  /** Today's gift (#381 H2): its line shows, it's opening, and how many opened this visit. */
  readonly gift: { readonly shown: boolean; readonly opening: boolean; readonly opened: number };
  /** Welcome home showed on this open, and the hops played (none under reduced motion). */
  readonly welcomed: boolean;
  readonly hops: number;
  /** The fire's flicker timer: running now, its rate, and its ticks so far. */
  readonly flicker: { readonly running: boolean; readonly hz: number; readonly ticks: number };
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
  open: (mapId: string, home: Pick<HomeResponse, 'squishies' | 'speciesDefs'>) => Promise<void>;
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
    // The fire's flicker follows it mid-visit: still with reduced motion, back without.
    startFlicker();
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
      return { vp: viewport(), bounds: s.frameBounds, room: s.focusRoom, spots: s.residentSpots };
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
  const opener = createGiftOpener({
    claim: (id, day, key) => api.claimGift(id, day, key),
  });
  const clock = options.now ?? (() => new Date());
  const storage = options.storage === undefined ? welcomeStorage() : options.storage;
  const frameOnce = () => {
    if (options.requestFrame) options.requestFrame();
    else options.invalidate();
  };
  /** Residents' names by squishy id (the gift line names its giver). */
  let names = new Map<string, string>();
  /** The gift is opening (Open it! tapped, no reply yet). */
  let opening = false;
  let opened = 0;
  /** Where the scene drew the gift box (`placementKey`): a new gift means a new scene. */
  let giftDrawn = 'none';
  /** The patch's time zone, read as the house opens (the map's view goes after). */
  let zone: string | null = null;
  /** The patch day the shown house was read on (a new day re-reads it: today's gift). */
  let readDay = '';
  /** The light now (#381 H2): picked as the scene builds and once a minute after. */
  let look: HouseLightLook | null = null;
  let lookTimer: ReturnType<typeof setInterval> | null = null;
  /** Welcome home: still to decide on this open, shown, and the hop still to play. */
  let welcomePending = false;
  let welcomed = false;
  let hopPending = false;
  let hops = 0;
  let welcomeTimer: ReturnType<typeof setTimeout> | null = null;
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  /** The fire's flicker: a slow timer on medium and high while the house shows (house-flicker.ts). */
  const flicker = createFlicker({
    apply: (fire, lamp) => scene3d?.setFlicker(fire, lamp),
    frame: frameOnce,
    hidden,
    onVisibility: (changed) => {
      document.addEventListener('visibilitychange', changed);
      return () => {
        document.removeEventListener('visibilitychange', changed);
      };
    },
  });
  // Back from the background: the clock may have moved on.
  document.addEventListener('visibilitychange', () => {
    if (isOpen && !hidden()) checkLook();
  });

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
  // Today's gift on the peek bar (#381 H2): the button alternative to tapping the box.
  const giftLine = el('button', {
    type: 'button',
    class: 'house-gift-line',
    'data-testid': 'house-gift-line',
  });
  giftLine.hidden = true;
  giftLine.addEventListener('click', () => {
    if (wrappedGift(view)) setSheet('gift');
  });
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
    giftLine,
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
    // While building or opening, the sheet stays put ("Building…" can't be dismissed).
    if (!building && !opening) setSheet('peek');
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
    const line = giftPeek(wrappedGift(view), (id) => names.get(id) ?? null);
    giftLine.textContent = line ?? '';
    giftLine.dataset['gift'] = String(line !== null);
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
      case 'gift':
        return 'house-gift-yes';
      case 'open':
        return from === 'peek' ? null : 'house-grow-open';
      case 'peek':
        return from === 'peek' ? null : from === 'gift' ? 'house-gift-line' : 'house-peek-handle';
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
    // Walk in and the floor switch stand clear of the folded sheet, which
    // grows a row while today's gift or a line waits (#381 H2).
    if (sheet === 'peek' && isOpen) {
      overlay.style.setProperty('--house-peek-clear', `${String(peek.offsetHeight + 24)}px`);
    }
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
    const growing = sheet === 'grow' || sheet === 'confirm';
    // The Grow sheet and the gift card own the screen: the HUD behind dims.
    const modal = growing || sheet === 'gift';
    peek.classList.toggle('house-peek-open', open);
    peek.classList.toggle('house-peek-grow', growing);
    handle.setAttribute('aria-expanded', String(open));
    walkButton.hidden = open;
    renderFloor();
    peekText.hidden = modal;
    giftLine.hidden = modal || giftLine.dataset['gift'] !== 'true';
    // The Grow sheet and the gift card have their own ✕; the grip comes back with the room line.
    handle.hidden = modal;
    scrim.hidden = !modal;
    // The gift card dims the house only a little: the squishies stay bright behind it.
    scrim.classList.toggle('house-scrim-light', sheet === 'gift');
    for (const behind of [touch, top, walkButton, floorButton]) {
      behind.toggleAttribute('inert', modal);
      if (modal) behind.setAttribute('aria-hidden', 'true');
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
    if (sheet === 'gift') {
      const gift = wrappedGift(current);
      if (!gift) {
        sheetBody.replaceChildren();
        return;
      }
      const [header, ...rest] = giftPanel(gift, opening, {
        onOpen: () => void openGift(),
        onClose: () => {
          setSheet('peek');
        },
      });
      if (header) {
        head = header;
        peek.insertBefore(header, noteLine);
      }
      sheetBody.replaceChildren(...rest);
      return;
    }
    if (sheet === 'open' || !next) {
      sheetBody.replaceChildren(
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
    view = fresh;
    readDay = localDayIn(zone, new Date(fresh.now));
    // An opened gift (or none, as a claim of yesterday's replies) folds its card away.
    if (sheet === 'gift' && !opening && !wrappedGift(fresh)) {
      sheet = 'peek';
      focusNext ??= 'house-peek-handle';
    }
    render();
    if (!grew) {
      syncGift(fresh);
      return;
    }
    // A new room upstairs: show its floor (B4 review), in the dollhouse.
    const next = floorAfterGrowing(fresh.rooms, fresh.level, floor);
    if (next !== floor) {
      floor = next;
      zoom = 0;
      walk = null;
    }
    options.showScene(build);
  }

  /**
   * Keeps the scene's gift box in step with the house: an opened gift (or
   * none) folds the box away; a new one (tomorrow's, on a screen left open)
   * builds the scene again with it.
   */
  function syncGift(fresh: HouseView): void {
    const key = placementKey(giftPlacement(fresh, (id) => cast.has(id)));
    if (key === giftDrawn || !scene3d) return;
    if (key === 'none') {
      scene3d.removeGift();
      giftDrawn = 'none';
      draw();
      return;
    }
    options.showScene(build);
  }

  /** Where the gift box is on screen (CSS px), or null: none drawn, or behind the camera. */
  function giftOnScreen(): { x: number; y: number } | null {
    const at = scene3d?.giftPoint ?? null;
    if (!at || !base || glide) return null;
    const pose = kid ? blend(base, kid, zoom) : base;
    const vp = viewport();
    if (vp.width <= 0 || vp.height <= 0) return null;
    const p = project(pose, vp.width / vp.height, at);
    if (!(p.depth > 0) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return { x: ((p.x + 1) / 2) * vp.width, y: ((1 - p.y) / 2) * vp.height };
  }

  /** A tap on the box (CSS px from the screen's top left). */
  function giftHit(x: number, y: number): boolean {
    if (sheet !== 'peek' && sheet !== 'open') return false;
    if (!wrappedGift(view)) return false;
    const at = giftOnScreen();
    const box = overlay.getBoundingClientRect();
    return (
      at !== null && Math.hypot(x - box.left - at.x, y - box.top - at.y) <= HOUSE_GIFT.tapRadius
    );
  }

  /** Open it!: one claim, then the unwrap (or the server's kind word, as given). */
  async function openGift(): Promise<void> {
    const id = mapId;
    const gift = wrappedGift(view);
    if (!id || !gift || opening) return;
    opening = true;
    sync.drop(); // the claim's reply is newer than any read in flight
    renderSheet();
    const outcome = await opener.open(id, gift.day, () => isOpen && mapId === id);
    opening = false;
    if (!isOpen || mapId !== id) return;
    if (outcome.kind === 'dropped') {
      renderSheet();
      return;
    }
    if (outcome.kind === 'failed') {
      note = outcome.message;
      noteKind = 'calm';
      focusNext = 'house-note';
      renderSheet();
      // Opened on another device, or the day moved on: read what's true now.
      void refresh();
      return;
    }
    // A read sent while opening may land after this reply: drop it.
    sync.drop();
    opened += 1;
    // The box pops where it stood, then it's gone.
    const at = giftOnScreen();
    if (at) giftPop(overlay, at, reducedMotion.matches);
    options.cue?.('pop');
    scene3d?.removeGift();
    giftDrawn = 'none';
    sheet = 'peek';
    note = giftToast(gift);
    noteKind = 'ok';
    focusNext = 'house-note';
    applyView(outcome.view);
    // The gift line went: the folded sheet is a row shorter, so the house refits.
    refit();
    // Yesterday's gift opened after midnight: today's rolls on the next read (its ticket is newer).
    if (rereadAfterOpen(gift, outcome.view, localDayIn(zone, clock()))) void refresh();
  }

  /** Re-reads the house (the sheet opened): requirements and the bag move all the time. */
  async function refresh(): Promise<void> {
    const id = mapId;
    if (!id) return;
    const newest = sync.begin();
    const still = () => newest() && isOpen && mapId === id;
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
    return {
      width,
      height,
      top: Math.max(0, topBand),
      bottom: Math.max(0, foldedBand),
      sheet: Math.max(0, foldedSheet),
    };
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
    // Welcome home's hop, once the roof is off.
    if (hopPending && !glide) {
      hopPending = false;
      if (s.hop(now)) {
        hops += 1;
        options.cue?.('boop');
      }
    }
    const moving = s.update(now);
    options.invalidate();
    if (glide || walk || moving) draw();
  }

  /** The fire flickers on a slow timer on medium and high (never on low, nor with reduced motion). */
  function startFlicker(): void {
    const s = scene3d;
    const tier = builtTier;
    if (!isOpen || !s || tier === null) return;
    flicker.start(s.flickers && !reducedMotion.matches ? HOUSE_FLICKER.hz[tier] : 0);
  }

  /** The light at this moment on the patch's clock. */
  const lookNow = (): HouseLightLook => houseLookNow(zone, clock());

  /** Once a minute (and back from the background): a new time of day relights the house. */
  function checkLook(): void {
    if (!isOpen || !scene3d) return;
    // A new patch day since the house was read: today's gift rolls on a read.
    if (shouldReread({ readDay, today: localDayIn(zone, clock()), busy: building || opening }))
      void refresh();
    const next = lookNow();
    if (look && sameHouseLook(next, look)) return;
    look = next;
    scene3d.setLook(next);
    frameOnce();
  }

  /**
   * Welcome home, the first time the house opens on a patch day (decided
   * once per open, after the first frame): the line, and a hop unless
   * reduced motion is on.
   */
  function greet(): void {
    const id = mapId;
    if (!welcomePending || !isOpen || !id) return;
    welcomePending = false;
    if (!welcomeOnce(storage, id, localDayIn(zone, clock()))) return;
    welcomed = true;
    hopPending = !reducedMotion.matches;
    if (note === '') {
      note = WELCOME_TEXT.line;
      noteKind = 'ok';
      renderSheet();
      if (welcomeTimer !== null) clearTimeout(welcomeTimer);
      const lineMs = options.welcomeLineMs ?? HOUSE_WELCOME.lineMs;
      if (lineMs > 0) {
        welcomeTimer = setTimeout(() => {
          welcomeTimer = null;
          if (!isOpen || note !== WELCOME_TEXT.line) return;
          note = '';
          renderSheet();
        }, lineMs);
      }
    }
    draw();
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
  const taps = new TapDetector((x, y) => {
    skipGlide();
    // A tap on the gift box opens its card (the peek bar's line does too).
    if (giftHit(x, y)) setSheet('gift');
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
    // While building or opening, the sheet stays put ("Building…" can't be dismissed).
    if ((building || opening) && sheet !== 'peek') return;
    // Escape steps back one sheet at a time, then leaves the house.
    if (sheet === 'gift') setSheet('peek');
    else if (sheet === 'confirm') setSheet('grow');
    else if (sheet === 'grow') setSheet('open');
    else if (sheet === 'open') setSheet('peek');
    else close();
  });

  // ── Scene ─────────────────────────────────────────────────────────────

  const build = (scene: Scene): SceneContent => {
    if (!view) throw new Error('no house to build');
    const tier = options.tier();
    const fresh = builtTier === null;
    builtTier = tier;
    look = lookNow();
    const gift = giftPlacement(view, (id) => cast.has(id));
    giftDrawn = placementKey(gift);
    const built = new HouseScene(scene, view, {
      tier,
      registry,
      keeper: options.keeper(),
      keeperWearing: options.keeperWearing?.() ?? [],
      cast,
      signText: owner() ? HOUSE_TEXT.sign(owner() ?? '') : HOUSE_TEXT.yourHouse,
      look,
      gift,
    });
    scene3d = built;
    startFlicker();
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
      greet();
    });
    return built.content;
  };

  async function open(
    id: string,
    home: Pick<HomeResponse, 'squishies' | 'speciesDefs'>,
  ): Promise<void> {
    if (isOpen) return;
    await gate.open(
      () => api.get(id),
      (fresh) => {
        if (isOpen || options.canOpen?.(id) === false) return;
        show(id, fresh, home);
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
    const known = speciesMap(home);
    names = new Map(home.squishies.map((s) => [s.id, squishyName(s, known)]));
    // Before onOpen: the map's view (and its time zone) steps out with it.
    zone = options.timeZone?.(id) ?? null;
    mapId = id;
    view = fresh;
    readDay = localDayIn(zone, new Date(fresh.now));
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
    opening = false;
    welcomePending = true;
    welcomed = false;
    hopPending = false;
    giftDrawn = 'none';
    isOpen = true;
    if (lookTimer !== null) clearInterval(lookTimer);
    lookTimer = setInterval(checkLook, HOUSE_LOOK_EVERY_MS);
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
    // Nothing ticks once the house is gone: the flicker, the clock, the welcome line.
    flicker.stop();
    if (lookTimer !== null) clearInterval(lookTimer);
    lookTimer = null;
    if (welcomeTimer !== null) clearTimeout(welcomeTimer);
    welcomeTimer = null;
    welcomePending = false;
    hopPending = false;
    render();
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
        gift: {
          shown: isOpen && !giftLine.hidden,
          opening,
          opened,
        },
        welcomed,
        hops,
        flicker: { running: flicker.running, hz: flicker.hz, ticks: flicker.ticks },
        reread: () => {
          void refresh();
        },
      };
    },
  };
}
