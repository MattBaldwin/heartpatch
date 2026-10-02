import type { Scene } from '@babylonjs/core/scene';
import {
  GAME_DATA,
  visualRegistry,
  type BattleSideId,
  type KeeperConfig,
  type PlayerBattle,
  type PlayerBattleAction,
  type PublicUser,
} from '@heartpatch/shared';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { lodFor } from '../procedural/motion.js';
import { el, messageOf } from '../ui/dom.js';
import { battleApi } from './battle-api.js';
import { BREATHING_FRAME_MS, PLAYBACK, RETRY_AFTER_MS } from './battle-config.js';
import { mountBattleHud, plateSideOf, type BattleHud, type ControlMode } from './battle-hud.js';
import {
  applyStep,
  playbackSteps,
  shownFrom,
  type PlaybackStep,
  type ShownState,
} from './battle-playback.js';
import { BattleScene, type BattleSceneStats } from './battle-scene.js';
import { keeperReaction } from './keeper-reaction.js';
import { sendAction, type SubmitDeps } from './battle-submit.js';
import {
  activeOf,
  BattleContent,
  benchOf,
  energyPercent,
  nameplate,
  natureLine,
  otherSide,
} from './battle-view.js';

// The battle screen (#13): starts or resumes a PvE battle, draws it, plays the
// server's log back step by step, and sends the player's taps as intents. The
// server runs the engine; this file only shows what it sent (CLAUDE.md rule 1).

