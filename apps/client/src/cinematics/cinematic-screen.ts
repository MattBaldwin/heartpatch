import type { CinematicMusic, CinematicState, KeeperConfig, PublicUser } from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import { isCueName, type CueName } from '../audio/cues.js';
import type { TrackId } from '../audio/music-score.js';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { lodFor } from '../procedural/motion.js';
import { keeperItems } from '../procedural/keeper/keeper-items.js';
import { updateHold } from '../pwa/update-hold.js';
import { el } from '../ui/dom.js';
import { cinematicApi, type CinematicApi } from './cinematic-api.js';
import type { CinematicScene, CinematicSceneStats } from './cinematic-scene.js';
import { Playback, type PlaybackEnd } from './playback.js';
import { checkSeen } from './seen-check.js';
import { canSkip, prefersReducedMotion, shouldAutoPlay } from './skip.js';
import { captionAt, musicAt, shotAt, titleAt, veilAt, type Timeline } from './timeline.js';
import './cinematic.css';

// The opening cinematic, "The Great Scatter" (#46, design doc §25): it plays
// once by itself right after the Keeper pick and before the tutorial, and
// again any time from Settings. The story draws on the shared stage (one
// engine, scenes swapped); this screen is the DOM over it: big rounded
// captions, the title card, a cream veil for dissolves, Skip (once seen),
// and "Hold to skip" (always), so a kid is never stuck. The script and the
// scene code load only when it plays.

export const CINEMATIC_TEXT = {
  skip: 'Skip',
  hold: 'Hold to skip',
  title: 'Heartpatch',
  /** Under the title card. */
  tagline: 'Bring the color back!',
  /** The lobby's Settings screen. */
  settings: 'See how it all began.',
  settingsButton: 'Watch the story',
  /** Screen readers: what the canvas shows. */
  label: 'The story of Heartpatch',
} as const;

export interface CinematicAudio {
  cue: (name: CueName | null) => void;
  setScore: (track: TrackId | null | undefined) => void;
}

