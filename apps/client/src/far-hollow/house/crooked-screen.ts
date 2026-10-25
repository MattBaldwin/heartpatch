import type { Scene } from '@babylonjs/core/scene';
import {
  CLOTHING_BY_ID,
  CROOKED_HOUSE,
  GAME_DATA,
  rareFindTier,
  type CrookedDoor,
  type CrookedFind,
  type CrookedFixResponse,
  type CrookedHouseView,
  type CrookedRoom,
  type CrookedThing,
  type FarHollowView,
  type JobsView,
  type KeeperConfig,
} from '@heartpatch/shared';
import type { CueName } from '../../audio/cues.js';
import { findCue } from '../../audio/cues.js';
import { itemName } from '../../inventory/bag-view.js';
import type { Portraits } from '../../procedural/portraits.js';
import { jobsApi } from '../../squishies/jobs/jobs-api.js';
import type { QualityTier } from '../../engine/config.js';
import type { SceneBuilder, SceneContent } from '../../engine/stage.js';
import { EXPLORE_VIEW } from '../../explore/explore-config.js';
import { joystickVector } from '../../explore/explore-view.js';
import { yawToward } from '../../explore/explore-world.js';
import { placeDark, type DarkPaint } from '../../explore/lantern-dark.js';
import { COMMAND_RETRY_MS, sendCommand } from '../../inventory/send-command.js';
import { newIdempotencyKey } from '../../net/idempotency-key.js';
import { faceYaw } from '../../procedural/face-yaw.js';
import { lodFor } from '../../procedural/motion.js';
import { hpBack, hpButton } from '../../ui/button/button.js';
import { el, messageOf } from '../../ui/dom.js';
import { farHollowApi, type FarHollowApi } from '../../hollowed/far-hollow-api.js';
import {
  chestTarget,
  helpersFor,
  keepOffChest,
  type ChestTarget,
  type Helper,
} from './crooked-bonus.js';
import { createDoorLights, doorLightLayout, doorLightPoints } from './crooked-door-light.js';
import { CrookedBonusFx, type CrookedBonusFxStats } from './crooked-bonus-fx.js';
import {
  arrivalSpot,
  CROOKED_CAMERA,
  CROOKED_LANTERN,
  CROOKED_WALK,
  crookedThings,
  doorEnd,
  farEnd,
  doorState,
  fitShot,
  focusShot,
  floorBox,
  floorOf,
  floors,
  litRooms,
  nearestTarget,
  reachableRooms,
  roomOf,
  roomStart,
  roomsOn,
  tapGoal,
  thingPoint,
  WAKE_LOOK,
  type CrookedShot,
  type CrookedTarget,
  type FloorPoint,
} from './crooked-plan.js';
import {
  CrookedScene,
  roomsAround,
  roomsOnFloor,
  type CrookedSceneStats,
} from './crooked-scene.js';
import {
  echoHint,
  echoSpots,
  serverClock,
  type EchoHint,
  type EchoSpot,
} from './crooked-echoes.js';
import { createPeekaboo, type PeekPhase } from './crooked-peekaboo.js';
import { createCrookedRelight } from './crooked-relight.js';
import {
  atticLines,
  atticTarget,
  houseStep,
  scrapsLeft,
  type AtticTarget,
} from './crooked-attic.js';
import type { PuzzleDebug } from '../../hollowed/puzzle-sheet.js';
import {
  CROOKED_ATTIC_TEXT as A,
  CROOKED_ECHO_TEXT as E,
  BONUS_TEXT as B,
  CROOKED_RELIGHT_TEXT as RT,
  CROOKED_TEXT as T,
  elementWords,
  floorWords,
  lootWords,
  powerDone,
  progressWords,
  roomWords,
  targetWords,
} from './crooked-text.js';
import './crooked.css';
import './crooked-bonus.css';
import './crooked-echoes.css';
import './crooked-attic.css';

// The Crooked House screen (#306 6c, the owner-approved design): my own
// haunted house this season, room by room. The camera fits the room I'm in
// (top-down, a slight tilt); a dark room shows only the lantern's circle,
// a room put right shows itself in colour. Walking is explore's and the
// Keeper's house's: a visible joystick, a drag anywhere, and tap-to-walk.
// The big button puts right what's in front of me or tries a door; Tiptoe
// shrinks the light; the map is the dollhouse view; Back goes to the far
// Hollow sheet. Every change is a server command (rule 1): the server says
// which room I'm in, what's fixed, which keys I hold and which doors open.
// Echoes drift through the dark rooms (#306 6d, `crooked-echoes.ts`); one
// close by notices me stepping in, and the server says so with a peekaboo
// (`crooked-peekaboo.ts`) and back to the last lit room, nothing lost.
// Two things are Relight boards (#306 6f, `crooked-relight.ts`), and each
// room's bloom brings a scrap of the house's story. The attic's big chest
// (`crooked-attic.ts`) opens once every room is right.

