import type { Scene } from '@babylonjs/core/scene';
import {
  CROOKED_HOUSE,
  type CrookedDoor,
  type CrookedFind,
  type CrookedHouseView,
  type FarHollowView,
  type KeeperConfig,
} from '@heartpatch/shared';
import type { CueName } from '../../audio/cues.js';
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
  arrivalSpot,
  CROOKED_CAMERA,
  CROOKED_LANTERN,
  CROOKED_WALK,
  crookedThings,
  doorEnd,
  fitShot,
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
  walkStep,
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
import {
  CROOKED_ECHO_TEXT as E,
  CROOKED_TEXT as T,
  floorWords,
  progressWords,
  roomWords,
  targetWords,
} from './crooked-text.js';
import './crooked.css';
import './crooked-echoes.css';

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

export interface CrookedScreenOptions {
  readonly root: HTMLElement;
  readonly showScene: (build: SceneBuilder | null) => void;
  readonly invalidate: () => void;
  readonly tier: () => QualityTier;
  readonly keeper: () => KeeperConfig | null;
  readonly keeperWearing?: () => readonly string[];
  readonly api?: Pick<FarHollowApi, 'view' | 'fix' | 'enter' | 'unlock'>;
  readonly reducedMotion?: () => boolean;
  /** The house took the screen: everything else steps aside. */
  readonly onOpen: (mapId: string) => void;
  /** Back: the far Hollow sheet again (progress is already saved). */
  readonly onClosed: (mapId: string) => void;
  readonly onProblem: (message: string) => void;
  /** A sound for a moment (the audio cue system, #25): the peekaboo's sting and giggle. */
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
  readonly target: { kind: 'thing' | 'door'; id: string; state?: string } | null;
  readonly action: string | null;
  readonly bubble: string | null;
  readonly card: string | null;
  readonly keys: number;
  readonly putRight: number;
  readonly busy: boolean;
  /** The room's things still crooked, and where they stand. */
  readonly crooked: readonly { id: string; kind: string; x: number; z: number }[];
  readonly scene: CrookedSceneStats | null;
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
  /** Dev only (captures): stops the peekaboo's clock at `ms` from a catch, or lets it run (`null`). */
  devPeek: (ms: number | null) => void;
  /** Dev only (captures): draws the echoes at server time `ms`, or on the clock again (`null`). */
  devEchoesAt: (ms: number | null) => void;
}

/** A fitted room keeps this clear of the HUD, CSS px. */
const HUD_GAP = 8; // TUNE
/** A lift's hold, ms (the design: hold to lift). */
const HOLD_MS = 650; // TUNE
/** A small word (a fix, a door) shows this long, ms. */
const NOTE_MS = 2600; // TUNE
/** A press on Tiptoe shorter than this is a tap (it stays on); longer is a hold (off on release). */
const TIPTOE_TAP_MS = 350; // TUNE
/** The echoes drift on explore's 30 fps cap while nothing else moves. */
const ECHO_FRAME_MS = 33; // TUNE

