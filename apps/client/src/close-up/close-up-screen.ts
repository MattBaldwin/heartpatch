import type { Scene } from '@babylonjs/core/scene';
import {
  GAME_DATA,
  visualRegistry,
  type CareListResponse,
  type CareSquishy,
  type PublicUser,
} from '@heartpatch/shared';
import { careApi, type CareApi } from '../care/care-api.js';
import {
  CARE_TEXT,
  careDoneLine,
  evolutionLine,
  nextReadyIn,
  speciesById,
} from '../care/care-view.js';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import type { SquishyDetail } from '../procedural/config.js';
import { heroLodFor } from '../procedural/motion.js';
import { el, messageOf } from '../ui/dom.js';
import { blurredBackdrop } from './backdrop.js';
import {
  BREATHING_FRAME_MS,
  BUBBLE_MS,
  BUBBLE_TOP_PX,
  GONE_MS,
  CAMERA_FOV,
  CAMERA_POSES,
  IDLE,
  SWOOP,
  type ClosePose,
  type IdleMove,
  type Reaction,
} from './close-up-config.js';
import { CloseUpScene, type CloseUpSceneStats } from './close-up-scene.js';
import {
  careDecision,
  checkNickname,
  CLOSE_UP_TEXT,
  easeInOutSine,
  easeOutCubic,
  frameFor,
  idleMoveFor,
  idlePose,
  infoCard,
  nextIdleIn,
  poseBetween,
  reactionFor,
  REST_POSE,
  type CareHold,
  type CloseUpTouch,
} from './close-up-view.js';
import { GestureReader, onTarget, type GesturePoint, type ScreenTarget } from './gestures.js';
import '../care/care.css';
import './close-up.css';

// The close-up interaction view (#20, design doc §20): tap a squishy and the
// camera swoops in face to face, the world behind blurs, and the squishy is
// drawn in its highest detail. Boop, stroke, pinch to tickle or drag a treat
// over: each is a care action the server decides (CLAUDE.md rule 1); the
// squishy always reacts, and a touch the server would only refuse (still in
// its short debounce) gets its reaction but isn't sent. Idle, it shows its
// feeling (Silly spins, Sleepy nods off, Brave puffs up). Swipe down or Back
// returns to where the player came from.

/** Where the close-up was opened from, so Back returns there. */
export type CloseUpFrom = 'home' | 'map';

