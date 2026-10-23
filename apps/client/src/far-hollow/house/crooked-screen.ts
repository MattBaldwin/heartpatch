import type { Scene } from '@babylonjs/core/scene';
import {
  CROOKED_HOUSE,
  GAME_DATA,
  rareFindTier,
  type CrookedDoor,
  type CrookedFind,
  type CrookedHouseView,
  type CrookedRoom,
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
import { CrookedBonusFx, type CrookedBonusFxStats } from './crooked-bonus-fx.js';
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
  BONUS_TEXT as B,
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

// The Crooked House screen (#306 6c, the owner-approved design): my own
// haunted house this season, room by room. The camera fits the room I'm in
// (top-down, a slight tilt); a dark room shows only the lantern's circle,
// a room put right shows itself in colour. Walking is explore's and the
// Keeper's house's: a visible joystick, a drag anywhere, and tap-to-walk.
// The big button puts right what's in front of me or tries a door; Tiptoe
// shrinks the light; the map is the dollhouse view; Back goes to the far
// Hollow sheet. Every change is a server command (rule 1): the server says
// which room I'm in, what's fixed, which keys I hold and which doors open.
// The echoes and their peekaboo are #306 6d (`onCaught`).

export interface CrookedScreenOptions {
  readonly root: HTMLElement;
  readonly showScene: (build: SceneBuilder | null) => void;
  readonly invalidate: () => void;
  readonly tier: () => QualityTier;
  readonly keeper: () => KeeperConfig | null;
  readonly keeperWearing?: () => readonly string[];
  readonly api?: Pick<FarHollowApi, 'view' | 'fix' | 'enter' | 'unlock' | 'power' | 'chest'>;
  /** My squishies' jobs and team, for "Who can help?" (#306 6e); the real API by default. */
  readonly jobs?: (mapId: string) => Promise<JobsView>;
  /** Squishy pictures for the picker and the chest's friend. */
  readonly portraits?: Portraits;
  /** A moment that has a sound (a chest, a door woken, a friend). */
  readonly cue?: (name: CueName) => void;
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
   * An echo caught me stepping in (#306 6d's peekaboo: the eyes, the sting,
   * the shake). Until it's built, a friendly card says so.
   */
  readonly onCaught?: (caught: { echo: string; backTo: string }) => void;
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
  readonly target: { kind: 'thing' | 'door' | 'chest'; id: string; state?: string } | null;
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
}

/** A fitted room keeps this clear of the HUD, CSS px. */
const HUD_GAP = 8; // TUNE
/** A lift's hold, ms (the design: hold to lift). */
const HOLD_MS = 650; // TUNE
/** A small word (a fix, a door) shows this long, ms. */
const NOTE_MS = 2600; // TUNE
/** A press on Tiptoe shorter than this is a tap (it stays on); longer is a hold (off on release). */
const TIPTOE_TAP_MS = 350; // TUNE
/** A chest's card waits this long, ms, so the lid and its sparkles are seen first. */
const CHEST_CARD_MS = 750; // TUNE

type Card =
  | { kind: 'key'; title: string; line: string }
  | { kind: 'bloom'; title: string; line: string }
  | { kind: 'caught' }
  | { kind: 'chest'; title: string; line: string }
  | { kind: 'friend'; name: string; speciesId: string; battleId: string; cued: boolean };

/** What's in front: a crooked thing or a shut door (6c), or a bonus chest (6e). */
type Target = CrookedTarget | ChestTarget;

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
  const overlay = el(
    'div',
    { class: 'crooked', 'data-testid': 'crooked' },
    ground,
    dark,
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

  back.addEventListener('click', () => {
    if (picker) {
      closePicker();
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
    if (!isOpen || press || cards.length > 0 || picker || powering) return;
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
    if (!mapShown && !working && cards.length === 0 && !picker && !powering) {
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
    renderDark();
    if (moved || heading !== undefined || animating) options.invalidate();
    if (walking || animating) frame = requestAnimationFrame(tick);
  }

  // ── What's in front, and doing it ─────────────────────────────────────

  function findTarget(force: boolean): void {
    const h = house();
    const room = here();
    const next = h && room && !mapShown ? nearerTarget(room, h, keeperAt) : null;
    if (!force && sameTarget(next, target)) return;
    target = next;
    renderAction();
  }

  function act(t: Target): void {
    if (working || cards.length > 0 || picker || powering) return;
    if (t.kind === 'chest') {
      void openChest(t.room);
      return;
    }
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
      if (at !== generation) return;
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
        row.setAttribute('role', 'listitem');
        row.addEventListener('click', () => {
          picker = null;
          renderPicker();
          void wakeDoor(p.door, h);
        });
        list.append(row);
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
    walk = null;
    showStick();
    options.cue?.('pop');
    const woke = () => {
      if (at !== generation) return;
      powering = false;
      apply(reply.view);
      options.cue?.('twinkle');
      say(powerDone(door.power ?? '', helper.name));
      redraw();
      findTarget(true);
    };
    const fx = bonusFx;
    // Out of the scene's step, so the redraw never runs inside a frame.
    if (fx && end) {
      fx.power(helper, keeperAt, end.point, () => {
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
    options.cue?.('pop');
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
      options.cue?.('twinkle');
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
    apply(reply.view);
    const now = house();
    if (reply.caught) {
      const backTo = roomOf(reply.caught.backTo);
      if (backTo) keeperAt = roomStart(backTo);
      if (options.onCaught) options.onCaught(reply.caught);
      else cards.push({ kind: 'caught' });
    } else if (now) {
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
          : '';
    bubbleText(said || about || null, false);
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
    if (card.kind === 'friend') {
      renderFriendCard(card);
      return;
    }
    const title = card.kind === 'caught' ? T.caught : card.title;
    const line = card.kind === 'caught' ? T.caughtLine : card.line;
    const ok = hpButton(card.kind === 'key' ? T.keepIt : T.yay, {
      variant: 'primary',
      testId: 'crooked-card-ok',
    });
    ok.addEventListener('click', () => {
      if (cards[0]?.kind === 'key') scene3d?.hideKey();
      nextCard();
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

  function nextCard(): void {
    cards = cards.slice(1);
    renderCard();
    findTarget(true);
    wake();
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
      const id = mapId;
      bonusFx?.clearFriend();
      if (id && options.onFriend) {
        // The house steps aside without its sheet; the battle takes the screen.
        hide();
        options.onFriend(id, card.battleId);
        return;
      }
      nextCard();
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
      view = fresh;
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
    picker = null;
    powering = false;
    pickerSheet.hidden = true;
    pickerSheet.replaceChildren();
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
    devPlace: (x, z) => {
      const h = house();
      const room = here();
      if (!h || !room || !isOpen) return;
      walk = null;
      keeperAt = keepOffChest(room, walkStep(room, h, { x, z }).at);
      scene3d?.moveKeeper(keeperAt, yaw);
      findTarget(true);
      options.invalidate();
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
      };
    },
  };
}

function sameTarget(a: Target | null, b: Target | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'chest' && b.kind === 'chest') return a.room.id === b.room.id;
  if (a.kind === 'thing' && b.kind === 'thing') return a.thing.id === b.thing.id;
  if (a.kind === 'door' && b.kind === 'door')
    return a.door.id === b.door.id && a.state.kind === b.state.kind && keyHeld(a) === keyHeld(b);
  return false;
}

/** The big button's words for what's in front (a chest is #306 6e's). */
function wordsFor(t: Target): { action: string; bubble: string | null; hold: boolean } {
  return t.kind === 'chest'
    ? { action: B.chestAction, bubble: B.chestBubble, hold: false }
    : targetWords(t);
}

/** The nearer of the nearest crooked thing or shut door and a bonus room's chest. */
function nearerTarget(room: CrookedRoom, view: CrookedHouseView, at: FloorPoint): Target | null {
  const near = nearestTarget(room, view, at);
  const chest = chestTarget(room, view, at);
  if (!near || !chest) return near ?? chest;
  const d = (p: FloorPoint) => Math.hypot(p.x - at.x, p.z - at.z);
  return d(chest.at) < d(near.at) ? chest : near;
}

const keyHeld = (t: Target): boolean =>
  t.kind === 'door' && t.state.kind === 'locked' && t.state.held;

/** The bloom card's line: the colour came back, and anything it gave. */
function bloomLine(find: CrookedFind): string {
  const found = Object.values(find.found).reduce((n, c) => n + c, 0);
  return found > 0 ? `${T.bloomLine} ${T.bloomFound(found)}` : T.bloomLine;
}