export interface BattleScreenOptions {
  root: HTMLElement;
  /** Puts a scene on screen: the arena, or the default one (null). */
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  /** Draws one frame (`Stage.requestFrame`): breathing paces itself with this. */
  requestFrame: () => void;
  /** The quality tier now (the squishies' detail level follows it). */
  tier: () => QualityTier;
  /** A battle is about to take the screen: the caller hides the map. */
  onOpen: (mapId: string) => void;
  /** The battle screen closed: the caller shows the map again. */
  onClosed: (mapId: string) => void;
  api?: typeof battleApi;
  /** Wall-clock ms (tests pass a fake). */
  now?: () => number;
  /** Dev builds show the dev grant buttons (server `HP_DEV_SQUISHY_GRANTS`). */
  devTools?: boolean;
  /** The player's Keeper (#42), to stand behind their squishy; null if not known. */
  keeper?: () => KeeperConfig | null;
  /** What the player's Keeper wears (#43), clothing ids. */
  keeperWearing?: () => readonly string[];
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface BattleDebug {
  readonly id: string;
  readonly status: PlayerBattle['status'];
  readonly turn: number;
  readonly phase: PlayerBattle['view']['phase']['type'];
  /** Energy shown on the bars right now (follows the log as it plays). */
  readonly shown: { mine: number; theirs: number };
  /** Steps of the log still to play. */
  readonly pending: number;
  readonly waiting: boolean;
  readonly winner: BattleSideId | 'draw' | null;
  readonly scene: BattleSceneStats | null;
  /** Reactions the Keeper has played in this battle (cheers, winces). */
  readonly keeperReactions: number;
}

export interface BattleScreen {
  /** The map the player is on (null when none): shows the entry button and resumes a battle going. */
  setMap: (mapId: string | null) => Promise<void>;
  setUser: (user: PublicUser | null) => void;
  /** Shows a battle (fetched or just started). */
  open: (battle: PlayerBattle) => void;
  close: () => void;
  readonly debug: BattleDebug | null;
}

const MESSAGES = {
  resultWon: 'You won! Hooray!',
  resultLost: 'Aw, tuckered out.',
  resultScooted: 'You scooted home.',
  scootedSub: 'Maybe next time!',
  resultDraw: "It's a tie!",
  resultNoContest: 'No contest!',
  wonSub: 'Everyone had a great time.',
  lostSub: 'A nap and a snack, and they’ll be ready again.',
  drawSub: 'Everyone needs a nap.',
  noContestSub: 'The squishies got distracted. Nobody won or lost.',
  noXp: 'No XP this time.',
  done: 'Back to patch',
} as const;

export function createBattleScreen(options: BattleScreenOptions): BattleScreen {
  const api = options.api ?? battleApi;
  const now = options.now ?? (() => performance.now());
  const registry = visualRegistry(GAME_DATA);

  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let battle: PlayerBattle | null = null;
  /** Keeper reactions played in the battle on screen (the dev hook counts them). */
  let keeperReactions = 0;
  let content: BattleContent | null = null;
  let scene3d: BattleScene | null = null;
  let shown: ShownState | null = null;
  /** Log entries already played. */
  let shownLog = 0;
  let queue: PlaybackStep[] = [];
  let waiting = false;
  let frame = 0;
  let lastBreathDraw = 0;
  let lastTier: QualityTier | null = null;
  const timers = new Set<number>();

  // ── Entry button (shown over the map) ─────────────────────────────────
  const note = el('p', { class: 'battle-entry-note', role: 'status' });
  const enter = el(
    'button',
    { type: 'button', class: 'auth-button battle-entry', 'data-testid': 'battle-entry' },
    'Battle',
  );
  const entry = el('div', { class: 'battle-entry-box' }, enter, note);
  entry.hidden = true;
  options.root.append(entry);

  /**
   * Runs an entry action for the map on screen now. A reply that lands after
   * the player moved on (another map, the Glade, logout, a battle opened
   * another way) is dropped, so it can never open a battle over the wrong screen.
   */
  const busy = (start: (id: string) => Promise<PlayerBattle | null>) => {
    const id = mapId;
    const who = user;
    if (!id || enter.disabled) return;
    enter.disabled = true;
    note.textContent = '';
    const stillHere = () => mapId === id && user === who && battle === null;
    start(id)
      .then((next) => {
        if (next && stillHere()) open(next);
      })
      .catch((err: unknown) => {
        if (!stillHere()) return;
        note.textContent = messageOf(err);
      })
      .finally(() => {
        enter.disabled = false;
      });
  };
  enter.addEventListener('click', () => {
    busy((id) => api.startWild(id));
  });
  if (options.devTools) {
    const grant = el(
      'button',
      {
        type: 'button',
        class: 'auth-button auth-button-soft auth-button-small',
        'data-testid': 'battle-dev-grant',
      },
      'Dev: new squishy',
    );
    grant.addEventListener('click', () => {
      busy(async (id) => {
        const squishy = await api.dev.grantSquishy(id);
        note.textContent = `A ${content?.speciesName(squishy.speciesId) ?? 'squishy'} joined you! (dev)`;
        return null;
      });
    });
    const fight = el(
      'button',
      {
        type: 'button',
        class: 'auth-button auth-button-soft auth-button-small',
        'data-testid': 'battle-dev-fight',
      },
      'Dev: pick a fight',
    );
    fight.addEventListener('click', () => {
      busy((id) => api.dev.pickFight(id));
    });
    entry.append(el('div', { class: 'battle-row' }, grant, fight));
  }

  // ── HUD ───────────────────────────────────────────────────────────────
  const hud: BattleHud = mountBattleHud(options.root, {
    onAction: (action) => void submit(action),
    onDone: () => {
      close();
    },
    onLeave: () => {
      // Leaving mid-battle keeps the battle: it resumes on the next visit.
      close();
    },
  });

  const later = (ms: number, fn: () => void): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const clearTimers = (): void => {
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };

  /** Fills a side's plate from the view, with the energy currently shown. */
  const plate = (side: BattleSideId): void => {
    if (!battle || !content || !shown) return;
    const { squishies } = battle.view.sides[side];
    const slot = shown[side].active;
    const squishy = squishies[slot];
    if (!squishy) return;
    const energy = shown[side].energy[slot] ?? squishy.energy;
    const status = squishy.status
      ? squishy.status.id === 'dizzy'
        ? 'Dizzy'
        : 'Sleepy'
      : energy === 0
        ? 'Tuckered out'
        : null;
    hud.setPlate(plateSideOf(battle.mySide, side), {
      name: nameplate(content, squishy),
      nature: natureLine(squishy),
      percent: energyPercent({ energy, stats: squishy.stats }),
      energyText: `${String(energy)} / ${String(squishy.stats.hp)} energy`,
      status,
    });
  };

  const controlsFor = (b: PlayerBattle): ControlMode => {
    const names = content;
    if (!names || b.status !== 'active') return { type: 'hidden' };
    const bench = benchOf(b, b.mySide).map(({ slot, squishy }) => ({
      slot,
      name: names.speciesName(squishy.speciesId),
    }));
    switch (b.view.phase.type) {
      case 'turn':
        return {
          type: 'choose',
          moves: activeOf(b, b.mySide).moves.map((id) => ({ id, name: names.moveName(id) })),
          bench,
        };
      case 'replace':
        return b.view.phase.sides.includes(b.mySide)
          ? { type: 'replace', bench }
          : { type: 'waiting' };
      case 'over':
        return { type: 'hidden' };
    }
  };

  const showResult = (b: PlayerBattle): void => {
    const names = content;
    if (!names) return;
    const result = b.view.phase.type === 'over' ? b.view.phase.result : null;
    const mine = b.view.sides[b.mySide];
    const xp = (result?.xp ?? [])
      .filter((award) => award.side === b.mySide && award.xp > 0)
      .map((award) => {
        const squishy = mine.squishies.find((s) => s.id === award.squishyId);
        const name = squishy ? names.speciesName(squishy.speciesId) : 'Your squishy';
        return `${name} earned ${String(award.xp)} XP!`;
      });
    const outcome =
      b.status === 'no-contest' || !result
        ? { title: MESSAGES.resultNoContest, subtitle: MESSAGES.noContestSub }
        : result.winner === 'draw'
          ? { title: MESSAGES.resultDraw, subtitle: MESSAGES.drawSub }
          : result.winner === b.mySide
            ? { title: MESSAGES.resultWon, subtitle: MESSAGES.wonSub }
            : result.reason === 'forfeit'
              ? { title: MESSAGES.resultScooted, subtitle: MESSAGES.scootedSub }
              : { title: MESSAGES.resultLost, subtitle: MESSAGES.lostSub };
    hud.setCaption(null);
    hud.showResult({ ...outcome, xp: xp.length > 0 ? xp : [MESSAGES.noXp], done: MESSAGES.done });
  };

  /** Everything the log has played: the view is the truth now. */
  const settle = (): void => {
    if (!battle) return;
    shown = shownFrom(battle);
    shownLog = battle.view.log.length;
    plate('a');
    plate('b');
    if (battle.status === 'active') {
      hud.setControls(controlsFor(battle));
      if (battle.view.phase.type === 'replace' && battle.view.phase.sides.includes(battle.mySide)) {
        hud.setCaption('Your squishy is tuckered out. Who comes out next?');
      } else if (battle.view.log.length === 0) {
        hud.setCaption('A wild squishy wants to play!');
      }
    } else {
      showResult(battle);
    }
    options.invalidate();
  };

  /** Plays the next queued step, then the next, until the queue is empty. */
  const playNext = (): void => {
    const step = queue.shift();
    if (!step || !battle || !scene3d || !shown || !content) {
      queue = [];
      settle();
      return;
    }
    const t = now();
    hud.setCaption(step.text);
    shown = applyStep(shown, step);
    if (step.kind === 'swap' && step.to !== null) {
      const squishy = battle.view.sides[step.side].squishies[step.to];
      if (squishy) scene3d.sendOut(step.side, squishy.speciesId, squishy.id);
      if (step.squish) scene3d.play(step.side, step.squish, t);
    } else if (step.kind === 'tuckered') {
      scene3d.tuckerOut(step.side, t);
      const side = step.side;
      later(PLAYBACK.tuckeredMs * 0.6, () => scene3d?.lieDown(side));
    } else if (step.squish) {
      scene3d.play(step.side, step.squish, t);
    }
    if (step.kind === 'end' && step.squish) scene3d.play(otherSide(step.side), 'wobble', t, 0.6);
    const reaction = keeperReaction(step, battle.mySide);
    if (reaction && scene3d.hasKeeper) {
      scene3d.cheer(reaction.move, t, reaction.strength);
      keeperReactions += 1;
    }
    if (step.callout) hud.callout(plateSideOf(battle.mySide, step.side), step.callout);
    plate(step.side);
    options.invalidate();
    later(step.ms, playNext);
  };

  /** A new view from the server: play what's new, then settle on it. */
  const receive = (next: PlayerBattle): void => {
    if (!battle || !content || next.id !== battle.id) {
      open(next);
      return;
    }
    const from = Math.min(shownLog, next.view.log.length);
    battle = next;
    content = new BattleContent(next);
    queue = playbackSteps(next, content, from);
    hud.setControls({ type: 'waiting' });
    if (queue.length === 0) settle();
    else playNext();
  };

  const submitDeps: SubmitDeps = {
    act: api.act,
    newKey: newIdempotencyKey,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: RETRY_AFTER_MS,
  };

  async function submit(action: PlayerBattleAction): Promise<void> {
    const current = battle;
    if (!current || waiting || queue.length > 0) return;
    // Replies and errors are for this battle only: once the player has left
    // it (Back, logout, the map closing), nothing here touches the screen.
    const stillOpen = () => battle?.id === current.id;
    waiting = true;
    hud.setControls({ type: 'waiting' });
    try {
      const reply = await sendAction(submitDeps, current, action, stillOpen);
      if (reply && stillOpen()) receive(reply);
    } catch (err) {
      if (!stillOpen()) return;
      hud.setProblem(messageOf(err));
      // The battle moved on without us (another tab, a retry): show where it is.
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        try {
          const fresh = await api.get(current.id);
          if (stillOpen()) receive(fresh);
        } catch {
          if (stillOpen()) hud.setControls(controlsFor(current));
        }
      } else {
        hud.setControls(controlsFor(current));
      }
    } finally {
      // Only this battle's submit may clear the flag: a late reply from one
      // the player left must not unlock another battle's controls.
      if (stillOpen()) waiting = false;
    }
  }