export interface CloseUpScreenOptions {
  root: HTMLElement;
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames (`Stage.invalidate`). */
  invalidate: () => void;
  /** Draws one frame (`Stage.requestFrame`): breathing paces itself with this. */
  requestFrame: () => void;
  tier: () => QualityTier;
  /**
   * Draws the view on screen now and returns its canvas, read in the same
   * task for the blurred backdrop (null: no renderer).
   */
  snapshot: () => HTMLCanvasElement | null;
  /** The close-up opened: everything else steps out. */
  onOpen: (mapId: string, from: CloseUpFrom) => void;
  /** Back to where it was opened from. */
  onClosed: (mapId: string, from: CloseUpFrom) => void;
  /** It couldn't open (offline, or the squishy isn't here): say why where the player is. */
  onProblem: (message: string) => void;
  /** The squishy was touched (a gesture or its button), sent or not (sound, #25). */
  onTouch?: (kind: CloseUpTouch) => void;
  api?: CareApi;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface CloseUpDebug {
  readonly mapId: string;
  readonly squishyId: string;
  readonly from: CloseUpFrom;
  readonly phase: Phase;
  /** How far the swoop in has come, 0–1 (1 once face to face). */
  readonly swoop: number;
  readonly lod: SquishyDetail | null;
  readonly scene: CloseUpSceneStats | null;
  /** How long drawing the snapshot and blurring it took, ms (null: no backdrop). */
  readonly snapshotMs: number | null;
  readonly backdropMs: number | null;
  /** The squishy on screen, CSS pixels (for tests to touch it). */
  readonly target: ScreenTarget | null;
  /** Care actions sent, touches held back (and why, last), reactions played. */
  readonly sent: number;
  readonly held: number;
  readonly lastHold: CareHold | null;
  readonly reactions: number;
  readonly idleMoves: number;
  readonly contentment: number | null;
  readonly mood: string | null;
  readonly caredToday: number | null;
  readonly nickname: string | null;
  readonly celebrating: boolean;
  /** The species the 3D squishy is drawn as (redrawn when it evolves). */
  readonly drawnSpecies: string | null;
  readonly note: string;
}

type Phase = 'arriving' | 'here' | 'leaving';

export interface CloseUpScreen {
  /** Opens one of my squishies up close. */
  open: (mapId: string, squishyId: string, from: CloseUpFrom) => Promise<void>;
  /** Back to where it came from (swoops out first). */
  close: () => void;
  setUser: (user: PublicUser | null) => void;
  readonly isOpen: boolean;
  readonly debug: CloseUpDebug | null;
}

interface Bubble {
  readonly node: HTMLElement;
  readonly until: number;
}

export function createCloseUpScreen(options: CloseUpScreenOptions): CloseUpScreen {
  const api = options.api ?? careApi;
  const registry = visualRegistry(GAME_DATA);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let mapId: string | null = null;
  let squishyId: string | null = null;
  let from: CloseUpFrom = 'map';
  let reply: CareListResponse | null = null;
  let replyAt = 0;
  let phase: Phase = 'arriving';
  let phaseAt = 0;
  let scene3d: CloseUpScene | null = null;
  let lastTier: QualityTier | null = null;
  let backdrop: HTMLCanvasElement | null = null;
  let backdropMs: number | null = null;
  let snapshotMs: number | null = null;
  /** Face to face, framed for the space above the card (see `frameFor`). */
  let framed: { pose: ClosePose; drop: number } = { pose: CAMERA_POSES.face, drop: 0 };
  /** Bumped on every open, close and user change, so a late reply is dropped. */
  let ticket = 0;
  let frame = 0;
  let lastBreathDraw = 0;
  let idleTimer: number | undefined;
  let idle: { move: IdleMove; start: number } | null = null;
  let readyTimer: number | undefined;
  const inFlight = new Set<string>();
  let renaming = false;
  let counts = { sent: 0, held: 0, reactions: 0, idleMoves: 0 };
  let lastHold: CareHold | null = null;
  let bubble: Bubble | null = null;

  // ── DOM ───────────────────────────────────────────────────────────────
  const layer = el('div', { class: 'close-up-touch', 'data-testid': 'close-up-touch' });
  const back = el(
    'button',
    { type: 'button', class: 'close-up-back', 'data-testid': 'close-up-back' },
    el('span', { 'aria-hidden': 'true' }, '⌄'),
    ` ${CLOSE_UP_TEXT.back}`,
  );
  const title = el('h1', { class: 'close-up-name', id: 'close-up-title' });
  // Name and Back sit at the top of the bottom card: reachable one-handed
  // (style guide §3.2), and clear of the account chip at the top right.
  const top = el('header', { class: 'close-up-top' }, title, back);
  const bubbles = el('div', { class: 'close-up-bubbles', 'aria-hidden': 'true' });
  const mood = el('p', { class: 'care-mood', 'data-testid': 'close-up-mood' });
  const heartsFill = el('div', { class: 'care-meter-fill care-hearts' });
  const hearts = el('div', { class: 'care-meter', 'aria-hidden': 'true' }, heartsFill);
  const actions = el('div', { class: 'care-actions' });
  const note = el('p', { class: 'care-note', role: 'status', 'data-testid': 'close-up-note' });
  const hint = el('p', { class: 'close-up-hint' }, CLOSE_UP_TEXT.hint);

  const level = el('p', { class: 'care-level' });
  const xpFill = el('div', { class: 'care-meter-fill care-xp' });
  const xpLine = el('p', { class: 'care-xp-line' });
  const facts = el('dl', { class: 'close-up-facts', 'data-testid': 'close-up-facts' });
  const moves = el('ul', { class: 'close-up-moves', 'data-testid': 'close-up-moves' });
  const infoList = el('ul', { class: 'care-info' });
  const renameInput = el('input', {
    type: 'text',
    class: 'close-up-rename-input',
    'aria-label': CLOSE_UP_TEXT.nameLabel,
    'data-testid': 'close-up-rename-input',
    autocomplete: 'off',
    autocapitalize: 'words',
    spellcheck: 'false',
    enterkeyhint: 'done',
  });
  const renameStatus = el('p', { class: 'close-up-rename-status', role: 'status' });
  const renameSave = el(
    'button',
    { type: 'submit', class: 'auth-button', 'data-testid': 'close-up-rename-save' },
    CLOSE_UP_TEXT.save,
  );
  const renameClear = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft' },
    CLOSE_UP_TEXT.clear,
  );
  const renameCancel = el(
    'button',
    { type: 'button', class: 'auth-button auth-button-soft' },
    CLOSE_UP_TEXT.cancel,
  );
  const renameForm = el(
    'form',
    { class: 'close-up-rename', 'data-testid': 'close-up-rename' },
    renameInput,
    renameStatus,
    el('div', { class: 'close-up-row' }, renameSave, renameCancel),
    renameClear,
  );
  renameForm.hidden = true;
  const renameOpen = el(
    'button',
    {
      type: 'button',
      class: 'auth-button auth-button-soft',
      'data-testid': 'close-up-rename-open',
    },
    `✏️ ${CLOSE_UP_TEXT.rename}`,
  );
  const about = el(
    'details',
    { class: 'care-details close-up-about', 'data-testid': 'close-up-about' },
    el('summary', {}, CLOSE_UP_TEXT.about),
    level,
    el('div', { class: 'care-meter', 'aria-hidden': 'true' }, xpFill),
    xpLine,
    facts,
    el('h2', { class: 'close-up-subtitle' }, CLOSE_UP_TEXT.moves),
    moves,
    infoList,
    renameOpen,
    renameForm,
  );

