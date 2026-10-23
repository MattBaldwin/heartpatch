import type { Scene } from '@babylonjs/core/scene';
import {
  CROOKED_HOUSE,
  houseReach,
  type CrookedDoor,
  type CrookedFind,
  type CrookedHouseView,
  type FarHollowView,
  type KeeperConfig,
} from '@heartpatch/shared';
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
  CROOKED_TEXT as T,
  floorWords,
  progressWords,
  roomWords,
  targetWords,
} from './crooked-text.js';
import './crooked.css';

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
  readonly api?: Pick<FarHollowApi, 'view' | 'fix' | 'enter' | 'unlock'>;
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

/** The HUD's top and bottom, as shares of the screen's height, kept clear of the fitted room. */
const HUD = { top: 110, bottom: 190, mapTop: 150, mapBottom: 110 } as const; // TUNE: CSS px
/** A lift's hold, ms (the design: hold to lift). */
const HOLD_MS = 650; // TUNE
/** A small word (a fix, a door) shows this long, ms. */
const NOTE_MS = 2600; // TUNE
/** A press on Tiptoe shorter than this is a tap (it stays on); longer is a hold (off on release). */
const TIPTOE_TAP_MS = 350; // TUNE

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
  const back = el(
    'button',
    { type: 'button', class: 'crooked-back', 'data-testid': 'crooked-back', 'aria-label': T.back },
    '‹',
  );
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
  const mapHint = el('p', { class: 'crooked-map-hint' }, T.mapHint);
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
  );
  overlay.hidden = true;
  options.root.append(overlay);

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
  tiptoeButton.addEventListener('pointerdown', () => {
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
    if (tiptoe === on) return;
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
    if (target && targetWords(target).hold) say(T.hold);
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
    const since = performance.now();
    hold = {
      since,
      timer: setTimeout(() => {
        hold = null;
        action.classList.remove('crooked-holding');
        if (target) act(target);
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
    if (!isOpen || press || cards.length > 0) return;
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
    if (!mapShown && !working && cards.length === 0) {
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
    renderDark();
    if (moved || heading !== undefined || animating) options.invalidate();
    if (walking || animating) frame = requestAnimationFrame(tick);
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
    const reply = await command((id, key) => api.fix(id, { room: room.id, thing }, key));
    if (!reply || !name) return;
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
    if (!litRooms(h).has(room.id) || !reachable(h).has(room.id)) {
      say(T.mapDark);
      return;
    }
    if (room.id === h.room) {
      showMap(false);
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
    const shot = fitShot(
      box,
      {
        aspect: w / h,
        fov: s.fov,
        top: (mapShown ? HUD.mapTop : HUD.top) / h,
        bottom: (mapShown ? HUD.mapBottom : HUD.bottom) / h,
      },
      mapShown ? CROOKED_CAMERA.mapPitch : CROOKED_CAMERA.pitch,
    );
    s.frame(shot, cut);
    options.invalidate();
    wake();
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

  function reachable(h: CrookedHouseView): Set<string> {
    const bits = (ids: readonly string[]) =>
      CROOKED_HOUSE.doors.reduce((m, d, i) => (ids.includes(d.id) ? m | (1 << i) : m), 0);
    return houseReach(CROOKED_HOUSE, { unlocked: bits(h.unlocked), bonusOpen: bits(h.bonusOpen) });
  }

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
    const shown = floors().filter((f) => f < 2 || reachable(h).has('attic'));
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
    const words = target && !mapShown ? targetWords(target) : null;
    const show = words !== null && words.action !== '';
    action.hidden = !show;
    action.disabled = working;
    actionLabel.textContent = show ? words.action : '';
    action.classList.toggle('crooked-hold', show && words.hold);
    stickBase.hidden = mapShown;
    tiptoeButton.hidden = mapShown;
    // The bubble: a word just said, else what's in front (a shut door says which key, never where).
    const said =
      noteText || (target?.kind === 'door' && bumped === target.door ? (words?.bubble ?? '') : '');
    const about = target?.kind === 'thing' && !mapShown ? T.crooked : '';
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
    const title = card.kind === 'caught' ? T.caught : card.title;
    const line = card.kind === 'caught' ? T.caughtLine : card.line;
    const ok = el(
      'button',
      { type: 'button', class: 'crooked-card-button', 'data-testid': 'crooked-card-ok' },
      card.kind === 'key' ? T.keepIt : T.yay,
    );
    ok.addEventListener('click', () => {
      if (cards[0]?.kind === 'key') scene3d?.hideKey();
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
    action.hidden = true;
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
      tiptoe = false;
      cards = [];
      target = null;
      bumped = null;
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
    if (hold) clearTimeout(hold.timer);
    hold = null;
    press = null;
    stick = null;
    walk = null;
    working = false;
    cards = [];
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
        action: action.hidden ? null : actionLabel.textContent,
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

/** The bloom card's line: the colour came back, and anything it gave. */
function bloomLine(find: CrookedFind): string {
  const found = Object.values(find.found).reduce((n, c) => n + c, 0);
  return found > 0 ? `${T.bloomLine} ${T.bloomFound(found)}` : T.bloomLine;
}
