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
  pinchedOut,
  pinchZoom,
  residentBoxes,
  project,
  roofAt,
  screenToFloor,
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
  HOUSE_WALK,
  HOUSE_WELCOME,
} from './house-config.js';
import type { RoomBox } from './house-layout.js';
import {
  copyPose,
  createFollowPose,
  easePose,
  floorAt,
  followPose,
  roomAt,
  slideStep,
  standingFloor,
  startSpot,
  type WalkSpot,
} from './house-walk.js';
import { keeperTapped, stepToward, stickToFloor, type FloorStep } from './house-walk-input.js';
import { createOpenGate } from './house-open-gate.js';
import {
  frameKey,
  framedRoomId,
  framesAboveSheet,
  sheetBands,
  type FrameState,
} from './house-frame.js';
import { createHousePan, type PanFrame } from './house-pan.js';
import {
  GROW_TEXT,
  HOUSE_TEXT,
  keepTail,
  peekLine,
  RESIDENT_TEXT,
  WELCOME_TEXT,
} from './house-view.js';
import { careApi, type CareApi } from '../care/care-api.js';
import { EXPLORE_VIEW } from '../explore/explore-config.js';
import { joystickVector } from '../explore/explore-view.js';
import { faceYaw } from '../procedural/face-yaw.js';
import type { Portraits } from '../procedural/portraits.js';
import { jobsApi, type JobsApi } from '../squishies/jobs/jobs-api.js';
import { mergeRoster, type RosterRow } from '../squishies/roster/roster-view.js';
import { createResidentMover, houseBusy } from './house-move.js';
import {
  bedsPanel,
  faceEl,
  facesNow,
  facesWaiting,
  moveOutPanel,
  pickerPanel,
  stopFaces,
} from './house-residents.js';
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
 * fills the screen, opened to the rooms' beds and Grow the house, the Grow
 * sheet itself, the build's confirm, the move-in picker (C2b) or the
 * move-out confirm.
 */