  // ── Scene ─────────────────────────────────────────────────────────────
  const build = (scene: Scene): SceneContent => {
    if (!battle || !content || !shown) throw new Error('no battle to build');
    const built = new BattleScene(scene, {
      registry,
      lod: lodFor('closeUp', options.tier()),
      content,
      mySide: battle.mySide,
      keeper: options.keeper?.() ?? null,
      keeperWearing: options.keeperWearing?.() ?? [],
    });
    lastTier = options.tier();
    for (const side of ['a', 'b'] as const) {
      const slot = shown[side].active;
      const squishy = battle.view.sides[side].squishies[slot];
      if (squishy) {
        built.sendOut(side, squishy.speciesId, squishy.id);
        if ((shown[side].energy[slot] ?? 1) === 0) {
          built.tuckerOut(side, now());
          built.lieDown(side);
        }
      }
    }
    scene3d = built;
    return built.content;
  };

  /**
   * Drives motion (render on demand, tech spec §6): every frame while a
   * squish move plays, at most 30 fps while the squishies only breathe, and
   * follows the quality governor's tier with the detail level.
   */
  const tick = (): void => {
    frame = 0;
    const s = scene3d;
    if (!s || !hud.visible) return;
    const tier = options.tier();
    if (tier !== lastTier) {
      lastTier = tier;
      s.setLod(lodFor('closeUp', tier));
      options.invalidate();
    }
    const t = now();
    if (s.isPlaying(t)) {
      s.update(t);
      options.invalidate();
    } else if (t - lastBreathDraw >= BREATHING_FRAME_MS) {
      // Breathing only: move and draw once per ask, about 30 a second.
      lastBreathDraw = t;
      if (s.update(t)) options.requestFrame();
    }
    frame = requestAnimationFrame(tick);
  };