  const celebrateLine = el('p', { class: 'care-celebrate-line' });
  const yay = el(
    'button',
    { type: 'button', class: 'auth-button', 'data-testid': 'close-up-yay' },
    CARE_TEXT.yay,
  );
  const celebrate = el(
    'div',
    { class: 'care-celebrate close-up-celebrate', 'data-testid': 'close-up-celebrate' },
    el('h2', { class: 'care-celebrate-title' }, CARE_TEXT.evolvedTitle),
    celebrateLine,
    yay,
  );
  celebrate.hidden = true;
  const sparkles = el(
    'div',
    { class: 'close-up-sparkles', 'aria-hidden': 'true' },
    ...['✨', '💖', '✨', '⭐', '✨', '💖'].map((s) => el('span', {}, s)),
  );

  const card = el(
    'section',
    { class: 'auth-card close-up-card' },
    top,
    celebrate,
    mood,
    hearts,
    actions,
    note,
    hint,
    about,
  );
  const treat = el('div', { class: 'close-up-treat', 'aria-hidden': 'true' }, '🍪');
  treat.hidden = true;
  const veil = el('div', { class: 'close-up-veil', 'aria-hidden': 'true' });
  const overlay = el(
    'div',
    {
      class: 'close-up',
      role: 'dialog',
      'aria-labelledby': 'close-up-title',
      'data-testid': 'close-up',
    },
    layer,
    sparkles,
    bubbles,
    card,
    treat,
  );
  overlay.hidden = true;
  veil.hidden = true;
  options.root.append(overlay, veil);

  // ── State helpers ─────────────────────────────────────────────────────
  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  const setReply = (next: CareListResponse | null) => {
    reply = next;
    replyAt = performance.now();
  };
  /** The species the 3D squishy was built as. */
  let builtSpecies: string | null = null;
  /** The squishy left while up close: touches do nothing until it swoops out. */
  let gone = false;
  let goneTimer: number | undefined;

  /**
   * A fresh list from the server: the squishy may have evolved (redraw it as
   * its new form) or left (taken to the Hollow overnight: say so and go back).
   */
  function accept(next: CareListResponse, why?: string): void {
    setReply(next);
    const squishy = current();
    if (!squishy) {
      // Say why with the card still up, then swoop out (Back works at once).
      // Two replies can find it gone (a boop and a stroke both refused): once.
      if (gone) return;
      note.textContent = why ?? CLOSE_UP_TEXT.gone;
      gone = true;
      celebrate.hidden = true;
      showRename(false);
      window.clearTimeout(idleTimer);
      const mine = ticket;
      goneTimer = window.setTimeout(() => {
        if (mine === ticket) close();
      }, GONE_MS);
      return;
    }
    if (builtSpecies !== null && squishy.speciesId !== builtSpecies) options.showScene(build);
    render();
  }
  /** The server's time now, as reckoned from the last reply (a phone's own clock may be off). */
  const serverNow = (): number =>
    reply ? Date.parse(reply.now) + (performance.now() - replyAt) : 0;
  const current = (): CareSquishy | null =>
    reply?.squishies.find((s) => s.id === squishyId) ?? null;
  const isOpen = () => mapId !== null;