export type HouseSheet = 'peek' | 'open' | 'grow' | 'confirm' | 'gift' | 'picker' | 'move-out';

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
  /** The Keeper's middle on screen (CSS px), or null: none drawn, or behind the camera (a tap there walks in). */
  readonly keeper: { readonly x: number; readonly y: number } | null;
  /** The floor the cut shows (W3: walked in, the Keeper's, up and down the stairs). */
  readonly floor: number;
  /**
   * The Keeper's walk (#381 W2): where it stands and its room, which way it
   * faces, the stick held or a tapped spot it's walking to, and the follow
   * camera's eye.
   */
  readonly walk: {
    readonly room: string | null;
    readonly at: { readonly x: number; readonly y: number; readonly z: number };
    readonly yaw: number;
    readonly stick: boolean;
    readonly walkingTo: boolean;
    readonly eye: { readonly x: number; readonly y: number; readonly z: number } | null;
  } | null;
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
  /** Squishy pictures on the sheet still being drawn (0: every face is drawn or flat). */
  readonly facesWaiting: number;
  /** Each drawn resident on screen (CSS px), and the sheet's top edge, for the shots' check. */
  readonly residentBoxes: readonly { x0: number; x1: number; y0: number; y1: number }[];
  readonly sheetTop: number;
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
  /**
   * Puts the Keeper in a room (where `startSpot` stands it). Dev hook only:
   * e2e and the shots walk in other rooms. `on` picks the spot (else where
   * `startSpot` stands it), `on.y` a floor above the room's own (the Hall's
   * gallery and walkway, W3), `on.yaw` which way it faces (else straight in).
   * False: no such room, or no floor free there.
   */
  readonly putKeeper: (
    roomId: string,
    on?: { x: number; z: number; y?: number; yaw?: number },
  ) => boolean;
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
  /** 0 the dollhouse, 1 kid height: walked in, the camera following the Keeper. */
  let zoom = 0;
  /** The floor the dollhouse shows (kid height walks in on the ground floor). */
  let floor = 0;
  /** Walk in or Step out under way: from where, to where, since when (ms). */
  let walk: { from: number; goal: number; start: number | null } | null = null;
  // ── The Keeper's walk (#381 W2) ──
  // Walked in, the camera follows the Keeper (house-walk.ts `followPose`)
  // and a drag anywhere is a joystick, or a tap on the floor walks there.
  // The Keeper's spot and the camera's poses are updated in place; a walk
  // frame makes no more than the stick's small vector.
  /** Where the Keeper stands (a copy of the scene's, moved by the walk), and which way it faces. */
  const walkAt: WalkSpot = { x: 0, z: 0, y: 0 };
  let walkYaw = Math.PI;
  /** The Keeper's room; kept while it's in a doorway (no room). */
  let walkRoom: RoomBox | null = null;
  /** Where the follow camera wants to be, and where it is (easing after it). */
  const walkGoal = createFollowPose();
  const walkCam = createFollowPose();
  /** The follow camera is set for this scene and screen (false: work it out afresh). */
  let walkReady = false;
  /** The last walk frame (ms), or null: the next one starts from rest. */
  let walkLast: number | null = null;
  /** A one-finger press while walked in: where it landed, and whether it moved past a tap. */
  let press: { id: number; x: number; y: number; moved: boolean } | null = null;
  /** The joystick: where the drag steers from, and the finger. */
  let stick: { x0: number; y0: number; x: number; y: number } | null = null;
  /** A tapped spot on the floor the Keeper walks to, the nearest it has got, and for how long no nearer. */
  let walkTo: FloorStep | null = null;
  let walkBest = Infinity;
  let walkStall = 0;
  /** Scratch for a walk frame's step. */
  const push: FloorStep = { x: 0, z: 0 };
  const stride: FloorStep = { x: 0, z: 0 };
  /** Where the Keeper was left (a rebuild for a new tier or a new room puts it back there). */
  const keptAt: WalkSpot = { x: 0, z: 0, y: 0 };
  let keptYaw = 0;
  let kept = false;
  /** The last walk frame moved something (a finger resting on the stick draws nothing). */
  let walkChanged = false;
  /** Something asked for a frame (`draw`), not just the walk reading a held stick. */
  let asked = false;
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
  /** The device day we last re-read for: a device clock a day off the server's asks once (B5). */
  let rereadFor = '';
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
  /** The room a squishy just moved into (or out of), framed while its line shows. */
  let movedRoom: string | null = null;
  /** What the last fit framed (`frameKey`): the house refits only when it changes. */
  let lastFrame = '';

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
  // The joystick (#381 W2), bottom left while walked in, as explore's: a drag
  // anywhere steers from where it landed, one on the ring from its middle.
  const stickBase = el('div', {
    class: 'house-stick',
    'aria-hidden': 'true',
    'data-testid': 'house-stick',
  });
  const stickKnob = el('div', { class: 'house-stick-knob' });
  stickBase.append(stickKnob);
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
    // While building, opening or moving, the page stays put ("Building…" can't be dismissed).
    if (!houseBusy({ building, opening, moving })) setSheet('peek');
  });
  const overlay = el(
    'div',
    { class: 'house', 'data-testid': 'house', role: 'dialog', 'aria-label': HOUSE_TEXT.yourHouse },
    touch,
    stickBase,
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
  // The sheet's buttons ring only when focus came from the keyboard, so a page
  // opened by a tap never shows a ring on its ✕ (C2b render check): one look.
  window.addEventListener('keydown', () => {
    overlay.classList.add('house-keys');
  });
  window.addEventListener('pointerdown', () => {
    overlay.classList.remove('house-keys');
  });
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
    walkInOut();
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
    // The joystick shows once walked in, the sheet folded (it's the bottom left's then).
    stickBase.hidden = !walkingNow() || sheet !== 'peek';
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
    // The `?fps=1` stats badge keeps below the Back button and the room pill (#381 W2, house.css).
    document.documentElement.style.setProperty(
      '--house-top-clear',
      `${String(Math.round(top.getBoundingClientRect().bottom))}px`,
    );
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
    // A page over the house lets go of the walk.
    if (next !== 'peek') dropWalkInput();
    note = '';
    movedRoom = null;
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
      case 'picker':
      case 'move-out':
        return residentFocus(from, to);
      case 'gift':
        return 'house-gift-yes';
      case 'open':
        if (from === 'picker' || from === 'move-out') return residentFocus(from, to);
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
    reframe();
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
    // A page of its own (Grow, its confirm, the residents' pages): taller on iPad.
    const growing = isPage(sheet);
    // The pages and the gift card own the screen: the HUD behind dims.
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
    if (sheet === 'picker' || sheet === 'move-out') {
      drawResidentPage(current);
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
        ...drawBeds(current),
        // While a resident's bed is opened, the sheet is about them: Grow waits.
        ...(chosen !== null
          ? []
          : [
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
            ]),
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
    readDay = localDayIn(zone, new Date(fresh.now));
    // An opened gift (or none, as a claim of yesterday's replies) folds its card away.
    if (sheet === 'gift' && !opening && !wrappedGift(fresh)) {
      sheet = 'peek';
      focusNext ??= 'house-peek-handle';
    }
    render();
    if (!grew) {
      // A move (or one home from a job) rebuilds the scene, its gift box with it.
      if (recast) options.showScene(build);
      else syncGift(fresh);
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
    const pose = posed(base);
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
   * The squishy pictures on the sheet wait for the house's first frame, so
   * they don't fight its shaders for the engine at the start (a draw that
   * gives up costs a retry). Reset on every open.
   */
  let houseDrawn: () => void = () => undefined;
  let drawnOnce = new Promise<void>((resolve) => {
    houseDrawn = resolve;
  });
  const sheetPortraits: Portraits | undefined = options.portraits && {
    get: (look) => {
      // A request from a house that has closed since answers nothing (no draw).
      const asked = facesNow();
      return drawnOnce.then(() =>
        asked === facesNow() ? (options.portraits?.get(look) ?? null) : null,
      );
    },
  };
  /** A new open: pictures wait for this house's first frame again. */
  function awaitFirstFrame(): void {
    drawnOnce = new Promise<void>((resolve) => {
      houseDrawn = resolve;
    });
  }

  /** Scrolls the sheet so `node` shows to its bottom edge, with the sheet's padding under it. */
  function revealInSheet(node: Element | null): void {
    if (!node?.isConnected) return;
    const room = 16; // TUNE: the sheet's bottom padding and a little air
    const gap = node.getBoundingClientRect().bottom + room - peek.getBoundingClientRect().bottom;
    if (gap > 0) peek.scrollTop += gap;
  }

  /** What the sheet points at, for the framing (house-frame.ts). */
  function frameState(): FrameState {
    const chosenRoom =
      view?.rooms.find((r) => r.residents.some((x) => x.squishyId === chosen))?.id ?? null;
    return { sheet, pickRoom, chosenRoom, movedRoom };
  }

  /** The sheet's height as it stands now (CSS px from the screen's bottom). */
  function sheetHeight(): number {
    return overlay.getBoundingClientRect().bottom - peek.getBoundingClientRect().top;
  }

  /**
   * The sheet now points at another room, at none, or grew a step: fit the
   * house once (through `panner.fit()`) above it, or back above the folded
   * sheet. Never per frame.
   */
  function reframe(): void {
    const key = isOpen ? frameKey(frameState(), sheetHeight()) : '';
    if (key === lastFrame) return;
    lastFrame = key;
    refit();
  }

  /** The room the sheet is about, as the framing wants it (x only), or null. */
  function pageRoom(): { minX: number; maxX: number } | null {
    const id = framedRoomId(frameState());
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
          movedRoom = null;
          renderSheet();
          // The opened detail shows whole, its edge clear of the sheet's bottom (once, as it opens).
          if (chosen) {
            requestAnimationFrame(() => {
              revealInSheet(peek.querySelector('[data-testid="house-bed-detail"]'));
            });
          }
        },
        onMoveOut: (squishyId) => {
          chosen = squishyId;
          setSheet('move-out');
        },
      },
      sheetPortraits,
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
            if (!moving) setSheet('open');
          },
        },
        sheetPortraits,
      );
    } else {
      const who = chosen;
      const name = who ? nameOf(who) : '';
      if (!who) {
        sheet = 'open';
        drawSheet();
        return;
      }
      parts = moveOutPanel(
        name,
        RESIDENT_TEXT.moveOutAsk(null, MOVE_BACK_IN_HOURS),
        moving,
        {
          onYes: () => void moveSquishy(who, null),
          onNo: () => {
            setSheet('open');
          },
        },
        faceEl(people.get(who) ?? null, sheetPortraits),
      );
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
    if (outcome.kind === 'failed') {
      // The picker stays up with the server's kind word; a move-out goes back to the beds.
      if (sheet === 'move-out') sheet = 'open';
      note = outcome.message;
      noteKind = 'calm';
      focusNext = 'house-note';
      renderSheet();
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
    // The success frames the room it was about, above the sheet as it now stands.
    movedRoom =
      roomId ??
      view?.rooms.find((r) => r.residents.some((x) => x.squishyId === squishyId))?.id ??
      null;
    chosen = null;
    pickFocus = null;
    applyView(outcome.view);
  }

  function playSparkle(): void {
    if (!celebrate || !isOpen) return;
    celebrate = false;
    if (reducedMotion.matches) return;
    sparkles += 1;
    // Over the new room as the camera sees it, above the folded sheet.
    const room = view?.rooms.find((r) => r.level === view?.level) ?? null;
    const pose = base ? posed(base) : null;
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
      framesAboveSheet(frameState()) ? box.bottom - peek.getBoundingClientRect().top : null,
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
    return posed(base);
  }

  /** The dollhouse pose `doll` blended toward the follow camera by the zoom (the dollhouse itself at 0). */
  function posed(doll: HousePose): HousePose {
    const s = scene3d;
    if (zoom <= 0 || !s) return doll;
    return blend(doll, followCam(s), zoom);
  }

  /** Puts the camera where it is now and draws; keeps drawing while the glide plays. */
  function draw(): void {
    asked = true;
    if (frame !== 0) return;
    frame = requestAnimationFrame(step);
  }

  function step(now: number): void {
    frame = 0;
    const wasAsked = asked;
    asked = false;
    const s = scene3d;
    if (!s || !isOpen) return;
    // The governor stepped the tier: rebuild the house for it (lights, shadows, detail).
    if (builtTier !== null && options.tier() !== builtTier) {
      options.showScene(build);
      return;
    }
    const slid = panner.step();
    if (slid) showPan(slid);
    const walking = stepWalk(s, now);
    // Walking in shows the Keeper's floor, wherever it was left, and the cut
    // follows it up and down the stairs (W3).
    let cut = false;
    if (zoom > 0 || walk?.goal === 1) {
      const at = keeperFloor(s);
      if (floor !== at) {
        floor = at;
        s.setFloor(at);
        cut = true;
        // Walked in (or pinching), only the dollhouse pose under it is framed
        // afresh (for Step out): the follow camera doesn't jump.
        if (walkReady) showPan(panner.fit());
        else fit(s);
      }
    }
    const pose = poseNow(now);
    if (pose) s.setPose(pose, glide ? 0 : clampZoom(zoom));
    // Stepped all the way out: the dollhouse frames the Keeper's first room again.
    if (zoom <= 0 && !walk && !pinch && walkReady) {
      walkReady = false;
      s.setWalkFocus(null);
      fit(s);
    }
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
    walkChanged ||= Boolean(slid) || cut;
    // Only a change draws: a finger resting on the stick, or pushing the
    // Keeper into a wall, moves nothing.
    if (wasAsked || glide || walk || moving || walkChanged) options.invalidate();
    walkChanged = false;
    if (glide || walk || moving) draw();
    else if (walking && frame === 0) frame = requestAnimationFrame(step);
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
    const today = localDayIn(zone, clock());
    if (
      shouldReread({
        readDay,
        today,
        busy: houseBusy({ building, opening, moving }),
        askedFor: rereadFor,
      })
    ) {
      rereadFor = today;
      void refresh();
    }
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

  /** The dollhouse pose for the screen as it is now (the follow camera is worked out afresh). */
  function fit(s: HouseScene): void {
    // B4: a tall phone fits the Keeper's room and drags sideways to the rest.
    showPan(panner.fit());
    if (walkReady) {
      // A turn or a resize mid-walk: the camera jumps to its new frame.
      followGoal(s);
      copyPose(walkCam, walkGoal);
    }
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

  // ── The Keeper's walk (#381 W2) ───────────────────────────────────────

  /** Walked all the way in and settled: the stick and floor taps walk the Keeper. */
  const walkingNow = (): boolean => zoom >= 1 && !walk && !pinch && !glide;

  /** The Keeper's room, or the one it was last in (a doorway is no room), or the first. */
  function keeperRoom(s: HouseScene): RoomBox | null {
    const map = s.walkMap;
    walkRoom = roomAt(map, walkAt) ?? walkRoom ?? map.rooms[0] ?? null;
    return walkRoom;
  }

  /** The floor the Keeper stands on, by its height: the Hall's gallery is upstairs. */
  function keeperFloor(s: HouseScene): number {
    if (!walkReady) syncKeeper(s);
    return standingFloor(walkAt.y, floor);
  }

  /** Takes the scene's Keeper as the walk's (it's where the scene put it, or where it was left). */
  function syncKeeper(s: HouseScene): void {
    const at = s.keeperSpot;
    walkAt.x = at.x;
    walkAt.z = at.z;
    walkAt.y = at.y;
    walkYaw = s.keeperYaw;
  }

  /** Where the follow camera wants to be now, into `walkGoal`; the room's front walls fade toward the Keeper. */
  function followGoal(s: HouseScene): void {
    const room = keeperRoom(s);
    if (!room) return;
    const vp = viewport();
    const aspect = vp.width / Math.max(1, vp.height);
    followPose(walkGoal, s.walkMap, walkAt, walkYaw, room, aspect);
    s.setWalkFocus(room);
  }

  /**
   * The follow camera, the pose Walk in (or a pinch) glides into: on the
   * first ask after the dollhouse it's worked out where the Keeper stands,
   * so the glide lands right behind it.
   */
  function followCam(s: HouseScene): HousePose {
    if (!walkReady) {
      syncKeeper(s);
      followGoal(s);
      copyPose(walkCam, walkGoal);
      walkReady = true;
    }
    return walkCam;
  }

  /**
   * One walk frame: the stick or a tapped spot moves the Keeper (sliding
   * along walls and round furniture), it hops as it goes, and the camera
   * eases after it. True: keep drawing. Standing still, nothing runs.
   */
  function stepWalk(s: HouseScene, now: number): boolean {
    if (!walkReady) {
      walkLast = null;
      return false;
    }
    // Only walked all the way in do the stick and taps walk; a hop under way still lands.
    const input = walkingNow();
    const dt = Math.min(EXPLORE_VIEW.maxFrameStep, Math.max(0, (now - (walkLast ?? now)) / 1000));
    walkLast = now;
    const map = s.walkMap;
    const step = HOUSE_WALK.speed * dt;
    let walking = false;
    let moved = false;
    let yaw = walkYaw;
    if (input && stick) {
      const v = joystickVector(stick.x - stick.x0, stick.y - stick.y0);
      push.x = v.x;
      push.z = v.z;
      if (push.x !== 0 || push.z !== 0) {
        stickToFloor(stride, push, walkCam);
        moved = slideStep(map, walkAt, stride.x * step, stride.z * step);
        // Faces the way the stick points, even pressed against a wall.
        yaw = faceYaw(stride.x, stride.z);
      }
      walking = true; // keep reading the stick while it's held
    } else if (input && walkTo) {
      if (stepToward(stride, walkAt, walkTo, step)) {
        moved = slideStep(map, walkAt, stride.x, stride.z);
        if (moved) yaw = faceYaw(stride.x, stride.z);
      }
      const left = Math.hypot(walkTo.x - walkAt.x, walkTo.z - walkAt.z);
      // Sliding round a bed is progress; going nowhere for a moment is not.
      if (left < walkBest - 1e-3) {
        walkBest = left;
        walkStall = 0;
      } else {
        walkStall += dt;
      }
      if (left <= HOUSE_WALK.arrive || walkStall > HOUSE_WALK.giveUp) walkTo = null;
      else walking = true;
    }
    const turned = yaw !== walkYaw;
    if (moved || turned) {
      walkYaw = yaw;
      s.moveKeeper(walkAt, yaw);
      keep(walkAt, yaw);
      followGoal(s);
    }
    easePose(walkCam, walkGoal, dt);
    const easing =
      Math.abs(walkCam.eye.x - walkGoal.eye.x) +
        Math.abs(walkCam.eye.y - walkGoal.eye.y) +
        Math.abs(walkCam.eye.z - walkGoal.eye.z) +
        Math.abs(walkCam.target.x - walkGoal.target.x) +
        Math.abs(walkCam.target.y - walkGoal.target.y) +
        Math.abs(walkCam.target.z - walkGoal.target.z) >
      HOUSE_WALK.settled;
    // Settled: land on the goal exactly, so the next frame has nothing to do.
    if (!easing) copyPose(walkCam, walkGoal);
    const hopping = s.stepWalk(dt, reducedMotion.matches);
    walkChanged = moved || turned || easing || hopping;
    const busy = walking || walkChanged;
    if (!busy) walkLast = null;
    return busy;
  }

  /** Remembers where the Keeper was left. */
  function keep(at: Readonly<WalkSpot>, yaw: number): void {
    keptAt.x = at.x;
    keptAt.z = at.z;
    keptAt.y = at.y;
    keptYaw = yaw;
    kept = true;
  }

  /** The knob follows the drag inside the joystick's ring. */
  function showStick(): void {
    stickBase.classList.toggle('house-stick-on', stick !== null);
    if (!stick) {
      stickKnob.style.transform = '';
      return;
    }
    const r = EXPLORE_VIEW.joystick.radius;
    const dx = stick.x - stick.x0;
    const dy = stick.y - stick.y0;
    const d = Math.hypot(dx, dy);
    const k = d > r ? r / d : 1;
    stickKnob.style.transform = `translate(${String(dx * k)}px, ${String(dy * k)}px)`;
  }

  /** Where a drag steers from: the joystick's middle if it landed on the ring, else where it landed. */
  function stickOrigin(x: number, y: number): { x: number; y: number } {
    const ring = stickBase.getBoundingClientRect();
    const cx = ring.left + ring.width / 2;
    const cy = ring.top + ring.height / 2;
    const r = ring.width / 2;
    return !stickBase.hidden && (x - cx) ** 2 + (y - cy) ** 2 <= r * r
      ? { x: cx, y: cy }
      : { x, y };
  }

  /** Lets go of the stick and any tapped spot (a pinch, Step out, a page over the house). */
  function dropWalkInput(): void {
    press = null;
    stick = null;
    walkTo = null;
    showStick();
  }

  /** Walk in, or Step out (the button, or a tap on the Keeper). */
  function walkInOut(): void {
    skipGlide();
    dropWalkInput();
    walk = { from: zoom, goal: walkedIn(zoom) ? 0 : 1, start: null };
    renderWalk();
    draw();
  }

  /** Where the Keeper's middle is on screen now (CSS px), or null. */
  function keeperOnScreen(): { x: number; y: number } | null {
    const s = scene3d;
    if (!s || !base || s.keeperHeight <= 0) return null;
    const box = overlay.getBoundingClientRect();
    const w = Math.max(1, box.width);
    const h = Math.max(1, box.height);
    const at = s.keeperSpot;
    const p = project(posed(base), w / h, { x: at.x, y: at.y + s.keeperHeight / 2, z: at.z });
    if (!(p.depth > 0)) return null;
    return { x: box.left + ((p.x + 1) / 2) * w, y: box.top + ((1 - p.y) / 2) * h };
  }

  /** A tap on the Keeper in the dollhouse (CSS px from the screen's top left). */
  function keeperHit(x: number, y: number): boolean {
    const s = scene3d;
    if (!s || !base || glide || zoom > 0 || walk || s.keeperHeight <= 0) return false;
    // Upstairs shown, a ground-floor Keeper is cut away: nothing there to tap.
    if (floor !== keeperFloor(s)) return false;
    const box = overlay.getBoundingClientRect();
    const vp = { width: box.width, height: box.height };
    return keeperTapped(base, vp, s.keeperSpot, s.keeperHeight, x - box.left, y - box.top);
  }

  /** A tap on the floor while walked in: the Keeper walks there (it stops at a wall or a bed). */
  function tapFloor(x: number, y: number): boolean {
    if (!walkingNow() || !walkReady) return false;
    const box = overlay.getBoundingClientRect();
    const vp = { width: box.width, height: box.height };
    const at = screenToFloor(walkCam, x - box.left, y - box.top, vp, walkAt.y);
    if (!at) return false;
    walkTo = { x: at.x, z: at.z };
    walkBest = Infinity;
    walkStall = 0;
    draw();
    return true;
  }

  /** Dev hook: the Keeper put in a room (or on a spot in it), as the walk would leave it there. */
  function putKeeper(
    roomId: string,
    on?: { x: number; z: number; y?: number; yaw?: number },
  ): boolean {
    const s = scene3d;
    const room = s?.walkMap.rooms.find((r) => r.id === roomId);
    const map = s?.walkMap;
    const y = room && map && on ? floorAt(map, on.x, on.z, on.y ?? room.y0) : NaN;
    const spot =
      room && map
        ? on
          ? Number.isNaN(y)
            ? null
            : { x: on.x, z: on.z, y }
          : startSpot(map, room)
        : null;
    if (!s || !spot) return false;
    const yaw = on?.yaw ?? Math.PI;
    s.moveKeeper(spot, yaw);
    keep(spot, yaw);
    syncKeeper(s);
    if (walkReady) {
      followGoal(s);
      copyPose(walkCam, walkGoal);
    }
    draw();
    return true;
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
    // On the Keeper in the dollhouse: walk in with it (Walk in does too).
    else if (keeperHit(x, y)) walkInOut();
    // Walked in, on the floor: the Keeper walks there.
    else if (!press?.moved) tapFloor(x, y);
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
    panner.down(e.clientX, e.pointerId);
    // Walked in, one finger walks: a press on the ring steers at once.
    if (pointers.size === 1 && walkingNow()) {
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      const origin = stickOrigin(e.clientX, e.clientY);
      if (origin.x !== e.clientX || origin.y !== e.clientY) {
        press.moved = true;
        stick = { x0: origin.x, y0: origin.y, x: e.clientX, y: e.clientY };
        walkTo = null;
        showStick();
        draw();
      }
    }
    if (pointers.size === 2) {
      // Two fingers pinch: the walk lets go.
      dropWalkInput();
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
    if (pointers.size === 1 && zoom === 0 && !walk && panner.move(e.clientX, e.pointerId)) {
      skipGlide();
      draw();
    }
    taps.pointerMove(sample(e));
    // A drag past a tap's slop is the joystick, steering from where it landed.
    if (press?.id === e.pointerId && pointers.size === 1) {
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      if (press.moved || dx * dx + dy * dy >= EXPLORE_VIEW.tapSlop ** 2) {
        press.moved = true;
        stick = stick
          ? { x0: stick.x0, y0: stick.y0, x: e.clientX, y: e.clientY }
          : { x0: press.x, y0: press.y, x: e.clientX, y: e.clientY };
        walkTo = null;
        showStick();
        draw();
      }
    }
    if (pinch && pointers.size === 2) {
      zoom = pinchZoom(pinch.zoom, pinch.spread, spread());
      renderWalk();
      draw();
    }
  });
  const lift = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    // (A tap lands first: one that steered the stick isn't one.)
    if (e.type === 'pointercancel') taps.pointerCancel(sample(e));
    else taps.pointerUp(sample(e));
    if (press?.id === e.pointerId) {
      press = null;
      stick = null;
      showStick();
    }
    const last = panner.up(e.pointerId);
    if (last) {
      showPan(last);
      draw();
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
      dropWalkInput();
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
    // While building, opening or moving, the page stays put ("Building…" can't be dismissed).
    if (houseBusy({ building, opening, moving }) && sheet !== 'peek') return;
    // Escape steps back one sheet at a time, then leaves the house.
    if (sheet === 'gift') setSheet('peek');
    else if (sheet === 'confirm') setSheet('grow');
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
    walkReady = false;
    // A new walk map: the last room is found afresh (a doorway keeps it between scenes otherwise).
    walkRoom = null;
    // The Keeper stays where it was left, if it can still stand there.
    if (kept && !Number.isNaN(floorAt(built.walkMap, keptAt.x, keptAt.z, keptAt.y)))
      built.moveKeeper(keptAt, keptYaw);
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
      houseDrawn();
      greet();
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
    const known = speciesMap(home);
    names = new Map(home.squishies.map((s) => [s.id, squishyName(s, known)]));
    // Before onOpen: the map's view (and its time zone) steps out with it.
    zone = options.timeZone?.(id) ?? null;
    mapId = id;
    view = fresh;
    readDay = localDayIn(zone, new Date(fresh.now));
    rereadFor = '';
    zoom = 0;
    floor = 0;
    panner.reset();
    walk = null;
    // A new visit: the Keeper starts by the hearth again.
    kept = false;
    walkReady = false;
    walkRoom = null;
    dropWalkInput();
    builtTier = null;
    sheet = 'peek';
    note = '';
    foldedBand = 0;
    foldedSheet = 0;
    celebrate = false;
    resetResidents(home);
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
    document.documentElement.style.removeProperty('--house-top-clear');
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    glide = null;
    walk = null;
    pointers.clear();
    pinch = null;
    dropWalkInput();
    walkReady = false;
    scene3d = null;
    sheet = 'peek';
    note = '';
    sync.drop();
    celebrate = false;
    resetResidents(null);
    // Nothing of the sheet stays behind (its faces would keep asking for pictures).
    sheetBody.replaceChildren();
    head?.remove();
    head = null;
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
    movedRoom = null;
    lastFrame = '';
    // The faces drawn so far stop asking for pictures; a request still waiting
    // for the first frame is let go (it answers nothing, see sheetPortraits).
    stopFaces();
    houseDrawn();
    if (home) awaitFirstFrame();
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
        keeper: keeperOnScreen(),
        floor,
        walk:
          scene3d && walkReady
            ? {
                room: walkRoom?.id ?? null,
                at: { x: walkAt.x, y: walkAt.y, z: walkAt.z },
                yaw: walkYaw,
                stick: stick !== null,
                walkingTo: walkTo !== null,
                eye: zoom > 0 ? { ...walkCam.eye } : null,
              }
            : null,
        scene: scene3d?.stats ?? null,
        faces: scene3d?.faceReport() ?? null,
        sheet,
        building,
        sparkles,
        moving,
        pickRoom: sheet === 'picker' ? pickRoom : null,
        facesWaiting: facesWaiting(peek),
        residentBoxes: (() => {
          const pose = base ? posed(base) : null;
          const box = overlay.getBoundingClientRect();
          return pose && scene3d
            ? residentBoxes(pose, { width: box.width, height: box.height }, scene3d.residentSpots)
            : [];
        })(),
        sheetTop: peek.getBoundingClientRect().top,
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
        putKeeper,
      };
    },
  };
}