export interface CrookedScreenOptions {
  readonly root: HTMLElement;
  readonly showScene: (build: SceneBuilder | null) => void;
  readonly invalidate: () => void;
  /** One more frame, no settle frames: the drifting echoes pace themselves with it (#306 6d). */
  readonly requestFrame?: () => void;
  readonly tier: () => QualityTier;
  readonly keeper: () => KeeperConfig | null;
  readonly keeperWearing?: () => readonly string[];
  readonly api?: Pick<
    FarHollowApi,
    'view' | 'fix' | 'enter' | 'unlock' | 'relight' | 'power' | 'chest'
  >;
  /** My squishies' jobs and team, for "Who can help?" (#306 6e); the real API by default. */
  readonly jobs?: (mapId: string) => Promise<JobsView>;
  /** Squishy pictures for the picker and the chest's friend. */
  readonly portraits?: Portraits;
  /**
   * A bonus chest's rare friend: its wild battle has started (#306 6e). The
   * house steps aside quietly (no sheet) and the caller opens the battle.
   */
  readonly onFriend?: (mapId: string, battleId: string) => void;
  readonly reducedMotion?: () => boolean;
  /** The house took the screen: everything else steps aside. */
  readonly onOpen: (mapId: string) => void;
  /** Back: the far Hollow sheet again (progress is already saved). */
  readonly onClosed: (mapId: string) => void;
  readonly onProblem: (message: string) => void;
  /**
   * A sound for a moment (the audio cue system, #25): the peekaboo's sting and
   * giggle (#306 6d); a chest, a door woken, a chest's friend (#306 6e).
   */
  readonly cue?: (name: CueName) => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface CrookedDebug {
  readonly open: boolean;
  readonly room: string | null;
  readonly floor: number;
  readonly map: boolean;
  readonly lit: boolean;
  readonly dark: boolean;
  readonly tiptoe: boolean;
  readonly keeper: FloorPoint;
  /** Each woken door's cue on screen (CSS px), over the dark: its foot, height and sparkles. */
  readonly doorLights: readonly {
    door: string;
    power: string;
    at: FloorPoint;
    foot: { x: number; y: number };
    height: number;
    sparkles: number;
  }[];
  readonly target: {
    kind: 'thing' | 'door' | 'chest' | 'attic';
    id: string;
    state?: string;
  } | null;
  readonly action: string | null;
  readonly bubble: string | null;
  readonly card: string | null;
  readonly keys: number;
  readonly putRight: number;
  readonly busy: boolean;
  /** The room's things still crooked, and where they stand. */
  readonly crooked: readonly { id: string; kind: string; x: number; z: number }[];
  readonly scene: CrookedSceneStats | null;
  /** "Who can help?" (#306 6e): its door and team rows (null while it loads), or null when shut. */
  readonly picker: { door: string; helpers: { id: string; helps: boolean }[] | null } | null;
  /** A friend's moment is playing (the door wakes at its end). */
  readonly powering: boolean;
  readonly bonus: CrookedBonusFxStats | null;
  /** The echoes (#306 6d): where each drifts, and its eyes over the dark (`mark`). */
  readonly echoes: readonly {
    loop: string;
    room: string;
    position: number;
    shown: number;
    mark: 'off' | 'on' | 'edge';
  }[];
  /** At a doorway into a dark room: an echo that would notice me stepping in, with Tiptoe as it is and without. */
  readonly echoHint: {
    door: string;
    room: string;
    watching: string | null;
    plain: string | null;
    soft: string | null;
  } | null;
  /** The peekaboo playing: its phase, the calm one (reduced motion) or not, and whether it shook. */
  readonly peek: { phase: PeekPhase; calm: boolean; shook: boolean; friend: boolean } | null;
  /** The last catch: which echo, and the room it sent me back to. */
  readonly caught: { echo: string; backTo: string } | null;
  /** A Relight board open (#306 6f): the Hollow card's own debug. */
  readonly board: PuzzleDebug | null;
  /** The card's scrap of the house's story, on a bloom (#306 6f). */
  readonly scrap: string | null;
}

export interface CrookedScreen {
  /** Opens my Crooked House on a patch (once I've arrived this season). */
  open: (mapId: string) => Promise<void>;
  close: () => void;
  /** The patch changed (or closed, `null`): a house open on another patch shuts without a word. */
  setMap: (mapId: string | null) => void;
  readonly isOpen: boolean;
  readonly debug: CrookedDebug;
  /** Dev only (captures, e2e): stands the Keeper at a floor point of the room I'm in. */
  devPlace: (x: number, z: number) => void;
  /** Dev only (captures): the camera looks at a door of the room I'm in from a fixed shot (the same asleep and woken), for good. */
  devLook: (doorId: string) => void;
  /** Dev only (captures): stops the peekaboo's clock at `ms` from a catch, or lets it run (`null`). */
  devPeek: (ms: number | null) => void;
  /** Dev only (captures): draws the echoes at server time `ms`, or on the clock again (`null`). */
  devEchoesAt: (ms: number | null) => void;
  /**
   * Dev only (e2e): steps through an open door of the room I'm in, as walking
   * into its doorway does (a software-rendered phone walks too slowly to time it).
   */
  devStep: (doorId: string) => void;
  /** Dev only (captures, #306 6f): draws the last bloom, glow or chest moment `ms` in, or on the clock (`null`). */
  devMomentAt: (ms: number | null) => void;
}

/** A fitted room keeps this clear of the HUD, CSS px. */
const HUD_GAP = 8; // TUNE
/** A lift's hold, ms (the design: hold to lift). */
const HOLD_MS = 650; // TUNE
/** A small word (a fix, a door) shows this long, ms. */
const NOTE_MS = 2600; // TUNE
/** A press on Tiptoe shorter than this is a tap (it stays on); longer is a hold (off on release). */
const TIPTOE_TAP_MS = 350; // TUNE
/** As a friend helps, the Keeper steps this far back from the door, metres. */
const STEP_BACK = 1.35; // TUNE: the lantern still lights what the friend wakes
/** A chest's card waits this long, ms, so the lid and its sparkles are seen first. */
const CHEST_CARD_MS = 750; // TUNE
/** The echoes drift at 30 fps (explore's cap) while nothing else moves. */
const ECHO_FRAME_MS = 33; // TUNE
/** With no echo on screen, look again this often (one may drift into view), ms. */
const ECHO_IDLE_MS = { near: 250, far: 1000 } as const; // TUNE

type Card =
  | { kind: 'key'; title: string; line: string }
  | { kind: 'bloom'; title: string; line: string; scrap: string | null }
  | { kind: 'caught' }
  | { kind: 'chest'; title: string; line: string }
  | { kind: 'power'; title: string; line: string }
  | { kind: 'friend'; name: string; speciesId: string; battleId: string; cued: boolean }
  | { kind: 'attic'; title: string; lines: readonly string[] };

/** What's in front: a crooked thing or a shut door (6c), a bonus chest (6e), or the attic's big chest (6f). */
type Target = CrookedTarget | ChestTarget | AtticTarget;

export function createCrookedScreen(options: CrookedScreenOptions): CrookedScreen {
  const api = options.api ?? farHollowApi;
  const reducedMotion =
    options.reducedMotion ?? (() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  let mapId: string | null = null;
  let isOpen = false;
  let opening = false;
  /** Bumped on every open and close, so a late reply never lands on the next visit. */
  let generation = 0;
  let view: FarHollowView | null = null;
  let scene3d: CrookedScene | null = null;
  let keeperAt: FloorPoint = { x: 0, z: 0 };
  let yaw = 0;
  let floor = 0;
  let mapShown = false;
  let tiptoe = false;
  let working = false;
  let target: Target | null = null;
  /** The attic's reward card waits for the lid, on the chest moment's clock (#306 6f). */
  let atticCardWaiting = false;
  /** Dev only: a moment pinned for captures (#306 6f); a word said stays up with it. */
  let momentPinned = false;
  let cards: Card[] = [];
  let noteText = '';
  let noteTimer: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;
  let lastFrame = 0;
  let stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  let walk: FloorPoint | null = null;
  let press: { id: number; x: number; y: number; moved: boolean } | null = null;
  let hold: { since: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let darkPaint: DarkPaint | null = null;
  /** The door the Keeper last bumped (its bubble says why it's shut). */
  let bumped: CrookedDoor | null = null;
  let bonusFx: CrookedBonusFx | null = null;
  /** "Who can help?": the sleeping door, and my team's rows once read. */
  let picker: { door: CrookedDoor; helpers: Helper[] | null } | null = null;
  /** A team friend's moment is playing: the door wakes at its end. */
  let powering = false;
  const loadJobs = options.jobs ?? ((id: string) => jobsApi.view(id));
  /** The server's clock, from the last view (the echoes drift on it). */
  let clock: (now: number) => number = (now) => now;
  let spots: EchoSpot[] = [];
  let hint: EchoHint | null = null;
  let lastEchoDraw = 0;
  /** The bottom of the top HUD, CSS px (from the last fit): no echo is drawn under it. */
  let hudTop = 0;
  let echoState = { near: false, shown: false, drawn: false };
  /** A catch's view, held until the peekaboo's dark is full (the room changes unseen). */
  let pendingCatch: FarHollowView | null = null;
  let echoTimer: ReturnType<typeof setTimeout> | null = null;
  /** Eases the camera back to the room after a woken door's look. */
  let lookTimer: ReturnType<typeof setTimeout> | null = null;
  /** The door the camera is looking at, while it does. */
  let lookAt: { door: FloorPoint; shot: CrookedShot; fixed: FloorPoint | null } | null = null;
  let caught: { echo: string; backTo: string } | null = null;
  /** Dev only: the echoes drawn at this server time (captures). */
  let echoesPinned: number | null = null;

  const house = (): CrookedHouseView | null => view?.house ?? null;
  const here = () => {
    const h = house();
    return h ? roomOf(h.room) : null;
  };

  // ── DOM ───────────────────────────────────────────────────────────────
  const ground = el('div', { class: 'crooked-ground', 'data-testid': 'crooked-ground' });
  const dark = el('div', { class: 'crooked-dark', 'aria-hidden': 'true' });
  const darkLight = el('div', { class: 'crooked-dark-light' });
  dark.append(darkLight);
  // The shared "‹ Back" pill and button (Controls A, style guide §10).
  const back = hpBack(T.back, 'crooked-back');
  const roomPill = el('span', {
    class: 'crooked-pill crooked-room',
    'data-testid': 'crooked-room',
  });
  const putRight = el('span', {
    class: 'crooked-pill crooked-put-right',
    'data-testid': 'crooked-put-right',
  });
  const keysPill = el('span', {
    class: 'crooked-pill crooked-keys',
    role: 'img',
    'data-testid': 'crooked-keys',
  });
  const top = el(
    'header',
    { class: 'crooked-top' },
    back,
    el('div', { class: 'crooked-names' }, roomPill, putRight),
    keysPill,
  );
  const tabs = el('div', { class: 'crooked-tabs', role: 'tablist', 'data-testid': 'crooked-tabs' });
  const mapHint = el(
    'p',
    { class: 'crooked-map-hint', 'data-testid': 'crooked-map-hint' },
    ...T.mapHint.map((line) => el('span', { class: 'crooked-map-hint-line' }, line)),
  );
  const stickBase = el('div', {
    class: 'crooked-stick',
    'aria-hidden': 'true',
    'data-testid': 'crooked-stick',
  });
  const stickKnob = el('div', { class: 'crooked-stick-knob' });
  stickBase.append(stickKnob);
  const bubble = el('p', {
    class: 'crooked-bubble',
    role: 'status',
    'data-testid': 'crooked-bubble',
  });
  const actionLabel = el('span', { class: 'crooked-action-label' });
  const actionFill = el('span', { class: 'crooked-action-fill', 'aria-hidden': 'true' });
  const action = el(
    'button',
    { type: 'button', class: 'crooked-action', 'data-testid': 'crooked-action' },
    actionFill,
    actionLabel,
  );
  const tiptoeButton = el(
    'button',
    {
      type: 'button',
      class: 'crooked-round crooked-tiptoe',
      'data-testid': 'crooked-tiptoe',
      'aria-pressed': 'false',
      'aria-label': T.tiptoe,
    },
    el('span', { 'aria-hidden': 'true' }, '🕯️'),
    el('span', { class: 'crooked-round-word' }, T.tiptoe),
  );
  const mapButton = el(
    'button',
    {
      type: 'button',
      class: 'crooked-round crooked-map',
      'data-testid': 'crooked-map',
      'aria-label': T.mapOpen,
    },
    el('span', { 'aria-hidden': 'true' }, '🗺️'),
    el('span', { class: 'crooked-round-word' }, T.map),
  );
  const sheet = el('section', {
    class: 'crooked-card',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'crooked-card-title',
    'data-testid': 'crooked-card',
  });
  sheet.hidden = true;
  const pickerSheet = el('section', {
    class: 'crooked-card crooked-picker',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'crooked-picker-title',
    'data-testid': 'crooked-picker',
  });
  pickerSheet.hidden = true;
  // An echo's eyes over the dark, one per loop (#306 6d).
  const marks = new Map(
    CROOKED_HOUSE.echoLoops.map((loop) => {
      const mark = el(
        'div',
        {
          class: 'crooked-echo-mark',
          'aria-hidden': 'true',
          'data-testid': `crooked-echo-${loop.id}`,
        },
        el('span'),
        el('span'),
      );
      mark.hidden = true;
      return [loop.id, mark] as const;
    }),
  );
  const doorLights = createDoorLights();
  // Reduced motion keeps the settled glow and drops the sparkles' drift and the burst.
  doorLights.root.classList.toggle('crooked-door-calm', reducedMotion());
  const overlay = el(
    'div',
    { class: 'crooked', 'data-testid': 'crooked' },
    ground,
    dark,
    doorLights.root,
    ...marks.values(),
    top,
    tabs,
    mapHint,
    stickBase,
    bubble,
    action,
    tiptoeButton,
    mapButton,
    sheet,
    pickerSheet,
  );
  overlay.hidden = true;
  options.root.append(overlay);
  const peekaboo = createPeekaboo(overlay);
  const relight = createCrookedRelight({
    parent: overlay,
    start: (room, thing) => boardCommand((id, key) => api.relight(id, { room, thing }, key)),
    solve: (room, thing, attempt, moves) =>
      boardCommand((id, key) => api.fix(id, { room, thing, relight: { attempt, moves } }, key)),
    onClosed: (room, thing, fixed) => {
      boardShown(false);
      if (fixed) showFix(fixed, room, thing);
    },
  });

  back.addEventListener('click', () => {
    // A Relight board first (its try simply fades), then the map, then the house.
    if (relight.isOpen) {
      relight.close();
      return;
    }
    if (picker) {
      closePicker();
      return;
    }
    // A chest's friend is waiting in its battle (even behind the treasure card): Back goes to meet it too.
    const friend = cards.find((c) => c.kind === 'friend');
    if (friend?.kind === 'friend') {
      meetFriend(friend);
      return;
    }
    if (mapShown) {
      showMap(false);
      return;
    }
    close();
  });
  mapButton.addEventListener('click', () => {
    showMap(!mapShown);
  });

  // Tiptoe (owner decision 2): hold it to creep, or tap it on and tap it
  // off again (a visible button for the gesture, style guide §3.3).
  let tiptoeDown = 0;
  let tiptoeLatched = false;
  tiptoeButton.addEventListener('pointerdown', (e) => {
    try {
      // A release off the button (a mouse) still lets go.
      tiptoeButton.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured.
    }
    if (tiptoeLatched) {
      tiptoeLatched = false;
      tiptoeDown = 0;
      setTiptoe(false);
      return;
    }
    tiptoeDown = performance.now();
    setTiptoe(true);
  });
  const tiptoeUp = () => {
    if (tiptoeDown === 0) return;
    const held = performance.now() - tiptoeDown > TIPTOE_TAP_MS;
    tiptoeDown = 0;
    if (held) setTiptoe(false);
    else tiptoeLatched = true;
  };
  tiptoeButton.addEventListener('pointerup', tiptoeUp);
  tiptoeButton.addEventListener('pointercancel', tiptoeUp);
  tiptoeButton.addEventListener('click', (e) => {
    // A keyboard or VoiceOver click (no press before it) toggles.
    if (e.detail !== 0) return;
    tiptoeLatched = !tiptoe;
    setTiptoe(!tiptoe);
  });

  function setTiptoe(on: boolean): void {
    tiptoe = on;
    tiptoeButton.setAttribute('aria-pressed', String(on));
    tiptoeButton.classList.toggle('crooked-on', on);
    scene3d?.setLantern(!roomLit(), on);
    renderDark();
    options.invalidate();
    // What's heard at a doorway changes with Tiptoe: listen again now.
    wake();
  }

  // The big button: a tap, or a hold for a lift (the design's gestures, as buttons).
  action.addEventListener('pointerdown', (e) => {
    const t = target;
    if (!t || working || cards.length > 0 || picker || powering) return;
    if (!wordsFor(t).hold) return;
    e.preventDefault();
    startHold();
  });
  const endHold = () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold = null;
    action.classList.remove('crooked-holding');
    if (isOpen && target && wordsFor(target).hold) say(T.hold);
  };
  action.addEventListener('pointerup', endHold);
  action.addEventListener('pointercancel', endHold);
  action.addEventListener('pointerleave', endHold);
  action.addEventListener('click', (e) => {
    const t = target;
    if (!t) return;
    // A hold's button is done by holding; a click with no press (keyboard, VoiceOver) does it.
    if (wordsFor(t).hold && e.detail !== 0) return;
    act(t);
  });

  function startHold(): void {
    action.classList.add('crooked-holding');
    // The hold puts right the thing it started on, or nothing (the Keeper walked on).
    const on = target;
    hold = {
      since: performance.now(),
      timer: setTimeout(() => {
        hold = null;
        action.classList.remove('crooked-holding');
        if (on && sameTarget(on, target)) act(on);
      }, HOLD_MS),
    };
  }

  // ── Walking ───────────────────────────────────────────────────────────
  const local = (e: PointerEvent) => {
    const rect = ground.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Where a drag steers from: the joystick's middle if it started on it, else where it landed. */
  function stickOrigin(p: { x: number; y: number }): { x: number; y: number } {
    const base = stickBase.getBoundingClientRect();
    const rect = ground.getBoundingClientRect();
    const cx = base.left + base.width / 2 - rect.left;
    const cy = base.top + base.height / 2 - rect.top;
    const r = base.width / 2;
    return (p.x - cx) ** 2 + (p.y - cy) ** 2 <= r * r ? { x: cx, y: cy } : p;
  }

  ground.addEventListener('pointerdown', (e) => {
    if (!isOpen || press || cards.length > 0 || picker || powering || peekaboo.active) return;
    const p = local(e);
    press = { id: e.pointerId, x: p.x, y: p.y, moved: false };
    try {
      ground.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; their moves still arrive.
    }
    if (mapShown) return;
    const origin = stickOrigin(p);
    if (origin.x !== p.x || origin.y !== p.y) {
      press.moved = true;
      stick = { id: e.pointerId, x0: origin.x, y0: origin.y, x: p.x, y: p.y };
      walk = null;
      showStick();
      wake();
    }
  });
  ground.addEventListener('pointermove', (e) => {
    if (press?.id !== e.pointerId || mapShown) return;
    const p = local(e);
    const dx = p.x - press.x;
    const dy = p.y - press.y;
    if (!press.moved && dx * dx + dy * dy < EXPLORE_VIEW.tapSlop ** 2) return;
    press.moved = true;
    stick = stick
      ? { ...stick, x: p.x, y: p.y }
      : { id: e.pointerId, x0: press.x, y0: press.y, x: p.x, y: p.y };
    walk = null;
    showStick();
    wake();
  });
  const release = (e: PointerEvent) => {
    if (press?.id !== e.pointerId) return;
    const was = press;
    press = null;
    stick = null;
    showStick();
    if (!was.moved && e.type === 'pointerup') tapAt(was.x, was.y);
  };
  ground.addEventListener('pointerup', release);
  ground.addEventListener('pointercancel', release);

  function showStick(): void {
    stickBase.classList.toggle('crooked-stick-on', stick !== null);
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

  /** A tap walks there (beside a crooked thing); on the map, a tap on a lit room goes there. */
  function tapAt(x: number, y: number): void {
    const s = scene3d;
    const h = house();
    const room = here();
    if (!s || !h || !room) return;
    const p = s.floorAt(x, y);
    if (!p) return;
    if (mapShown) {
      mapTap(p);
      return;
    }
    walk = tapGoal(room, h, keeperAt, p);
    wake();
  }

  function wake(): void {
    if (echoTimer !== null) clearTimeout(echoTimer);
    echoTimer = null;
    if (frame === 0 && isOpen) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now: number): void {
    frame = 0;
    const s = scene3d;
    const h = house();
    const room = here();
    if (!s || !h || !room || !isOpen) return;
    const dt = Math.min(EXPLORE_VIEW.maxFrameStep, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    let walking = false;
    let want: FloorPoint | null = null;
    let heading: number | undefined;
    const speed = (tiptoe ? CROOKED_WALK.tiptoeSpeed : CROOKED_WALK.speed) * dt;
    // While a friend helps, only its step back (a walk, never the stick) moves the Keeper.
    const free = !powering || (walk !== null && stick === null);
    if (
      !mapShown &&
      !working &&
      cards.length === 0 &&
      !picker &&
      free &&
      !peekaboo.active &&
      !relight.isOpen
    ) {
      if (stick) {
        // The camera looks north: up the screen is north, right is east.
        const v = joystickVector(stick.x - stick.x0, stick.y - stick.y0);
        if (v.x !== 0 || v.z !== 0) {
          want = { x: keeperAt.x + v.x * speed, z: keeperAt.z + v.z * speed };
          heading = faceYaw(v.x, v.z);
        }
        walking = true;
      } else if (walk) {
        const dx = walk.x - keeperAt.x;
        const dz = walk.z - keeperAt.z;
        const d = Math.hypot(dx, dz);
        if (d <= 0.05) walk = null;
        else {
          const k = Math.min(1, speed / d);
          want = { x: keeperAt.x + dx * k, z: keeperAt.z + dz * k };
          heading = yawToward(keeperAt, walk);
          walking = true;
        }
      }
    }
    let moved = false;
    if (want) {
      // The walls, the doors and the attic's chest (a walk into it stops beside it).
      const r = houseStep(room, h, want);
      moved = r.at.x !== keeperAt.x || r.at.z !== keeperAt.z;
      // A tap-walk that a wall stopped is done.
      if (walk && !moved) walk = null;
      keeperAt = keepOffChest(room, r.at);
      if (r.bumped !== bumped) {
        bumped = r.bumped;
        if (bumped) findTarget(true);
      }
      if (r.crossed) void stepThrough(r.crossed);
    }
    if (moved || heading !== undefined) {
      if (heading !== undefined) yaw = heading;
      s.moveKeeper(keeperAt, yaw);
    }
    findTarget(false);
    const sceneMoving = s.step(dt, now);
    const bonusMoving = bonusFx?.step(now) ?? false;
    const animating = sceneMoving || bonusMoving;
    showAtticCard();
    const busy = moved || heading !== undefined || animating;
    // The echoes move with any frame that draws, else on their own 30 fps beat.
    if (busy || now - lastEchoDraw >= ECHO_FRAME_MS) {
      const wasDrawn = echoState.drawn;
      echoState = drawEchoes(now);
      lastEchoDraw = now;
      // One more frame as an echo goes, so its last spot doesn't stay on screen.
      if (!busy && (echoState.drawn || wasDrawn)) {
        if (options.requestFrame) options.requestFrame();
        else options.invalidate();
      }
    }
    renderDark();
    if (busy) options.invalidate();
    if (walking || animating || echoState.shown) frame = requestAnimationFrame(tick);
    else if (spots.some((p) => !p.gone)) {
      // Nothing on screen moves: look again in a while, drawing nothing till then.
      echoTimer = setTimeout(wake, echoState.near ? ECHO_IDLE_MS.near : ECHO_IDLE_MS.far);
    }
  }

  // ── The echoes (#306 6d) ──────────────────────────────────────────────

  /**
   * Moves the echoes to where they drift now and listens at the nearest dark
   * doorway. `shown`: one is on screen, drawn (`drawn`) or as eyes (keep
   * moving them); `near`: one could drift into view soon.
   */
  function drawEchoes(now: number): { near: boolean; shown: boolean; drawn: boolean } {
    const s = scene3d;
    const h = house();
    if (!s || !h) return { near: false, shown: false, drawn: false };
    const at = echoesPinned ?? clock(Date.now());
    spots = echoSpots(h, at);
    const heard = mapShown || peekaboo.active ? null : echoHint(h, keeperAt, at, tiptoe);
    if (heardKey(heard) !== heardKey(hint)) {
      hint = heard;
      renderAction();
    } else hint = heard;
    // An echo under the top HUD would read as a stray blob in it: its eyes peek in below instead.
    const under = new Set(
      spots
        .filter((p) => {
          const at = mapShown ? null : s.screenOf(p.at, 1.35);
          return at !== null && at.y < hudTop;
        })
        .map((p) => p.loop),
    );
    const state = s.setEchoes(spots, hint?.watching ?? null, now, under);
    renderMarks();
    // An echo's eyes over the dark or at the edge are on screen too.
    const marked = [...marks.values()].some((m) => !m.hidden);
    return { near: state.near, shown: state.shown || marked, drawn: state.shown };
  }

  /**
   * An echo's eyes over the lantern's dark (the 3D echo shows inside the
   * light, and in a lit room's view), or peeking in at the screen's edge
   * from the room next door.
   */
  function renderMarks(): void {
    const s = scene3d;
    const drawn = new Set(s?.stats.rooms ?? []);
    const inDark = dark.classList.contains('crooked-dark-on');
    const lantern = inDark && s ? s.screenOf(keeperAt, 0.6) : null;
    const edge = s?.screenOf(
      { x: keeperAt.x + CROOKED_LANTERN[tiptoe ? 'tiptoe' : 'radius'], z: keeperAt.z },
      0.6,
    );
    const lightR = lantern && edge ? Math.hypot(edge.x - lantern.x, edge.y - lantern.y) : 0;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    for (const [loop, mark] of marks) {
      const spot = spots.find((p) => p.loop === loop);
      const p =
        s &&
        spot &&
        !spot.gone &&
        !mapShown &&
        !peekaboo.active &&
        spot.shown > 0.05 &&
        (drawn.has(spot.between[0]) || drawn.has(spot.between[1]))
          ? s.screenOf(spot.at, 1.35)
          : null;
      let state: 'off' | 'on' | 'edge' = 'off';
      let x = 0;
      let y = 0;
      if (p && spot) {
        const pad = 28;
        // Under the top HUD counts as off screen: the eyes peek in just below it.
        const top = Math.max(pad, hudTop + 14);
        const off = p.x < pad || p.x > w - pad || p.y < top || p.y > hgt - pad;
        const inLight = lantern !== null && Math.hypot(p.x - lantern.x, p.y - lantern.y) < lightR;
        if (off) {
          state = 'edge';
          x = Math.min(w - pad, Math.max(pad, p.x));
          y = Math.min(hgt - pad, Math.max(top, p.y));
        } else if (inDark && !inLight) {
          state = 'on';
          x = p.x;
          y = p.y;
        }
      }
      mark.hidden = state === 'off';
      mark.dataset['state'] = state;
      if (state === 'off' || !spot) continue;
      mark.style.opacity = String(Math.min(1, spot.shown) * (state === 'edge' ? 0.7 : 0.9));
      mark.style.transform = `translate(${String(Math.round(x))}px, ${String(Math.round(y))}px)`;
      mark.classList.toggle('crooked-echo-watching', hint?.watching === loop);
    }
  }

  /** The peekaboo, then back in the last lit room (the server already put me there). */
  function peek(by: { echo: string; backTo: string }, fresh: FarHollowView): void {
    caught = by;
    pendingCatch = fresh;
    // The server's clock as the reply arrives, not at the swap a moment later.
    if (fresh.house) clock = serverClock(fresh.house.serverTime, Date.now());
    const at = generation;
    peekaboo.play({
      calm: reducedMotion(),
      cue: options.cue,
      onSwap: () => {
        if (at !== generation) return;
        if (pendingCatch) view = pendingCatch;
        pendingCatch = null;
        const backTo = roomOf(by.backTo);
        if (backTo) keeperAt = roomStart(backTo);
        yaw = 0;
        enterShown(true);
      },
      onCard: () => {
        if (at !== generation) return;
        cards.push({ kind: 'caught' });
        renderCard();
      },
    });
    renderAction();
  }

  // ── What's in front, and doing it ─────────────────────────────────────

  function findTarget(force: boolean): void {
    const h = house();
    const room = here();
    const next = h && room && !mapShown ? nearest(room, h) : null;
    if (!force && sameTarget(next, target)) return;
    target = next;
    renderAction();
  }

  /** The nearest of the nearest crooked thing or shut door and the room's chest (a bonus room's or the attic's). */
  function nearest(room: CrookedRoom, h: CrookedHouseView): Target | null {
    const near = nearestTarget(room, h, keeperAt);
    const chest = chestTarget(room, h, keeperAt) ?? atticTarget(room, h, keeperAt);
    if (!near || !chest) return near ?? chest;
    const d = (p: FloorPoint) => Math.hypot(p.x - keeperAt.x, p.z - keeperAt.z);
    return d(chest.at) < d(near.at) ? chest : near;
  }

  /** The big button and its bubble for what's in front. */
  function wordsFor(t: Target): { action: string; bubble: string | null; hold: boolean } {
    if (t.kind === 'chest') return { action: B.chestAction, bubble: B.chestBubble, hold: false };
    if (t.kind !== 'attic') return targetWords(t);
    const h = house();
    const left = h ? scrapsLeft(h) : 0;
    return { action: A.action, bubble: left > 0 ? A.faint(left) : A.ready, hold: false };
  }

  function act(t: Target): void {
    if (working || cards.length > 0 || picker || powering) return;
    if (t.kind === 'chest') {
      void openChest(t.room);
      return;
    }
    if (t.kind === 'attic') {
      void openAttic(t);
      return;
    }
    if (t.kind === 'thing') {
      if (t.thing.kind === 'relight') {
        openBoard(t.thing);
        return;
      }
      void fix(t.thing.id);
      return;
    }
    const s = t.state;
    if (s.kind === 'locked' && s.held) {
      void unlock(t.door);
      return;
    }
    // A sleeping door: who on my team can help (#306 6e)?
    if (s.kind === 'sleeping') {
      void openPicker(t.door);
      return;
    }
    // A shut door rattles and its bubble says why (never where the key is).
    action.classList.remove('crooked-rattle');
    action.getBoundingClientRect(); // a reflow, so the rattle plays again
    action.classList.add('crooked-rattle');
    bubbleText(wordsFor(t).bubble);
  }

  /** Runs a command for this visit: a reply after Back (or another visit) is dropped. */
  async function command<R>(send: (id: string, key: string) => Promise<R>): Promise<R | null> {
    const id = mapId;
    if (!id || working) return null;
    const at = generation;
    const still = () => at === generation && isOpen && mapId === id;
    working = true;
    renderAction();
    try {
      const reply = await sendCommand(sendDeps, (key) => send(id, key), still);
      return reply && still() ? reply : null;
    } catch (err) {
      if (still()) say(messageOf(err));
      return null;
    } finally {
      if (at === generation) {
        working = false;
        renderAction();
      }
    }
  }

  async function fix(thing: string): Promise<void> {
    const room = here();
    if (!room) return;
    const name = room.things.find((t) => t.id === thing);
    if (!name) return;
    const reply = await command((id, key) => api.fix(id, { room: room.id, thing }, key));
    if (!reply) return;
    showFix(reply, room, name);
  }

  /** What a fix did: the thing put right, maybe a key, maybe the room's bloom and its scrap. */
  function showFix(reply: CrookedFixResponse, room: CrookedRoom, thing: CrookedThing): void {
    apply(reply.view);
    if (reply.key || reply.bloom) options.cue?.(reply.bloom ? 'room-bloom' : 'key-found');
    if (reply.key) {
      scene3d?.showKey(thingPoint(room, thing));
      cards.push({ kind: 'key', title: T.keyTitle(reply.key.name), line: T.keyLine(thing.name) });
    }
    if (reply.bloom) {
      scene3d?.bloom(room.id);
      cards.push({
        kind: 'bloom',
        title: T.bloomTitle(room.name),
        line: bloomLine(reply.bloom),
        scrap: reply.scrap,
      });
    }
    if (!reply.key && !reply.bloom) {
      if (thing.kind === 'relight') {
        // A board relit: a warm flare where it stands, with a twinkle.
        scene3d?.relit(room.id);
        options.cue?.('twinkle');
        say(RT.relit(thing.name));
      } else say(T.fixed(thing.name));
    }
    redraw();
    renderCard();
  }

  async function unlock(door: CrookedDoor): Promise<void> {
    const reply = await command((id, key) => api.unlock(id, door.id, key));
    if (!reply) return;
    apply(reply.view);
    say(T.opened);
    redraw();
  }

  // ── Bonus rooms (#306 6e) ─────────────────────────────────────────────

  /** "Who can help?": my battle team, the door's element first (the server checks again). */
  async function openPicker(door: CrookedDoor): Promise<void> {
    const id = mapId;
    if (!id || picker) return;
    const at = generation;
    const asked: { door: CrookedDoor; helpers: Helper[] | null } = { door, helpers: null };
    picker = asked;
    renderPicker();
    try {
      const jobs = await loadJobs(id);
      // Closed (Not now, Back) or another visit: drop it.
      if (at !== generation || picker !== asked) return;
      picker = { door, helpers: helpersFor(door, jobs) };
    } catch (err) {
      if (at !== generation || picker !== asked) return;
      picker = null;
      say(messageOf(err));
    }
    renderPicker();
  }

  function closePicker(): void {
    picker = null;
    renderPicker();
    findTarget(true);
  }

  function renderPicker(): void {
    const p = picker;
    pickerSheet.hidden = p === null;
    if (!p) {
      pickerSheet.replaceChildren();
      renderAction();
      return;
    }
    const e = elementWords(p.door.power ?? '');
    const list = el('div', { class: 'crooked-helpers', role: 'list' });
    if (p.helpers === null) {
      list.append(el('p', { class: 'crooked-card-line' }, B.pickerLoading));
    } else if (!p.helpers.some((h) => h.helps)) {
      list.append(
        el(
          'p',
          { class: 'crooked-card-line', 'data-testid': 'crooked-nobody' },
          B.nobody(e.name, e.icon),
        ),
      );
    }
    for (const h of p.helpers ?? []) {
      const face = el('span', { class: 'crooked-helper-face', 'aria-hidden': 'true' });
      void portraitInto(face, h.speciesId, h.id, h.accessory);
      const words = el(
        'span',
        { class: 'crooked-helper-words' },
        el('span', { class: 'crooked-helper-name' }, `${h.name} ${elementWords(h.element).icon}`),
      );
      if (!h.helps) words.append(el('span', { class: 'crooked-helper-not' }, B.notThisOne(e.name)));
      if (h.helps) {
        const row = hpButton(el('span', { class: 'crooked-helper-row' }, face, words), {
          variant: 'secondary',
          testId: `crooked-helper-${h.id}`,
        });
        row.classList.add('crooked-helper');
        row.addEventListener('click', () => {
          picker = null;
          renderPicker();
          void wakeDoor(p.door, h);
        });
        // The row is the list item; the button inside keeps its role for VoiceOver.
        list.append(el('div', { role: 'listitem' }, row));
      } else {
        list.append(
          el(
            'div',
            { class: 'crooked-helper crooked-helper-off', role: 'listitem' },
            el('span', { class: 'crooked-helper-row' }, face, words),
          ),
        );
      }
    }
    const notNow = hpButton(B.notNow, { variant: 'quiet', testId: 'crooked-picker-close' });
    notNow.addEventListener('click', closePicker);
    pickerSheet.replaceChildren(
      el('h3', { class: 'crooked-card-title', id: 'crooked-picker-title' }, B.pickerTitle(e.icon)),
      el('p', { class: 'crooked-card-line' }, B.pickerLine(p.door.sleeper ?? 'This door', e.name)),
      list,
      notNow,
    );
    renderAction();
  }

  /** A squishy's picture into `into` (nothing without portraits, or before the engine). */
  async function portraitInto(
    into: HTMLElement,
    speciesId: string,
    instanceId: string,
    accessory: string | null,
    size?: number,
  ): Promise<void> {
    const species = GAME_DATA.species.find((sp) => sp.id === speciesId);
    if (!options.portraits || !species) return;
    const url = await options.portraits
      .get({ species, instanceId, accessory, ...(size ? { size } : {}) })
      .catch(() => null);
    if (url) into.replaceChildren(el('img', { src: url, alt: '' }));
  }

  /** The chosen friend wakes the door: the server opens it, then its moment plays and the door wakes. */
  async function wakeDoor(door: CrookedDoor, helper: Helper): Promise<void> {
    const room = here();
    const end = room ? doorEnd(door, room.id) : null;
    const reply = await command((id, key) =>
      api.power(id, { door: door.id, squishyId: helper.id }, key),
    );
    if (!reply) return;
    const at = generation;
    powering = true;
    stick = null;
    showStick();
    // The Keeper steps back from the door, so the friend's moment plays in view.
    const back = end
      ? {
          x: end.point.x + end.inward.x * STEP_BACK,
          z: end.point.z + end.inward.z * STEP_BACK,
        }
      : null;
    walk = back;
    options.cue?.('pop');
    const woke = () => {
      if (at !== generation) return;
      powering = false;
      apply(reply.view);
      options.cue?.('door-wake');
      // What the friend did, and where it leads, on a card (the moment's payoff).
      const beyond = room ? farEnd(door, room.id)?.room.name : undefined;
      cards.push({
        kind: 'power',
        title: powerDone(door.power ?? '', helper.name),
        line: beyond ? B.wokeLine(beyond) : B.wokeLineAny,
      });
      redraw();
      if (end) lookAtDoor(end.point);
      renderCard();
    };
    const fx = bonusFx;
    // Out of the scene's step, so the redraw never runs inside a frame.
    if (fx && end) {
      fx.power(helper, back ?? keeperAt, end.point, end.inward, () => {
        queueMicrotask(woke);
      });
    } else woke();
    renderAction();
    wake();
  }

  /** Opens the bonus room's chest: the lid, the sparkles, the loot's card, and maybe a friend. */
  async function openChest(room: CrookedRoom): Promise<void> {
    const reply = await command((id, key) => api.chest(id, room.id, key));
    if (!reply) return;
    apply(reply.view);
    const friend = reply.friend;
    const species = friend ? GAME_DATA.species.find((sp) => sp.id === friend.speciesId) : null;
    options.cue?.('chest');
    bonusFx?.openChest(
      room.id,
      friend ? { speciesId: friend.speciesId, instanceId: friend.battleId } : null,
    );
    const things = lootWords(reply.find.found, itemName);
    const line = things ? B.chestLine(things) : B.chestEmpty;
    cards.push({
      kind: 'chest',
      title: B.chestTitle,
      line: reply.find.clothing ? `${line} ${B.chestWear}` : line,
    });
    if (friend) {
      cards.push({
        kind: 'friend',
        name: species?.name ?? B.friendSomeone,
        speciesId: friend.speciesId,
        battleId: friend.battleId,
        cued: false,
      });
    }
    redraw();
    renderAction();
    const at = generation;
    const show = () => {
      if (at !== generation) return;
      renderCard();
    };
    if (reducedMotion()) show();
    else setTimeout(show, CHEST_CARD_MS);
  }

  /** Walked into an open doorway: the server moves me (and checks the echoes, #306 6d). */
  async function stepThrough(door: CrookedDoor): Promise<void> {
    const from = here();
    const h = house();
    if (!from || !h || working) return;
    const to = door.a.room === from.id ? door.b.room : door.a.room;
    stick = null;
    walk = null;
    showStick();
    const reply = await command((id, key) => api.enter(id, { room: to, tiptoe }, key));
    if (!reply) {
      // Not let through (offline, say): back a step into the room.
      const end = doorEnd(door, from.id);
      if (end)
        keeperAt = {
          x: end.point.x + end.inward.x * CROOKED_WALK.arriveIn,
          z: end.point.z + end.inward.z * CROOKED_WALK.arriveIn,
        };
      scene3d?.moveKeeper(keeperAt, yaw);
      options.invalidate();
      return;
    }
    if (reply.caught) {
      // The old room stays until the dark is full; then the last lit room.
      peek(reply.caught, reply.view);
      return;
    }
    apply(reply.view);
    const now = house();
    if (now) {
      keeperAt = arrivalSpot(door, now.room) ?? keeperAt;
      const end = doorEnd(door, now.room);
      if (end) yaw = faceYaw(end.inward.x, end.inward.z);
    }
    enterShown(false);
    renderCard();
  }

  /** On the map, a lit room I can reach: go straight there (the server checks). */
  function mapTap(p: FloorPoint): void {
    const h = house();
    if (!h) return;
    const room = roomsOn(floor).find(
      (r) => Math.abs(p.x - r.box.x) <= r.box.w / 2 && Math.abs(p.z - r.box.z) <= r.box.d / 2,
    );
    if (!room) return;
    // My own room, dark or lit: back to it.
    if (room.id === h.room) {
      showMap(false);
      return;
    }
    if (!litRooms(h).has(room.id) || !reachableRooms(h).has(room.id)) {
      say(T.mapDark);
      return;
    }
    void (async () => {
      const reply = await command((id, key) =>
        api.enter(id, { room: room.id, tiptoe: false }, key),
      );
      if (!reply) return;
      apply(reply.view);
      const now = house();
      const there = now ? roomOf(now.room) : null;
      if (there) keeperAt = roomStart(there);
      mapShown = false;
      enterShown(true);
    })();
  }

  // ── The Relight boards (#306 6f) ──────────────────────────────────────

  /** Opens a Relight thing's board over the room; the house waits behind it. */
  function openBoard(thing: CrookedThing): void {
    const room = here();
    if (!room || working) return;
    stick = null;
    walk = null;
    showStick();
    boardShown(true);
    relight.open(room, thing);
  }

  function boardShown(on: boolean): void {
    // The board has the screen to itself: the house's controls step aside.
    overlay.classList.toggle('crooked-boarded', on);
    if (!isOpen) return;
    findTarget(true);
    renderAction();
    wake();
  }

  /**
   * A board's command for this visit: errors reach the card (it says them),
   * and a reply after Back or another visit is dropped (null).
   */
  async function boardCommand<R>(send: (id: string, key: string) => Promise<R>): Promise<R | null> {
    const id = mapId;
    if (!id) return null;
    const at = generation;
    const still = () => at === generation && isOpen && mapId === id;
    const reply = await sendCommand(sendDeps, (key) => send(id, key), still);
    return reply && still() ? reply : null;
  }

  // ── The attic (#306 6f) ───────────────────────────────────────────────

  /**
   * The big chest: the page needs every room put right first (the server
   * checks too, rule 1). Then the cellar's moment, the lid swinging back with
   * sparkles and a beam, and the card once the lid is up.
   */
  async function openAttic(t: AtticTarget): Promise<void> {
    const h = house();
    if (!h) return;
    const left = scrapsLeft(h);
    if (left > 0) {
      action.classList.remove('crooked-rattle');
      action.getBoundingClientRect(); // a reflow, so the rattle plays again
      action.classList.add('crooked-rattle');
      bubbleText(A.faint(left));
      return;
    }
    const reply = await command((id, key) => api.chest(id, t.room.id, key));
    if (!reply) return;
    // The moment starts before the view that shows the chest open.
    scene3d?.openAtticChest();
    options.cue?.('chest-big');
    apply(reply.view);
    cards.push({
      kind: 'attic',
      title: A.cardTitle,
      lines: atticLines(reply, {
        item: itemName,
        clothing: (id) => CLOTHING_BY_ID.get(id)?.name ?? id,
      }),
    });
    // The card comes when the lid is up (`tick`, on the moment's own clock).
    atticCardWaiting = true;
    redraw();
    showAtticCard();
  }

  /** The attic's card, once the chest's lid is up. */
  function showAtticCard(): void {
    if (!atticCardWaiting || (scene3d && !scene3d.atticCardDue())) return;
    atticCardWaiting = false;
    renderCard();
  }

  // ── Showing it ────────────────────────────────────────────────────────

  function apply(fresh: FarHollowView): void {
    view = fresh;
    if (fresh.house) clock = serverClock(fresh.house.serverTime, Date.now());
  }

  /** Shows the room I'm in (and its floor), and fits the camera to it. */
  function enterShown(cut: boolean): void {
    const room = here();
    if (!room) return;
    floor = room.floor;
    scene3d?.moveKeeper(keeperAt, yaw);
    redraw();
    refit(cut);
    findTarget(true);
    wake();
  }

  function redraw(): void {
    const h = house();
    const s = scene3d;
    if (!h || !s) return;
    const rooms = mapShown ? roomsOnFloor(floor) : roomsAround(h.room);
    s.show(h, rooms);
    bonusFx?.show(h, rooms);
    s.setKeeperShown(floorOf(h.room) === floor);
    s.setLantern(!roomLit() && !mapShown, tiptoe);
    render();
    options.invalidate();
    wake();
  }

  /** The shot that fits the room (or the floor, on the map) in the free band. */
  function fitted(): CrookedShot | null {
    const s = scene3d;
    const room = here();
    if (!s || !room) return null;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const box = mapShown ? floorBox(floor) : room.box;
    const bands = hudBands(h);
    hudTop = mapShown ? 0 : bands.top;
    return fitShot(
      box,
      { aspect: w / h, fov: s.fov, top: bands.top / h, bottom: bands.bottom / h },
      mapShown ? CROOKED_CAMERA.mapPitch : CROOKED_CAMERA.pitch,
      mapShown ? CROOKED_CAMERA.mapMargin : CROOKED_CAMERA.margin,
    );
  }

  function refit(cut: boolean): void {
    const shot = fitted();
    if (!shot || !scene3d) return;
    if (lookTimer !== null) clearTimeout(lookTimer);
    lookTimer = null;
    lookAt = null;
    scene3d.frame(shot, cut);
    options.invalidate();
    wake();
  }

  /** The look's shot: the door near the middle, the Keeper still in frame (it follows as the Keeper moves). */
  function lookFrame(): void {
    if (!lookAt || !scene3d) return;
    const { door, shot, fixed } = lookAt;
    if (fixed) {
      scene3d.frame(focusShot(shot, fixed), false);
      return;
    }
    const k = WAKE_LOOK.towardsKeeper;
    scene3d.frame(
      focusShot(shot, {
        x: door.x + (keeperAt.x - door.x) * k,
        z: door.z + (keeperAt.z - door.z) * k,
      }),
      false,
    );
  }

  /** A door just woke: the camera eases in to it (its light is the payoff), then back to the room. */
  function lookAtDoor(
    at: FloorPoint,
    fixed: FloorPoint | null = null,
    holdMs: number = WAKE_LOOK.holdMs,
  ): void {
    const shot = fitted();
    if (!shot || !scene3d || mapShown || (reducedMotion() && fixed === null)) return;
    if (lookTimer !== null) clearTimeout(lookTimer);
    lookAt = { door: at, shot, fixed };
    lookFrame();
    lookTimer = setTimeout(() => {
      lookTimer = null;
      refit(false);
    }, holdMs);
    options.invalidate();
    wake();
  }

  /**
   * The HUD's bands at the top and the bottom, CSS px, measured from the
   * screen as the Keeper's house does (the safe area and a phone's size
   * included). The big button keeps its place while idle (hidden, not
   * removed), so the room doesn't jump as it comes and goes.
   */
  function hudBands(height: number): { top: number; bottom: number } {
    const bottomOf = (e: HTMLElement) => (e.hidden ? 0 : e.getBoundingClientRect().bottom);
    const topOf = (e: HTMLElement) => (e.hidden ? height : e.getBoundingClientRect().top);
    const top = Math.max(
      bottomOf(roomPill),
      bottomOf(putRight),
      bottomOf(keysPill),
      bottomOf(tabs),
    );
    const below = mapShown ? [mapHint, mapButton] : [action, stickBase, mapButton];
    const bottom = height - Math.min(...below.map(topOf));
    return { top: Math.max(0, top + HUD_GAP), bottom: Math.max(0, bottom + HUD_GAP) };
  }

  function showMap(on: boolean): void {
    if (!house()) return;
    mapShown = on;
    stick = null;
    walk = null;
    showStick();
    floor = on ? floor : floorOf(house()?.room ?? CROOKED_HOUSE.start);
    redraw();
    refit(false);
    findTarget(true);
  }

  const roomLit = (): boolean => {
    const h = house();
    return h !== null && litRooms(h).has(h.room);
  };

  function render(): void {
    const h = house();
    const room = here();
    if (!h || !room) return;
    const progress = progressWords(h);
    roomPill.textContent = mapShown ? T.mapTitle(floorWords(floor)) : roomWords(room, roomLit());
    putRight.textContent = progress.rooms;
    keysPill.textContent = `🗝️ ${progress.keys}`;
    keysPill.setAttribute('aria-label', progress.keysLabel);
    overlay.classList.toggle('crooked-mapping', mapShown);
    overlay.classList.toggle('crooked-in-dark', !roomLit() && !mapShown);
    mapButton.classList.toggle('crooked-on', mapShown);
    mapButton.setAttribute('aria-pressed', String(mapShown));
    mapHint.hidden = !mapShown;
    // Floors are tabs on the map; the attic once its ladder's open.
    const shown = floors().filter((f) => f < 2 || reachableRooms(h).has('attic'));
    tabs.hidden = !mapShown || shown.length < 2;
    tabs.replaceChildren(
      ...shown.map((f) => {
        const tab = el(
          'button',
          {
            type: 'button',
            class: 'crooked-tab',
            role: 'tab',
            'aria-selected': String(f === floor),
            'data-testid': `crooked-floor-${String(f)}`,
          },
          floorWords(f),
        );
        tab.addEventListener('click', () => {
          floor = f;
          redraw();
          refit(false);
        });
        return tab;
      }),
    );
    renderAction();
    renderDark();
  }

  function renderAction(): void {
    // A card (a key, a bloom) has the bottom of the screen to itself.
    const words =
      target && !mapShown && cards.length === 0 && !picker && !powering ? wordsFor(target) : null;
    const show = words !== null && words.action !== '';
    // Idle, the big button keeps its place (the fitted room is measured round it).
    action.classList.toggle('crooked-idle', !show);
    action.hidden = mapShown;
    action.disabled = working || powering;
    actionLabel.textContent = show ? words.action : '';
    action.classList.toggle('crooked-hold', show && words.hold);
    stickBase.hidden = mapShown;
    tiptoeButton.hidden = mapShown;
    // The bubble: a word just said, else what's in front (a shut door says which key, never where).
    const said =
      noteText || (target?.kind === 'door' && bumped === target.door ? (words?.bubble ?? '') : '');
    const about =
      words && target?.kind === 'thing'
        ? T.crooked
        : words && target?.kind === 'chest'
          ? B.chestBubble
          : target?.kind === 'attic'
            ? (words?.bubble ?? '')
            : '';
    // At a dark doorway, an echo close by past it (#306 6d).
    const echo = hint && !mapShown && cards.length === 0 ? echoWords(hint, tiptoe) : '';
    bubbleText(said || echo || about || null, false);
  }

  function bubbleText(text: string | null, keep = true): void {
    if (keep && text) {
      noteText = text;
      if (noteTimer !== null) clearTimeout(noteTimer);
      // Dev only: a word said while a moment is pinned for a capture stays with it.
      const held = momentPinned;
      const fade = () => {
        if (held && momentPinned) {
          noteTimer = setTimeout(fade, NOTE_MS);
          return;
        }
        noteTimer = null;
        noteText = '';
        renderAction();
      };
      noteTimer = setTimeout(fade, NOTE_MS);
    }
    // VoiceOver reads words said (a fix, a door, a key), not the idle hint as the
    // Keeper walks. The region turns live before its words change, so they're read.
    bubble.setAttribute('aria-live', noteText !== '' && text === noteText ? 'polite' : 'off');
    bubble.textContent = text ?? '';
    bubble.hidden = !text;
  }

  const say = (text: string) => {
    bubbleText(text);
  };

  /** The woken doors' cues (a glow and sparkles on both sides), over the dark, where each door stands in the wall now. */
  function renderDoorLights(): void {
    const s = scene3d;
    const doors = isOpen && !mapShown && s ? (bonusFx?.wokenDoors() ?? []) : [];
    doorLights.set(
      doors.map((door) => {
        const points = doorLightPoints(door.at, door.inward);
        const at = (k: keyof typeof points) => s?.screenOf(points[k][0], points[k][1]) ?? null;
        const layout = doorLightLayout({
          footLeft: at('footLeft'),
          footRight: at('footRight'),
          topLeft: at('topLeft'),
          topRight: at('topRight'),
        });
        return { id: door.id, power: door.power, at: door.at, layout, fresh: door.fresh };
      }),
      { width: window.innerWidth, height: window.innerHeight },
    );
  }

  function renderDark(): void {
    // The look at a woken door ends once the Keeper walks off: its dark must stay on screen.
    if (lookAt) {
      const { door } = lookAt;
      if (Math.hypot(keeperAt.x - door.x, keeperAt.z - door.z) > WAKE_LOOK.keeperMax) refit(false);
      else lookFrame();
    }
    renderDoorLights();
    paintDark();
  }

  /** The lantern's dark: a circle of light round the Keeper in a dark room (the existing DOM layer, #501 G). */
  function paintDark(): void {
    const s = scene3d;
    const on = isOpen && !mapShown && !roomLit();
    dark.classList.toggle('crooked-dark-on', on);
    if (!on || !s) return;
    const c = s.screenOf(keeperAt, 0.6);
    const r = CROOKED_LANTERN[tiptoe ? 'tiptoe' : 'radius'];
    const edge = s.screenOf({ x: keeperAt.x + r, z: keeperAt.z }, 0.6);
    if (!c || !edge) return;
    const placed = placeDark(
      darkPaint,
      { x: c.x, y: c.y, r: Math.hypot(edge.x - c.x, edge.y - c.y) },
      {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    );
    if (placed.repaint) {
      darkPaint = placed.paint;
      darkLight.style.width = `${String(placed.paint.width)}px`;
      darkLight.style.height = `${String(placed.paint.height)}px`;
      darkLight.style.setProperty('--light-r', `${String(placed.paint.radius)}px`);
    }
    darkLight.style.transform = placed.transform;
  }

  function renderCard(): void {
    const card = cards[0];
    // The attic's card waits for the chest's lid (`showAtticCard`).
    if (card?.kind === 'attic' && atticCardWaiting) {
      sheet.hidden = true;
      return;
    }
    sheet.hidden = card === undefined;
    if (!card) {
      sheet.replaceChildren();
      return;
    }
    if (card.kind === 'friend') {
      renderFriendCard(card);
      return;
    }
    const title = card.kind === 'caught' ? E.caughtTitle : card.title;
    const label =
      card.kind === 'key'
        ? T.keepIt
        : card.kind === 'caught'
          ? E.caughtOk
          : card.kind === 'attic'
            ? A.ok
            : T.yay;
    const ok = hpButton(label, {
      variant: 'primary',
      testId: 'crooked-card-ok',
    });
    ok.addEventListener('click', () => {
      if (cards[0]?.kind === 'key') scene3d?.hideKey();
      // The friendly echo waves goodbye with the card.
      if (cards[0]?.kind === 'caught') peekaboo.done();
      nextCard();
    });
    sheet.dataset['kind'] = card.kind;
    // A bloom's scrap of the house's story (#306 6f), like a note found in the room.
    const scrap =
      card.kind === 'bloom' && card.scrap
        ? [
            el(
              'figure',
              { class: 'crooked-scrap', 'data-testid': 'crooked-scrap' },
              el('figcaption', { class: 'crooked-scrap-label' }, RT.scrap),
              el('blockquote', { class: 'crooked-scrap-text' }, card.scrap),
            ),
          ]
        : [];
    // The attic's chest: what it gave, a line each (#306 6f).
    const body =
      card.kind === 'attic'
        ? el(
            'ul',
            { class: 'crooked-attic-lines', 'data-testid': 'crooked-attic-lines' },
            ...card.lines.map((l) => el('li', {}, l)),
          )
        : el(
            'p',
            { class: 'crooked-card-line' },
            card.kind === 'caught' ? E.caughtLine : card.line,
          );
    sheet.replaceChildren(
      el('h3', { class: 'crooked-card-title', id: 'crooked-card-title' }, title),
      body,
      ...scrap,
      ok,
    );
    action.classList.add('crooked-idle');
    bubble.hidden = true;
    wake();
  }

  function nextCard(): void {
    cards = cards.slice(1);
    renderCard();
    findTarget(true);
    wake();
  }

  /**
   * "Say hello!" (or Back: its battle has started either way). The house
   * steps aside without its sheet and the battle takes the screen; closing
   * it comes back here.
   */
  function meetFriend(card: Extract<Card, { kind: 'friend' }>): void {
    const id = mapId;
    bonusFx?.clearFriend();
    if (id && options.onFriend) {
      hide();
      options.onFriend(id, card.battleId);
      return;
    }
    nextCard();
  }

  /**
   * The chest's rare friend (#306 6e): its picture in a glow, a chime, and
   * "Say hello!", which takes me to its battle (a Heart Charm befriends it).
   */
  function renderFriendCard(card: Extract<Card, { kind: 'friend' }>): void {
    if (!card.cued) {
      card.cued = true;
      const species = GAME_DATA.species.find((sp) => sp.id === card.speciesId);
      options.cue?.(findCue(species ? (rareFindTier(species.rarity)?.scale ?? 1) : 1));
    }
    const face = el('div', { class: 'crooked-friend-face', 'aria-hidden': 'true' });
    void portraitInto(face, card.speciesId, card.battleId, null, 128);
    const go = hpButton(B.friendGo, { variant: 'primary', testId: 'crooked-card-ok' });
    go.addEventListener('click', () => {
      meetFriend(card);
    });
    sheet.dataset['kind'] = card.kind;
    sheet.replaceChildren(
      face,
      el('h3', { class: 'crooked-card-title', id: 'crooked-card-title' }, B.friendTitle),
      el('p', { class: 'crooked-card-line' }, B.friendLine(card.name)),
      go,
    );
    action.classList.add('crooked-idle');
    bubble.hidden = true;
    wake();
  }

  // ── Scene ─────────────────────────────────────────────────────────────

  const build = (scene: Scene): SceneContent => {
    const h = house();
    if (!h) throw new Error('no house to show');
    const tier = options.tier();
    const built = new CrookedScene(scene, {
      tier,
      lod: lodFor('closeUp', tier),
      keeper: options.keeper(),
      keeperWearing: options.keeperWearing?.() ?? [],
      reducedMotion: reducedMotion(),
    });
    scene3d = built;
    const fx = new CrookedBonusFx(scene, {
      lod: lodFor('closeUp', tier),
      reducedMotion: reducedMotion(),
    });
    bonusFx = fx;
    scene.onAfterRenderObservable.add(renderDark);
    scene.onDisposeObservable.addOnce(() => {
      if (scene3d === built) scene3d = null;
      if (bonusFx === fx) bonusFx = null;
    });
    // A rebuilt scene (a lost context) shows where I am now.
    enterShown(true);
    return built.content;
  };

  async function open(id: string): Promise<void> {
    if (isOpen || opening) return;
    opening = true;
    const at = ++generation;
    try {
      const fresh = await api.view(id);
      if (at !== generation) return;
      if (!fresh.house) {
        options.onProblem(T.notYet);
        return;
      }
      mapId = id;
      // The server's clock comes with the view: the echoes drift on it from the first frame.
      apply(fresh);
      const room = roomOf(fresh.house.room) ?? roomOf(CROOKED_HOUSE.start);
      keeperAt = room ? roomStart(room) : { x: 0, z: 0 };
      yaw = 0;
      floor = floorOf(fresh.house.room);
      mapShown = false;
      cards = [];
      target = null;
      bumped = null;
      picker = null;
      powering = false;
      darkPaint = null;
      hint = null;
      spots = [];
      caught = null;
      isOpen = true;
      overlay.hidden = false;
      options.onOpen(id);
      options.showScene(build);
      render();
      say(T.walkHint);
    } catch (err) {
      if (at === generation) options.onProblem(messageOf(err));
    } finally {
      opening = false;
    }
  }

  function close(): void {
    const id = mapId;
    if (!isOpen) return;
    hide();
    if (id) options.onClosed(id);
    else options.showScene(null);
  }

  function hide(): void {
    generation += 1;
    lookAt = null;
    isOpen = false;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (noteTimer !== null) clearTimeout(noteTimer);
    if (lookTimer !== null) clearTimeout(lookTimer);
    noteTimer = null;
    noteText = '';
    endHold();
    tiptoeLatched = false;
    tiptoeDown = 0;
    setTiptoe(false);
    press = null;
    stick = null;
    showStick();
    walk = null;
    working = false;
    cards = [];
    picker = null;
    powering = false;
    pickerSheet.hidden = true;
    pickerSheet.replaceChildren();
    relight.close();
    overlay.classList.remove('crooked-boarded');
    atticCardWaiting = false;
    peekaboo.stop();
    pendingCatch = null;
    if (echoTimer !== null) clearTimeout(echoTimer);
    echoTimer = null;
    for (const mark of marks.values()) mark.hidden = true;
    view = null;
    scene3d = null;
    bonusFx = null;
    mapId = null;
    overlay.hidden = true;
    sheet.hidden = true;
  }

  window.addEventListener('resize', () => {
    if (isOpen) refit(true);
  });

  return {
    open,
    close,
    setMap: (id) => {
      if (isOpen && id !== mapId) hide();
      // An open still waiting on its read never lands on a patch that went away.
      else if (!isOpen && id === null) generation += 1;
    },
    devLook: (doorId) => {
      const room = here();
      const door = CROOKED_HOUSE.doors.find((d) => d.id === doorId);
      const end = room && door ? doorEnd(door, room.id) : null;
      if (!end) return;
      // The door a little off the middle, the Keeper's side of the room in view.
      const aim = { x: end.point.x + end.inward.x * 0.6, z: end.point.z + end.inward.z * 0.6 };
      lookAtDoor(end.point, aim, 60 * 60 * 1000);
    },
    devPlace: (x, z) => {
      const h = house();
      const room = here();
      if (!h || !room || !isOpen) return;
      walk = null;
      keeperAt = keepOffChest(room, houseStep(room, h, { x, z }).at);
      scene3d?.moveKeeper(keeperAt, yaw);
      findTarget(true);
      options.invalidate();
      wake();
    },
    devPeek: (ms) => {
      peekaboo.hold(ms);
    },
    devStep: (doorId) => {
      const door = CROOKED_HOUSE.doors.find((d) => d.id === doorId);
      const h = house();
      if (!door || !h || !isOpen || doorState(door, h).kind !== 'open') return;
      if (door.a.room !== h.room && door.b.room !== h.room) return;
      void stepThrough(door);
    },
    devMomentAt: (ms) => {
      momentPinned = ms !== null;
      scene3d?.devMomentAt(ms);
      wake();
    },
    devEchoesAt: (ms) => {
      echoesPinned = ms;
      wake();
    },
    get isOpen() {
      return isOpen;
    },
    get debug(): CrookedDebug {
      const h = house();
      const room = here();
      const t = target;
      return {
        open: isOpen,
        room: h?.room ?? null,
        floor,
        map: mapShown,
        lit: roomLit(),
        dark: dark.classList.contains('crooked-dark-on'),
        tiptoe,
        keeper: { ...keeperAt },
        target: t
          ? t.kind === 'thing'
            ? { kind: 'thing', id: t.thing.id }
            : t.kind === 'chest'
              ? { kind: 'chest', id: t.room.id }
              : t.kind === 'attic'
                ? { kind: 'attic', id: t.room.id }
                : { kind: 'door', id: t.door.id, state: t.state.kind }
          : null,
        action:
          action.hidden || action.classList.contains('crooked-idle')
            ? null
            : actionLabel.textContent,
        bubble: bubble.hidden ? null : bubble.textContent,
        card: cards[0]?.kind ?? null,
        keys: h?.keys.length ?? 0,
        putRight: h?.rooms.filter((r) => r.bloomed).length ?? 0,
        busy: working,
        crooked:
          h && room
            ? crookedThings(room, h).map((c) => ({
                id: c.id,
                kind: c.kind,
                ...thingPoint(room, c),
              }))
            : [],
        scene: scene3d?.stats ?? null,
        picker: picker
          ? {
              door: picker.door.id,
              helpers: picker.helpers?.map((x) => ({ id: x.id, helps: x.helps })) ?? null,
            }
          : null,
        powering,
        bonus: bonusFx?.stats ?? null,
        doorLights: doorLights.debug(),
        echoes: spots.map((p) => ({
          loop: p.loop,
          room: p.room,
          position: p.position,
          shown: p.shown,
          mark: (marks.get(p.loop)?.dataset['state'] ?? 'off') as 'off' | 'on' | 'edge',
        })),
        echoHint: hint
          ? {
              door: hint.door.id,
              room: hint.room,
              watching: hint.watching,
              plain: hint.plain,
              soft: hint.soft,
            }
          : null,
        peek: peekaboo.debug,
        caught,
        board: relight.debug,
        scrap: cards[0]?.kind === 'bloom' ? cards[0].scrap : null,
      };
    },
  };
}

function sameTarget(a: Target | null, b: Target | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'chest' && b.kind === 'chest') return a.room.id === b.room.id;
  if (a.kind === 'attic' && b.kind === 'attic') return a.room.id === b.room.id;
  if (a.kind === 'thing' && b.kind === 'thing') return a.thing.id === b.thing.id;
  if (a.kind === 'door' && b.kind === 'door')
    return a.door.id === b.door.id && a.state.kind === b.state.kind && keyHeld(a) === keyHeld(b);
  return false;
}

const keyHeld = (t: Target): boolean =>
  t.kind === 'door' && t.state.kind === 'locked' && t.state.held;

/** What's heard at a dark doorway: wait, or Tiptoe would get me past. */
function echoWords(hint: EchoHint, tiptoe: boolean): string {
  if (hint.soft) return E.near;
  if (hint.plain && !tiptoe) return E.tiptoe;
  return '';
}

const heardKey = (h: EchoHint | null): string =>
  h ? `${h.door.id}:${h.watching ?? ''}:${h.plain ?? ''}:${h.soft ?? ''}` : '';

/** The bloom card's line: the colour came back, and anything it gave. */
function bloomLine(find: CrookedFind): string {
  const found = Object.values(find.found).reduce((n, c) => n + c, 0);
  return found > 0 ? `${T.bloomLine} ${T.bloomFound(found)}` : T.bloomLine;
}