  const view = () => {
    const rect = layer.getBoundingClientRect();
    return {
      width: rect.width || window.innerWidth,
      height: rect.height || window.innerHeight,
      fov: CAMERA_FOV,
    };
  };
  /** The squishy on screen; the middle of the view if there's no scene (no renderer). */
  const target = (): ScreenTarget => {
    const v = view();
    return (
      scene3d?.target(v) ?? {
        x: v.width / 2,
        y: v.height * 0.4,
        rx: v.width * 0.25,
        ry: v.width * 0.25,
      }
    );
  };

  // ── Rendering the overlay ─────────────────────────────────────────────
  function render(): void {
    window.clearTimeout(readyTimer);
    readyTimer = undefined;
    const squishy = current();
    if (!reply || !squishy) return;
    const now = serverNow();
    const model = infoCard(squishy, reply, now);
    title.textContent = model.name;
    mood.textContent = model.mood;
    heartsFill.style.width = `${String(Math.round(model.hearts * 100))}%`;
    level.textContent = model.level;
    xpFill.style.width = `${String(Math.round(model.xp * 100))}%`;
    xpLine.textContent = model.xpLine;
    const fact = (term: string, value: string) => [el('dt', {}, term), el('dd', {}, value)];
    facts.replaceChildren(
      ...fact(CLOSE_UP_TEXT.element, model.element),
      ...fact(CLOSE_UP_TEXT.feeling, model.feeling),
    );
    moves.replaceChildren(...model.moves.map((m) => el('li', {}, m)));
    infoList.replaceChildren(...model.info.map((line) => el('li', {}, line)));
    renameClear.hidden = model.nickname === null;
    // Built once and updated in place, so a reply landing mid-drag can't
    // pull the Feed button out from under a finger.
    for (const b of model.buttons) {
      const button = actionButton(b.action);
      button.replaceChildren(
        b.label,
        ...(b.note ? [el('span', { class: 'care-action-note' }, b.note)] : []),
      );
    }
    const evolved = evolutionLine(squishy, speciesById(reply));
    const wasHidden = celebrate.hidden;
    celebrate.hidden = evolved === null;
    if (evolved) {
      celebrateLine.textContent = evolved;
      // Once it's face to face (the swoop landing celebrates one that was waiting).
      if (wasHidden && phase === 'here') celebrateNow();
    }
    // The "Just a sec…" notes come off by themselves (one timer, the soonest).
    const wait = nextReadyIn(squishy, now);
    if (wait !== null) readyTimer = window.setTimeout(render, wait + 50);
  }

  /** The buttons are the gestures' visible twins (style guide §3.3). */
  const BUTTON_TOUCH: Readonly<Record<string, CloseUpTouch>> = {
    feed: 'treat',
    pet: 'stroke',
    play: 'boop',
  };
  const buttons = new Map<string, HTMLButtonElement>();