export interface CinematicScreenOptions {
  root: HTMLElement;
  /** Puts a scene on screen: the story, or the default one (null). */
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a frame (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  /** False when no renderer could start: the story is skipped (never a blank screen). */
  canRender: () => boolean;
  audio: CinematicAudio;
  /** The player's Keeper and what they wear, for shot 7. */
  keeper: () => KeeperConfig | null;
  keeperWearing: () => readonly string[];
  /** A replay is taking the screen: put the lobby and map away. */
  onReplayOpen: () => void;
  /** A replay ended: bring the lobby back. */
  onReplayClosed: () => void;
  api?: Pick<CinematicApi, 'get' | 'markSeen'>;
  /** `prefers-reduced-motion`, read as each viewing starts. */
  reducedMotion?: () => boolean;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface CinematicDebug {
  readonly mode: 'first' | 'replay' | null;
  readonly t: number;
  readonly total: number;
  readonly shot: string | null;
  readonly caption: string | null;
  readonly skippable: boolean;
  readonly reducedMotion: boolean;
  readonly seen: CinematicState | null;
  /** How the last viewing ended. */
  readonly ended: PlaybackEnd | null;
  readonly scene: CinematicSceneStats | null;
}

export interface CinematicScreen {
  setUser: (user: PublicUser | null) => void;
  /**
   * After the Keeper pick: plays the story if this account has never seen
   * it, and resolves when it's over (or right away if it isn't needed).
   */
  ensure: (user: PublicUser) => Promise<void>;
  /** Plays it again (Settings). */
  replay: () => void;
  settings: () => Node[];
  readonly isOpen: boolean;
  readonly debug: CinematicDebug | null;
}

/** What the lazily loaded scene module gives. */
interface SceneModule {
  readonly CinematicScene: typeof CinematicScene;
  readonly openingTimeline: () => Timeline;
}

const scoreOf = (music: CinematicMusic): TrackId | null => (music === 'none' ? null : music);

export function createCinematicScreen(options: CinematicScreenOptions): CinematicScreen {
  const api = options.api ?? cinematicApi;
  const reducedMotionNow = options.reducedMotion ?? (() => prefersReducedMotion());

  let user: PublicUser | null = null;
  /** Bumped on every login change, so a slow fetch can't land on another player. */
  let session = 0;
  let seen: CinematicState | null = null;
  /** The viewed flag, fetched as soon as a player logs in (see `setUser`). */
  let early: Promise<CinematicState | null> | null = null;
  let mode: 'first' | 'replay' | null = null;
  let playback: Playback | null = null;
  let scene: CinematicScene | null = null;
  let reduced = false;
  let ended: PlaybackEnd | null = null;
  let frame = 0;
  let lastFrame = 0;
  let lastTier: QualityTier | null = null;
  let lastCaption: string | null = null;
  let finished: (() => void) | null = null;
  let release: (() => void) | null = null;
  let module: Promise<SceneModule> | null = null;

  // ── DOM ───────────────────────────────────────────────────────────────
  const veil = el('div', { class: 'cinematic-veil' });
  const caption = el('p', {
    class: 'cinematic-caption',
    'aria-live': 'polite',
    'data-testid': 'cinematic-caption',
  });
  const title = el(
    'div',
    { class: 'cinematic-title', 'data-testid': 'cinematic-title' },
    el('h1', { class: 'cinematic-title-name' }, CINEMATIC_TEXT.title),
    el('p', { class: 'cinematic-title-tagline' }, CINEMATIC_TEXT.tagline),
  );
  const ring = el('span', { class: 'cinematic-hold-ring', 'aria-hidden': 'true' });
  const hold = el(
    'div',
    { class: 'cinematic-hold', 'data-testid': 'cinematic-hold' },
    ring,
    el('span', {}, CINEMATIC_TEXT.hold),
  );
  const skip = el(
    'button',
    { type: 'button', class: 'cinematic-skip', 'data-testid': 'cinematic-skip' },
    CINEMATIC_TEXT.skip,
  );
  const panel = el(
    'section',
    {
      class: 'cinematic',
      'data-testid': 'cinematic',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': CINEMATIC_TEXT.label,
    },
    veil,
    title,
    caption,
    hold,
    skip,
  );
  panel.hidden = true;
  options.root.append(panel);

  // A press anywhere: a short one is a tap (next caption), a long one skips.
  // Timed by the events' own stamps (same clock as performance.now()), so a
  // slow frame between the two handlers can't turn a quick tap into a hold.
  panel.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('.cinematic-skip')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    playback?.pressStart(e.timeStamp);
  });
  panel.addEventListener('pointerup', (e) => {
    playback?.pressEnd(e.timeStamp);
  });
  for (const type of ['pointercancel', 'pointerleave'] as const) {
    panel.addEventListener(type, () => {
      playback?.pressCancel();
    });
  }
  panel.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      playback?.tap();
    } else if (e.key === 'Escape') {
      playback?.skipNow();
    }
  });
  skip.addEventListener('click', () => {
    playback?.skip();
  });

  // ── Playing ───────────────────────────────────────────────────────────
  const loadScene = (): Promise<SceneModule> => {
    module ??= import('./cinematic-scene.js');
    // A failed download can be tried again next time.
    return module.catch((err: unknown) => {
      module = null;
      throw err;
    });
  };

  const tick = (now: number): void => {
    frame = 0;
    const p = playback;
    if (!p || mode === null) return;
    const dt = lastFrame === 0 ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;
    for (const c of p.step(dt)) if (isCueName(c.cue)) options.audio.cue(c.cue);
    const fill = p.holdTick(now);
    ring.style.setProperty('--fill', String(fill));
    hold.classList.toggle('cinematic-holding', fill > 0);
    if (p.ended) {
      finish(p.ended);
      return;
    }
    const { timeline } = p;
    options.audio.setScore(scoreOf(musicAt(timeline, p.t)));
    const tier = options.tier();
    if (scene) {
      if (tier !== lastTier) {
        lastTier = tier;
        scene.setLod(lodFor('closeUp', tier));
      }
      scene.apply(p.t, now);
      scene.update(now);
    }
    const line = captionAt(timeline, p.t)?.text ?? null;
    if (line !== lastCaption) {
      lastCaption = line;
      caption.textContent = line ?? '';
      caption.classList.toggle('cinematic-caption-on', line !== null);
    }
    veil.style.opacity = veilAt(timeline, p.t).toFixed(3);
    const titleShown = titleAt(timeline, p.t);
    title.style.opacity = titleShown.toFixed(3);
    title.classList.toggle('cinematic-title-on', titleShown > 0);
    // The story moves every frame: keep drawing (the governor sees real frames).
    options.invalidate();
    frame = requestAnimationFrame(tick);
  };

  function start(timeline: Timeline, sceneModule: SceneModule, next: 'first' | 'replay'): void {
    mode = next;
    reduced = reducedMotionNow();
    ended = null;
    // A replay was asked for, so it's been seen even if the server couldn't say.
    playback = new Playback(timeline, { skippable: next === 'replay' || canSkip(seen) });
    lastFrame = 0;
    lastCaption = null;
    lastTier = null;
    caption.textContent = '';
    caption.classList.remove('cinematic-caption-on');
    title.style.opacity = '0';
    veil.style.opacity = '1';
    skip.hidden = !playback.skippable;
    panel.classList.toggle('cinematic-reduced', reduced);
    panel.hidden = false;
    panel.tabIndex = -1;
    panel.focus({ preventScroll: true });
    release = updateHold.hold();
    const keeper = options.keeper();
    const items = keeperItems(options.keeperWearing());
    const build: SceneBuilder = (s: Scene): SceneContent => {
      const built = new sceneModule.CinematicScene(s, {
        timeline,
        keeper,
        keeperItems: items,
        reducedMotion: reduced,
        lod: lodFor('closeUp', options.tier()),
      });
      scene = built;
      s.onDisposeObservable.addOnce(() => {
        if (scene === built) scene = null;
        built.dispose();
      });
      built.apply(0, performance.now());
      return built.content;
    };
    options.showScene(build);
    if (frame === 0) frame = requestAnimationFrame(tick);
  }

  function finish(how: PlaybackEnd): void {
    const was = mode;
    mode = null;
    ended = how;
    playback = null;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    panel.hidden = true;
    release?.();
    release = null;
    options.audio.setScore(undefined);
    if (was !== null) options.showScene(null);
    // Watched or skipped, it's been seen: remembered on the account.
    const mine = session;
    if (user && seen?.seenAt == null) {
      api.markSeen().then(
        (state) => {
          if (mine === session) seen = state;
        },
        () => {
          // Offline: it plays once more next time, and can be skipped by a long press.
        },
      );
    }
    if (was === 'replay') options.onReplayClosed();
    const done = finished;
    finished = null;
    done?.();
  }

  /** Stops without marking anything (logged out mid-story). */
  function stop(): void {
    if (mode === null) return;
    mode = null;
    playback = null;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    panel.hidden = true;
    release?.();
    release = null;
    options.audio.setScore(undefined);
    options.showScene(null);
    const done = finished;
    finished = null;
    done?.();
  }

  async function play(next: 'first' | 'replay'): Promise<void> {
    const mine = session;
    const sceneModule = await loadScene();
    if (mine !== session || mode !== null) return;
    start(sceneModule.openingTimeline(), sceneModule, next);
    await new Promise<void>((resolve) => {
      finished = resolve;
    });
  }

  const screen: CinematicScreen = {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      session += 1;
      user = next;
      seen = null;
      stop();
      // Asked now, alongside the Keeper's own fetch, so a returning player
      // never waits for two round trips in a row before the lobby.
      early = next ? api.get().catch(() => null) : null;
    },

    ensure: async (who) => {
      if (who.id !== user?.id) return;
      const mine = session;
      // Kept only while the same player is logged in, so a logout mid-fetch
      // never leaves the old account's answer behind.
      const result = await checkSeen(api, early, () => mine === session);
      if (result.stale) return;
      seen = result.seen;
      if (mode !== null) return;
      // The game never waits on the story (decision A): no renderer, or no
      // answer from the server, and it goes straight on.
      if (!shouldAutoPlay(seen) || !options.canRender()) return;
      try {
        await play('first');
      } catch {
        // The story couldn't load (offline): on to the game.
      }
    },

    replay: () => {
      if (!user || mode !== null || !options.canRender()) return;
      options.onReplayOpen();
      play('replay').catch(() => {
        options.onReplayClosed();
      });
    },

    settings: () => {
      if (!user) return [];
      const watch = el(
        'button',
        {
          type: 'button',
          class: 'auth-button auth-button-soft',
          'data-testid': 'cinematic-settings',
        },
        CINEMATIC_TEXT.settingsButton,
      );
      watch.addEventListener('click', () => {
        screen.replay();
      });
      return [el('p', { class: 'auth-subtitle' }, CINEMATIC_TEXT.settings), watch];
    },

    get isOpen() {
      return mode !== null;
    },

    get debug() {
      if (!user) return null;
      const p = playback;
      return {
        mode,
        t: p?.t ?? 0,
        total: p?.timeline.total ?? 0,
        shot: p ? shotAt(p.timeline, p.t).shot.id : null,
        caption: p ? (captionAt(p.timeline, p.t)?.text ?? null) : null,
        skippable: p?.skippable ?? false,
        reducedMotion: reduced,
        seen,
        ended,
        scene: scene?.stats ?? null,
      };
    },
  };
  return screen;
}