  function open(next: PlayerBattle): void {
    const wasOpen = battle !== null;
    clearTimers();
    queue = [];
    waiting = false;
    battle = next;
    content = new BattleContent(next);
    shown = shownFrom(next);
    shownLog = next.view.log.length;
    scene3d = null;
    keeperReactions = 0;
    if (!wasOpen) options.onOpen(next.mapId);
    entry.hidden = true;
    hud.hideResult();
    hud.setProblem('');
    hud.show();
    options.showScene(build);
    settle();
    if (next.view.log.length > 0 && next.status === 'active') {
      hud.setCaption('Welcome back! The showdown is still on.');
    }
    if (frame === 0) frame = requestAnimationFrame(tick);
  }

  /** Takes the battle off screen; `returnToMap` hands the screen back to the map. */
  function close(returnToMap = true): void {
    const closedMap = returnToMap ? (battle?.mapId ?? null) : null;
    clearTimers();
    queue = [];
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    battle = null;
    content = null;
    shown = null;
    scene3d = null;
    hud.hide();
    options.showScene(null);
    entry.hidden = mapId === null;
    if (closedMap !== null) options.onClosed(closedMap);
  }

  return {
    setMap: async (next) => {
      mapId = next;
      if (next === null) {
        if (battle) close(false);
        entry.hidden = true;
        return;
      }
      entry.hidden = battle !== null;
      note.textContent = '';
      // Refreshing mid-battle resumes it (unless the player moved on meanwhile).
      const who = user;
      try {
        const going = await api.current(next);
        if (going && mapId === next && user === who && !battle) open(going);
      } catch (err) {
        note.textContent = messageOf(err);
      }
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      if (battle) close(false);
      mapId = null;
      entry.hidden = true;
    },
    open,
    close,
    get debug() {
      if (!battle || !shown) return null;
      const mine = shown[battle.mySide];
      const theirs = shown[otherSide(battle.mySide)];
      return {
        id: battle.id,
        status: battle.status,
        turn: battle.view.turn,
        phase: battle.view.phase.type,
        shown: {
          mine: mine.energy[mine.active] ?? 0,
          theirs: theirs.energy[theirs.active] ?? 0,
        },
        pending: queue.length,
        waiting,
        winner: battle.view.phase.type === 'over' ? battle.view.phase.result.winner : null,
        scene: scene3d?.stats ?? null,
        keeperReactions,
      };
    },
  };
}