  /** The button for a care action, made the first time it's needed. */
  function actionButton(action: string): HTMLButtonElement {
    const existing = buttons.get(action);
    if (existing) return existing;
    const button = el('button', {
      type: 'button',
      class: 'auth-button care-action',
      'data-care': action,
    });
    // Never disabled: a resting touch still gets its reaction (it just isn't sent).
    button.addEventListener('click', () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      touch(BUTTON_TOUCH[action] ?? 'boop');
    });
    if (action === 'feed') wireTreatDrag(button);
    buttons.set(action, button);
    actions.append(button);
    return button;
  }

  function celebrateNow(): void {
    sparkles.classList.remove('close-up-sparkles-on');
    sparkles.getBoundingClientRect(); // restart the animation
    sparkles.classList.add('close-up-sparkles-on');
    scene3d?.play('bounce', performance.now(), 1.5);
    kick();
  }

  // ── Bubbles over its head ─────────────────────────────────────────────
  function say(text: string | null): void {
    bubble?.node.remove();
    bubble = null;
    if (!text) return;
    const node = el('span', { class: 'close-up-bubble' }, text);
    bubbles.append(node);
    bubble = { node, until: performance.now() + BUBBLE_MS };
    placeBubble();
  }

  /** Bubbles sit by the squishy's head, kept clear of the account chip at the top. */
  function placeBubble(): void {
    if (!bubble) return;
    const t = target();
    const x = t.x + t.rx * 0.55;
    const y = Math.max(BUBBLE_TOP_PX, t.y - t.ry * 0.7);
    bubble.node.style.transform = `translate(${String(Math.round(x))}px, ${String(Math.round(y))}px)`;
  }

  // ── Reactions and care ────────────────────────────────────────────────
  function react(reaction: Reaction): void {
    counts = { ...counts, reactions: counts.reactions + 1 };
    const now = performance.now();
    scene3d?.play(reaction.move, now, reaction.strength);
    say(reaction.bubble);
    if (reaction.blush) {
      overlay.classList.remove('close-up-blush');
      overlay.getBoundingClientRect();
      overlay.classList.add('close-up-blush');
    }
    // A touch stops any idle move, and the next one waits a little longer.
    idle = null;
    scene3d?.setPose(REST_POSE);
    scheduleIdle(IDLE.afterTouchMs);
    kick();
  }

  function touch(kind: CloseUpTouch): void {
    const squishy = current();
    const map = mapId;
    const id = squishyId;
    if (!squishy || !reply || !map || !id || phase === 'leaving' || gone) return;
    hint.hidden = true;
    const decision = careDecision(kind, squishy, reply, serverNow(), inFlight);
    react(reactionFor(kind, decision.hold));
    options.onTouch?.(kind);
    if (decision.hold !== null) {
      counts = { ...counts, held: counts.held + 1 };
      lastHold = decision.hold;
      if (decision.hold === 'noTreats') note.textContent = CLOSE_UP_TEXT.noTreats;
      else if (decision.hold === 'resting') note.textContent = CLOSE_UP_TEXT.resting;
      return;
    }
    void send(map, id, decision.action);
  }

  async function send(map: string, id: string, action: string): Promise<void> {
    const mine = ticket;
    inFlight.add(action);
    counts = { ...counts, sent: counts.sent + 1 };
    try {
      const next = await sendCommand(
        sendDeps,
        (key) => api.care(map, id, action, key),
        () => mine === ticket,
      );
      if (!next || mine !== ticket) return;
      note.textContent = careDoneLine(next.result);
      accept(next);
    } catch (err) {
      if (mine !== ticket) return;
      note.textContent = messageOf(err);
      // The debounce or the bag changed under us: show the server's view again.
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        const fresh = await api.list(map).catch(() => null);
        if (fresh && mine === ticket) {
          accept(fresh, messageOf(err));
          return;
        }
      }
    } finally {
      inFlight.delete(action);
      if (mine === ticket && phase !== 'leaving') render();
    }
  }

  // ── Dragging a treat over (the Feed button) ───────────────────────────
  let suppressClick = false;
  function wireTreatDrag(button: HTMLButtonElement): void {
    let drag: { id: number; x: number; y: number; moving: boolean } | null = null;
    const end = (e: PointerEvent, drop: boolean) => {
      if (drag?.id !== e.pointerId) return;
      const was = drag;
      drag = null;
      treat.hidden = true;
      if (!was.moving) return;
      // The click that follows a drag isn't a tap on Feed.
      suppressClick = true;
      window.setTimeout(() => {
        suppressClick = false;
      }, 400);
      const rect = layer.getBoundingClientRect();
      if (drop && onTarget(target(), e.clientX - rect.left, e.clientY - rect.top)) touch('treat');
    };
    button.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moving: false };
      capture(button, e.pointerId);
    });
    button.addEventListener('pointermove', (e) => {
      if (drag?.id !== e.pointerId) return;
      if (!drag.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 12) {
        drag.moving = true;
        treat.hidden = false;
      }
      if (drag.moving) {
        treat.style.transform = `translate(${String(e.clientX)}px, ${String(e.clientY)}px)`;
      }
    });
    button.addEventListener('pointerup', (e) => {
      end(e, true);
    });
    button.addEventListener('pointercancel', (e) => {
      end(e, false);
    });
  }

  // ── Gestures on the squishy ───────────────────────────────────────────
  /** Keeps a finger's events coming here even when it slides off (best effort). */
  const capture = (node: HTMLElement, pointerId: number) => {
    try {
      node.setPointerCapture(pointerId);
    } catch {
      // Not an active pointer (a synthetic event): nothing to capture.
    }
  };
  const gestures = new GestureReader(target, (gesture) => {
    if (gesture === 'back') close();
    else touch(gesture);
  });
  const point = (e: PointerEvent): GesturePoint => {
    const rect = layer.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - rect.left, y: e.clientY - rect.top, t: e.timeStamp };
  };
  layer.addEventListener('pointerdown', (e) => {
    capture(layer, e.pointerId);
    gestures.down(point(e));
  });
  layer.addEventListener('pointermove', (e) => {
    gestures.move(point(e));
  });
  layer.addEventListener('pointerup', (e) => {
    gestures.up(point(e));
  });
  layer.addEventListener('pointercancel', (e) => {
    gestures.cancel(point(e));
  });

  back.addEventListener('click', () => {
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen() && !renaming) close();
  });

  // ── Rename ────────────────────────────────────────────────────────────
  function showRename(on: boolean): void {
    renaming = on;
    renameForm.hidden = !on;
    renameOpen.hidden = on;
    renameStatus.textContent = '';
    if (on) {
      renameInput.value = current()?.nickname ?? '';
      renameInput.focus();
    }
  }
  renameOpen.addEventListener('click', () => {
    showRename(true);
  });
  renameCancel.addEventListener('click', () => {
    showRename(false);
  });
  renameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const checked = checkNickname(renameInput.value);
    if (!checked.ok) {
      renameStatus.textContent = checked.why;
      return;
    }
    void rename(checked.name);
  });
  renameClear.addEventListener('click', () => {
    void rename(null);
  });

  async function rename(nickname: string | null): Promise<void> {
    const map = mapId;
    const id = squishyId;
    if (!map || !id) return;
    const mine = ticket;
    renameSave.disabled = true;
    renameClear.disabled = true;
    try {
      const next = await sendCommand(
        sendDeps,
        (key) => api.rename(map, id, nickname, key),
        () => mine === ticket,
      );
      if (!next || mine !== ticket) return;
      setReply(next);
      showRename(false);
      render();
      const renamed = current();
      if (renamed) note.textContent = CLOSE_UP_TEXT.renamed(infoCard(renamed, next).name);
      react(reactionFor('boop', null));
    } catch (err) {
      // The server's friendly words (the text filter's included).
      if (mine === ticket) renameStatus.textContent = messageOf(err);
    } finally {
      renameSave.disabled = false;
      renameClear.disabled = false;
    }
  }

  // ── Evolution celebration ─────────────────────────────────────────────
  yay.addEventListener('click', () => {
    const map = mapId;
    const id = squishyId;
    if (!map || !id) return;
    const mine = ticket;
    celebrate.hidden = true;
    sendCommand(
      sendDeps,
      (key) => api.seen(map, id, key),
      () => mine === ticket,
    )
      .then((next) => {
        if (next && mine === ticket) accept(next);
      })
      .catch((err: unknown) => {
        if (mine === ticket) note.textContent = messageOf(err);
      });
  });

  // ── Idle personality ──────────────────────────────────────────────────
  function scheduleIdle(delay = nextIdleIn(Math.random())): void {
    window.clearTimeout(idleTimer);
    idleTimer = undefined;
    if (!isOpen() || reducedMotion.matches) return;
    idleTimer = window.setTimeout(() => {
      idleTimer = undefined;
      const squishy = current();
      if (!squishy || phase !== 'here' || gestures.fingers > 0 || document.hidden) {
        scheduleIdle();
        return;
      }
      const move = idleMoveFor(squishy.feeling);
      idle = { move, start: performance.now() };
      counts = { ...counts, idleMoves: counts.idleMoves + 1 };
      if (move.squish) scene3d?.play(move.squish, performance.now(), 0.8);
      say(move.bubble);
      kick();
      scheduleIdle();
    }, delay);
  }
  reducedMotion.addEventListener('change', () => {
    scheduleIdle();
    kick();
  });

  // ── Scene and frames ──────────────────────────────────────────────────
  const build = (scene: Scene): SceneContent => {
    const squishy = current();
    const species = squishy && reply ? speciesById(reply).get(squishy.speciesId) : undefined;
    if (!squishy || !species) throw new Error('no squishy to build');
    lastTier = options.tier();
    builtSpecies = squishy.speciesId;
    const built = new CloseUpScene(scene, {
      registry,
      lod: heroLodFor(lastTier),
      species,
      instanceId: squishy.id,
      backdrop,
      breathing: !reducedMotion.matches,
    });
    scene.onDisposeObservable.addOnce(() => {
      if (scene3d === built) scene3d = null;
    });
    scene3d = built;
    reframe();
    const at = cameraPose(performance.now());
    built.setCamera(at.pose, at.drop);
    return built.content;
  };

  /** The camera now: swooping in, face to face, or swooping out. */
  function cameraPose(now: number): { pose: ClosePose; drop: number } {
    const start = CAMERA_POSES.from;
    if (reducedMotion.matches) return framed;
    if (phase === 'arriving') {
      const t = easeOutCubic((now - phaseAt) / SWOOP.inMs);
      return { pose: poseBetween(start, framed.pose, t), drop: framed.drop * t };
    }
    if (phase === 'leaving') {
      // From wherever it was (Back mid-swoop doesn't jump forward first).
      const t = easeInOutSine((now - phaseAt) / SWOOP.outMs);
      return { pose: poseBetween(leaveFrom.pose, start, t), drop: leaveFrom.drop * (1 - t) };
    }
    return framed;
  }
  /** The camera when Back was pressed. */
  let leaveFrom: { pose: ClosePose; drop: number } = framed;

  /**
   * Frames the squishy in the space above the card (as it is with About
   * shut, so opening it doesn't move the squishy). On open and on resize.
   */
  function reframe(): void {
    const s = scene3d;
    if (!s || about.open) return;
    const v = view();
    const cardTop = card.getBoundingClientRect().top - layer.getBoundingClientRect().top;
    framed = frameFor(CAMERA_POSES.face, s.height, v, cardTop > 0 ? cardTop : v.height);
    if (phase === 'here') {
      s.setCamera(framed.pose, framed.drop);
      options.invalidate();
    }
  }
  window.addEventListener('resize', () => {
    if (isOpen()) reframe();
  });
  about.addEventListener('toggle', () => {
    card.classList.toggle('close-up-reading', about.open);
  });

  /** Starts the frame loop if it isn't running. */
  function kick(): void {
    if (frame === 0 && isOpen()) frame = requestAnimationFrame(tick);
  }

  /**
   * One frame of the close-up (render on demand, tech spec §6): every frame
   * while the camera swoops or a reaction or idle move plays, about 30 a
   * second while the squishy only breathes, and nothing at all when it's
   * still (reduced motion) or the app is in the background.
   */
  function tick(): void {
    frame = 0;
    if (!isOpen()) return;
    const now = performance.now();
    const s = scene3d;
    const tier = options.tier();
    if (s && tier !== lastTier) {
      lastTier = tier;
      s.setLod(heroLodFor(tier));
      options.invalidate();
    }
    let busy = false;
    const swoopMs = phase === 'arriving' ? SWOOP.inMs : phase === 'leaving' ? SWOOP.outMs : 0;
    // The swoop starts with the first frame that has the squishy in it
    // (shaders compile first), so none of it is missed.
    if (phase === 'arriving' && s && !s.drawn) phaseAt = now;
    if (phase !== 'here') {
      busy = true;
      const at = cameraPose(now);
      s?.setCamera(at.pose, at.drop);
      if (now - phaseAt >= swoopMs || reducedMotion.matches) {
        if (phase === 'arriving') {
          phase = 'here';
          phaseAt = now;
          overlay.classList.add('close-up-ready');
          if (!celebrate.hidden) celebrateNow();
          scheduleIdle();
        } else {
          finishLeaving();
          return;
        }
      }
    }
    if (idle) {
      const t = (now - idle.start) / idle.move.ms;
      s?.setPose(t >= 1 ? REST_POSE : idlePose(idle.move, t));
      if (t >= 1) idle = null;
      busy = true;
    }
    if (bubble) {
      if (now >= bubble.until) say(null);
      else placeBubble();
    }
    if (s?.isPlaying(now)) busy = true;
    if (busy) {
      s?.update(now);
      options.invalidate();
    } else if (reducedMotion.matches) {
      // Still (no breathing): nothing to draw until something happens.
      if (!bubble) return;
    } else if (now - lastBreathDraw >= BREATHING_FRAME_MS) {
      // Breathing only: move and draw once per ask, about 30 a second.
      lastBreathDraw = now;
      if (s?.update(now)) options.requestFrame();
      else if (!bubble) return;
    }
    if (!document.hidden) frame = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', () => {
    if (!isOpen()) return;
    if (!document.hidden) {
      kick();
      // Back from the background: catch up with care done elsewhere (or an evolution).
      void refresh();
    }
  });

  async function refresh(): Promise<void> {
    const map = mapId;
    const mine = ticket;
    if (!map) return;
    const fresh = await api.list(map).catch(() => null);
    if (fresh && mine === ticket) accept(fresh);
  }

  // ── Open and close ────────────────────────────────────────────────────
  async function open(map: string, id: string, origin: CloseUpFrom): Promise<void> {
    if (isOpen()) hide();
    const mine = (ticket += 1);
    // The view the player is looking at, blurred, becomes the backdrop. Read
    // now, in this task, while the canvas still holds the frame just drawn.
    const started = performance.now();
    const shot = options.snapshot();
    const shotAt = performance.now();
    const blurred = shot ? blurredBackdrop(shot) : null;
    const took = blurred ? { snapshot: shotAt - started, blur: performance.now() - shotAt } : null;
    let list: CareListResponse;
    try {
      list = await api.list(map);
    } catch (err) {
      if (mine === ticket) options.onProblem(messageOf(err));
      return;
    }
    if (mine !== ticket) return;
    const squishy = list.squishies.find((s) => s.id === id);
    if (!squishy || !speciesById(list).has(squishy.speciesId)) {
      options.onProblem(CLOSE_UP_TEXT.gone);
      return;
    }
    mapId = map;
    squishyId = id;
    from = origin;
    backdrop = blurred;
    snapshotMs = took?.snapshot ?? null;
    backdropMs = took?.blur ?? null;
    setReply(list);
    counts = { sent: 0, held: 0, reactions: 0, idleMoves: 0 };
    lastHold = null;
    phase = 'arriving';
    phaseAt = performance.now();
    note.textContent = '';
    hint.hidden = false;
    about.open = false;
    showRename(false);
    card.classList.remove('close-up-reading');
    celebrate.hidden = true;
    overlay.classList.remove('close-up-ready', 'close-up-blush');
    gestures.reset();
    options.onOpen(map, origin);
    overlay.hidden = false;
    render();
    options.showScene(build);
    kick();
  }

  /** Swoops out, then hands the screen back. */
  function close(): void {
    if (!isOpen() || phase === 'leaving') return;
    leaveFrom = cameraPose(performance.now());
    phase = 'leaving';
    phaseAt = performance.now();
    idle = null;
    say(null);
    window.clearTimeout(idleTimer);
    overlay.classList.remove('close-up-ready');
    overlay.classList.add('close-up-leaving');
    gestures.reset();
    kick();
  }

  function finishLeaving(): void {
    const map = mapId;
    const origin = from;
    // A soft veil hides the scene swap, then fades away over the view we came back to.
    veil.hidden = false;
    veil.classList.remove('close-up-veil-out');
    hide();
    options.showScene(null);
    if (map) options.onClosed(map, origin);
    window.setTimeout(() => {
      veil.classList.add('close-up-veil-out');
      window.setTimeout(() => {
        veil.hidden = true;
      }, SWOOP.veilMs);
    }, SWOOP.veilMs);
  }

  function hide(): void {
    ticket += 1;
    window.clearTimeout(idleTimer);
    window.clearTimeout(readyTimer);
    idleTimer = undefined;
    readyTimer = undefined;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    idle = null;
    say(null);
    inFlight.clear();
    gestures.reset();
    mapId = null;
    squishyId = null;
    reply = null;
    backdrop = null;
    builtSpecies = null;
    gone = false;
    window.clearTimeout(goneTimer);
    goneTimer = undefined;
    scene3d = null;
    renaming = false;
    overlay.hidden = true;
    overlay.classList.remove('close-up-leaving', 'close-up-ready');
    treat.hidden = true;
  }

  return {
    open,
    close,
    setUser: () => {
      if (isOpen()) hide();
    },
    get isOpen() {
      return isOpen();
    },
    get debug() {
      if (!mapId || !squishyId) return null;
      const squishy = current();
      return {
        mapId,
        squishyId,
        from,
        phase,
        swoop:
          phase === 'here'
            ? 1
            : phase === 'arriving'
              ? Math.min(1, (performance.now() - phaseAt) / SWOOP.inMs)
              : 0,
        lod: scene3d?.stats.lod ?? null,
        scene: scene3d?.stats ?? null,
        snapshotMs,
        backdropMs,
        target: scene3d ? target() : null,
        ...counts,
        lastHold,
        contentment: squishy?.contentment ?? null,
        mood: squishy?.mood ?? null,
        caredToday: squishy?.caredToday ?? null,
        nickname: squishy?.nickname ?? null,
        celebrating: !celebrate.hidden,
        drawnSpecies: builtSpecies,
        note: note.textContent,
      };
    },
  };
}