type Card =
  | { kind: 'key'; title: string; line: string }
  | { kind: 'bloom'; title: string; line: string }
  | { kind: 'caught' };

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
  let target: CrookedTarget | null = null;
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
  /** The server's clock, from the last view (the echoes drift on it). */
  let clock: (now: number) => number = (now) => now;
  let spots: EchoSpot[] = [];
  let hint: EchoHint | null = null;
  let lastEchoDraw = 0;
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
  const overlay = el(
    'div',
    { class: 'crooked', 'data-testid': 'crooked' },
    ground,
    dark,
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
  );
  overlay.hidden = true;
  options.root.append(overlay);
  const peekaboo = createPeekaboo(overlay);

  back.addEventListener('click', () => {
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
  }

  // The big button: a tap, or a hold for a lift (the design's gestures, as buttons).
  action.addEventListener('pointerdown', (e) => {
    const t = target;
    if (!t || working || cards.length > 0) return;
    if (!targetWords(t).hold) return;
    e.preventDefault();
    startHold();
  });
  const endHold = () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold = null;
    action.classList.remove('crooked-holding');
    if (isOpen && target && targetWords(target).hold) say(T.hold);
  };
  action.addEventListener('pointerup', endHold);
  action.addEventListener('pointercancel', endHold);
  action.addEventListener('pointerleave', endHold);
  action.addEventListener('click', (e) => {
    const t = target;
    if (!t) return;
    // A hold's button is done by holding; a click with no press (keyboard, VoiceOver) does it.
    if (targetWords(t).hold && e.detail !== 0) return;
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
    if (!isOpen || press || cards.length > 0 || peekaboo.active) return;
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
    if (!mapShown && !working && cards.length === 0 && !peekaboo.active) {
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
      const r = walkStep(room, h, want);
      moved = r.at.x !== keeperAt.x || r.at.z !== keeperAt.z;
      // A tap-walk that a wall stopped is done.
      if (walk && !moved) walk = null;
      keeperAt = r.at;
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
    const animating = s.step(dt, now);
    const echoing = drawEchoes(now);
    renderDark();
    if (moved || heading !== undefined || animating) {
      options.invalidate();
      lastEchoDraw = now;
    } else if (echoing && now - lastEchoDraw >= ECHO_FRAME_MS) {
      options.invalidate();
      lastEchoDraw = now;
    }
    if (walking || animating || echoing) frame = requestAnimationFrame(tick);
  }

  // ── The echoes (#306 6d) ──────────────────────────────────────────────

  /** Moves the echoes to where they drift now and listens at the nearest dark doorway; true while any is near. */
  function drawEchoes(now: number): boolean {
    const s = scene3d;
    const h = house();
    if (!s || !h) return false;
    const at = echoesPinned ?? clock(Date.now());
    spots = echoSpots(h, at);
    const heard = mapShown || peekaboo.active ? null : echoHint(h, keeperAt, at, tiptoe);
    if (heardKey(heard) !== heardKey(hint)) {
      hint = heard;
      renderAction();
    } else hint = heard;
    const near = s.setEchoes(spots, hint?.watching ?? null, now);
    renderMarks();
    return near;
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
        const off = p.x < pad || p.x > w - pad || p.y < pad || p.y > hgt - pad;
        const inLight = lantern !== null && Math.hypot(p.x - lantern.x, p.y - lantern.y) < lightR;
        if (off) {
          state = 'edge';
          x = Math.min(w - pad, Math.max(pad, p.x));
          y = Math.min(hgt - pad, Math.max(pad, p.y));
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
  function peek(by: { echo: string; backTo: string }): void {
    caught = by;
    const at = generation;
    peekaboo.play({
      calm: reducedMotion(),
      cue: options.cue,
      onSwap: () => {
        if (at !== generation) return;
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
    const next = h && room && !mapShown ? nearestTarget(room, h, keeperAt) : null;
    if (!force && sameTarget(next, target)) return;
    target = next;
    renderAction();
  }

  function act(t: CrookedTarget): void {
    if (working || cards.length > 0) return;
    if (t.kind === 'thing') {
      if (t.thing.kind === 'relight') {
        say(T.puzzle);
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
    // A shut door rattles and its bubble says why (never where the key is).
    action.classList.remove('crooked-rattle');
    action.getBoundingClientRect(); // a reflow, so the rattle plays again
    action.classList.add('crooked-rattle');
    bubbleText(targetWords(t).bubble);
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
    apply(reply.view);
    if (reply.key) {
      scene3d?.showKey(thingPoint(room, name));
      cards.push({ kind: 'key', title: T.keyTitle(reply.key.name), line: T.keyLine(name.name) });
    }
    if (reply.bloom) {
      scene3d?.bloom(room.id);
      cards.push({ kind: 'bloom', title: T.bloomTitle(room.name), line: bloomLine(reply.bloom) });
    }
    if (!reply.key && !reply.bloom) say(T.fixed(name.name));
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
    apply(reply.view);
    const now = house();
    if (reply.caught) {
      peek(reply.caught);
      return;
    }
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
    s.show(h, mapShown ? roomsOnFloor(floor) : roomsAround(h.room));
    s.setKeeperShown(floorOf(h.room) === floor);
    s.setLantern(!roomLit() && !mapShown, tiptoe);
    render();
    options.invalidate();
    wake();
  }

  function refit(cut: boolean): void {
    const s = scene3d;
    const room = here();
    if (!s || !room) return;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const box = mapShown ? floorBox(floor) : room.box;
    const bands = hudBands(h);
    const shot = fitShot(
      box,
      { aspect: w / h, fov: s.fov, top: bands.top / h, bottom: bands.bottom / h },
      mapShown ? CROOKED_CAMERA.mapPitch : CROOKED_CAMERA.pitch,
      mapShown ? CROOKED_CAMERA.mapMargin : CROOKED_CAMERA.margin,
    );
    s.frame(shot, cut);
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
    const words = target && !mapShown && cards.length === 0 ? targetWords(target) : null;
    const show = words !== null && words.action !== '';
    // Idle, the big button keeps its place (the fitted room is measured round it).
    action.classList.toggle('crooked-idle', !show);
    action.hidden = mapShown;
    action.disabled = working;
    actionLabel.textContent = show ? words.action : '';
    action.classList.toggle('crooked-hold', show && words.hold);
    stickBase.hidden = mapShown;
    tiptoeButton.hidden = mapShown;
    // The bubble: a word just said, else what's in front (a shut door says which key, never where).
    const said =
      noteText || (target?.kind === 'door' && bumped === target.door ? (words?.bubble ?? '') : '');
    const about = words && target?.kind === 'thing' ? T.crooked : '';
    // At a dark doorway, an echo close by past it (#306 6d).
    const echo = hint && !mapShown && cards.length === 0 ? echoWords(hint, tiptoe) : '';
    bubbleText(said || echo || about || null, false);
  }

  function bubbleText(text: string | null, keep = true): void {
    if (keep && text) {
      noteText = text;
      if (noteTimer !== null) clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        noteTimer = null;
        noteText = '';
        renderAction();
      }, NOTE_MS);
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

  /** The lantern's dark: a circle of light round the Keeper in a dark room (the existing DOM layer, #501 G). */
  function renderDark(): void {
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
    sheet.hidden = card === undefined;
    if (!card) {
      sheet.replaceChildren();
      return;
    }
    const title = card.kind === 'caught' ? E.caughtTitle : card.title;
    const line = card.kind === 'caught' ? E.caughtLine : card.line;
    const label = card.kind === 'key' ? T.keepIt : card.kind === 'caught' ? E.caughtOk : T.yay;
    const ok = hpButton(label, {
      variant: 'primary',
      testId: 'crooked-card-ok',
    });
    ok.addEventListener('click', () => {
      if (cards[0]?.kind === 'key') scene3d?.hideKey();
      // The friendly echo waves goodbye with the card.
      if (cards[0]?.kind === 'caught') peekaboo.done();
      cards = cards.slice(1);
      renderCard();
      findTarget(true);
      wake();
    });
    sheet.dataset['kind'] = card.kind;
    sheet.replaceChildren(
      el('h3', { class: 'crooked-card-title', id: 'crooked-card-title' }, title),
      el('p', { class: 'crooked-card-line' }, line),
      ok,
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
    scene.onAfterRenderObservable.add(renderDark);
    scene.onDisposeObservable.addOnce(() => {
      if (scene3d === built) scene3d = null;
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
      view = fresh;
      const room = roomOf(fresh.house.room) ?? roomOf(CROOKED_HOUSE.start);
      keeperAt = room ? roomStart(room) : { x: 0, z: 0 };
      yaw = 0;
      floor = floorOf(fresh.house.room);
      mapShown = false;
      cards = [];
      target = null;
      bumped = null;
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
    isOpen = false;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (noteTimer !== null) clearTimeout(noteTimer);
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
    peekaboo.stop();
    for (const mark of marks.values()) mark.hidden = true;
    view = null;
    scene3d = null;
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
    devPlace: (x, z) => {
      const h = house();
      const room = here();
      if (!h || !room || !isOpen) return;
      walk = null;
      keeperAt = walkStep(room, h, { x, z }).at;
      scene3d?.moveKeeper(keeperAt, yaw);
      findTarget(true);
      options.invalidate();
      wake();
    },
    devPeek: (ms) => {
      peekaboo.hold(ms);
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
      };
    },
  };
}

function sameTarget(a: CrookedTarget | null, b: CrookedTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'thing' && b.kind === 'thing') return a.thing.id === b.thing.id;
  if (a.kind === 'door' && b.kind === 'door')
    return a.door.id === b.door.id && a.state.kind === b.state.kind && keyHeld(a) === keyHeld(b);
  return false;
}

const keyHeld = (t: CrookedTarget): boolean =>
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
