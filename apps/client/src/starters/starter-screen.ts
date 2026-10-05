import type { PublicUser } from '@heartpatch/shared';
import type { Scene } from '@babylonjs/core/scene';
import type { QualityTier } from '../engine/config.js';
import type { SceneBuilder, SceneContent } from '../engine/stage.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { lodFor } from '../procedural/motion.js';
import { el, messageOf } from '../ui/dom.js';
import { starterApi, type StarterApi } from './starter-api.js';
import { StarterPreview } from './starter-preview.js';
import {
  chooseLabel,
  giftLine,
  giftTitle,
  preselectedCard,
  STARTER_TEXT,
  starterCards,
  starterSpecies,
  type StarterCard,
} from './starter-view.js';
import './starter.css';

// "Choose your friend!" (owner decision 2026-10-03): the first time a player
// opens a patch they joined or made, they pick 1 of 3 starters before the
// map. A bottom card for one thumb with three choices, the squishies in 3D
// above it in the same order. Tap to choose, then confirm; the server checks
// the pick and grants the squishy. The account's very first pick also brings
// Sprout's Heart Charms (owner decision 2026-10-04): a small "Ta-da" card says
// so before the map, so a new player knows how to make more friends.

export interface StarterScreenOptions {
  root: HTMLElement;
  /** Puts a scene on screen: the preview, or the default one (null). */
  showScene: (build: SceneBuilder | null) => void;
  /** Draws a few frames after a change (`Stage.invalidate`). */
  invalidate: () => void;
  tier: () => QualityTier;
  /** The screen is taking the stage: put the lobby and map away. */
  onOpen: () => void;
  api?: Pick<StarterApi, 'needsStarter' | 'pickInfo' | 'pick'>;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface StarterDebug {
  readonly mapId: string | null;
  readonly picked: string | null;
  /** The starters standing in the 3D preview, while it's on screen. */
  readonly shown: readonly string[];
  readonly hopping: boolean;
  /** The gift card's line, while it shows. */
  readonly gift: string | null;
}

export interface StarterScreen {
  setUser: (user: PublicUser | null) => void;
  /**
   * Resolves once the player has a starter on this patch: right away if they
   * picked one before, or after they choose. Rejects with a player-safe
   * message if the patch can't be checked, or if they log out meanwhile.
   */
  ensure: (mapId: string) => Promise<void>;
  readonly isOpen: boolean;
  readonly debug: StarterDebug | null;
}

const cards = starterCards();

export function createStarterScreen(options: StarterScreenOptions): StarterScreen {
  const api = options.api ?? starterApi;

  let user: PublicUser | null = null;
  /** Bumped on every login change, so a slow reply can't land on another player. */
  let session = 0;
  /** The patch being picked for, while open. */
  let mapId: string | null = null;
  let picked: StarterCard | null = null;
  /** Settles the open `ensure`. */
  let pending: { resolve: () => void; reject: (err: Error) => void } | null = null;
  /** One key per pick, so a retry after a lost reply can't grant twice. */
  let key = newIdempotencyKey();
  let preview: StarterPreview | null = null;
  let frame = 0;
  let lastTier: QualityTier | null = null;

  const title = el('h1', { class: 'auth-title', id: 'starter-title' }, STARTER_TEXT.title);
  const subtitle = el('p', { class: 'auth-subtitle starter-subtitle' }, STARTER_TEXT.subtitle);
  const choices = el('div', { class: 'starter-choices', role: 'group', 'aria-label': 'Starters' });
  const about = el('p', { class: 'starter-about', 'aria-live': 'polite' }, STARTER_TEXT.hint);
  const error = el('p', { class: 'auth-error', role: 'alert', 'data-testid': 'starter-error' });
  const choose = el('button', { type: 'button', class: 'auth-button' }, STARTER_TEXT.choose);
  const card = el(
    'div',
    { class: 'auth-card starter-card' },
    title,
    subtitle,
    choices,
    about,
    error,
    el('div', { class: 'auth-actions' }, choose),
  );
  const panel = el(
    'section',
    {
      class: 'starter-picker',
      'data-testid': 'starter-picker',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'starter-title',
    },
    card,
  );
  // Sprout's gift with the first pick: same card shape, one big button.
  const giftHeading = el('h1', { class: 'auth-title', id: 'starter-gift-title' });
  const giftText = el('p', {
    class: 'auth-subtitle starter-subtitle',
    'data-testid': 'starter-gift',
  });
  const giftDone = el('button', { type: 'button', class: 'auth-button' }, STARTER_TEXT.giftDone);
  const giftCard = el(
    'div',
    { class: 'auth-card starter-card', role: 'status' },
    giftHeading,
    giftText,
    el('p', { class: 'starter-about' }, STARTER_TEXT.giftHint),
    el('div', { class: 'auth-actions' }, giftDone),
  );
  giftCard.hidden = true;
  panel.append(giftCard);
  /** Settles once the gift card is tapped away. */
  let giftShown: (() => void) | null = null;
  giftDone.addEventListener('click', () => {
    const done = giftShown;
    giftShown = null;
    done?.();
  });
  panel.hidden = true;
  options.root.append(panel);

  // ── Preview ───────────────────────────────────────────────────────────
  const build = (scene: Scene): SceneContent => {
    const built = new StarterPreview(scene, starterSpecies(), lodFor('closeUp', options.tier()));
    lastTier = options.tier();
    preview = built;
    scene.onDisposeObservable.addOnce(() => {
      if (preview === built) preview = null;
      built.dispose();
    });
    return built.content;
  };

  /** Draws while a squishy hops, and follows the quality tier's detail level. */
  const tick = (): void => {
    frame = 0;
    if (mapId === null) return;
    const p = preview;
    if (p) {
      const tier = options.tier();
      if (tier !== lastTier) {
        lastTier = tier;
        p.setLod(lodFor('closeUp', tier));
        options.invalidate();
      }
      if (p.update(performance.now())) options.invalidate();
    }
    frame = requestAnimationFrame(tick);
  };

  // ── Card ──────────────────────────────────────────────────────────────
  const buttons = cards.map((c) => {
    const swatch = el('span', { class: 'starter-swatch', 'aria-hidden': 'true' });
    swatch.style.background = c.color;
    const node = el(
      'button',
      { type: 'button', class: 'starter-choice', 'aria-label': c.label, 'aria-pressed': 'false' },
      swatch,
      el('span', { class: 'starter-name' }, c.name),
      el('span', { class: 'starter-tag' }, c.element),
      el('span', { class: 'starter-tag starter-tag-feeling' }, c.feeling),
    );
    node.addEventListener('click', () => {
      select(c);
    });
    choices.append(node);
    return { card: c, node };
  });

  /** Marks the pick (no rebuild, so a tap never loses its place). */
  const refresh = () => {
    for (const b of buttons) b.node.setAttribute('aria-pressed', String(b.card === picked));
    about.textContent = picked ? picked.description : STARTER_TEXT.hint;
    choose.textContent = chooseLabel(picked);
    choose.disabled = picked === null;
  };

  function select(next: StarterCard): void {
    picked = next;
    error.textContent = '';
    refresh();
    preview?.hop(next.speciesId, performance.now());
    options.invalidate();
  }

  /** Swaps the picker card for the gift card (or back, with null). */
  function showGift(line: string | null, choice: StarterCard | null): void {
    card.hidden = line !== null;
    giftCard.hidden = line === null;
    panel.setAttribute('aria-labelledby', line === null ? 'starter-title' : 'starter-gift-title');
    if (line === null || !choice) return;
    giftHeading.textContent = giftTitle(choice);
    giftText.textContent = line;
    giftDone.focus();
  }

  function open(next: string, preselect: string | null): void {
    mapId = next;
    // A gift card from an earlier pick, still waiting, lets that pick finish.
    const waiting = giftShown;
    giftShown = null;
    waiting?.();
    showGift(null, null);
    // A tutorial graduate starts on their Partner's species (#24).
    picked = preselectedCard(
      buttons.map((b) => b.card),
      preselect,
    );
    key = newIdempotencyKey();
    error.textContent = '';
    refresh();
    options.onOpen();
    panel.hidden = false;
    options.showScene(build);
    if (frame === 0) frame = requestAnimationFrame(tick);
  }

  function close(): void {
    const was = mapId;
    mapId = null;
    // A gift card still up (a logout meanwhile) lets its pick finish quietly.
    const waiting = giftShown;
    giftShown = null;
    waiting?.();
    panel.hidden = true;
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    if (was !== null) options.showScene(null);
  }

  /** Ends the open `ensure`, if any. */
  function settle(err: Error | null): void {
    const p = pending;
    pending = null;
    if (!p) return;
    if (err) p.reject(err);
    else p.resolve();
  }

  choose.addEventListener('click', () => void submit());

  async function submit(): Promise<void> {
    const forMap = mapId;
    const choice = picked;
    const mine = session;
    if (!forMap || !choice || choose.disabled) return;
    choose.disabled = true;
    choose.textContent = STARTER_TEXT.choosing;
    error.textContent = '';
    let line: string | null = null;
    try {
      line = giftLine((await api.pick(forMap, choice.speciesId, key)).gift);
    } catch (err) {
      if (mine !== session || mapId !== forMap) return;
      // A CONFLICT may mean they already picked (another tab or device), or
      // just "still working": ask the patch, which knows.
      const done =
        err instanceof ApiRequestError &&
        err.code === 'CONFLICT' &&
        !(await api.needsStarter(forMap).catch(() => true));
      if (mine !== session || mapId !== forMap) return;
      // Not in the patch any more (removed, or it's gone): nothing to pick
      // here, so hand the message back to the lobby rather than wait.
      if (err instanceof ApiRequestError && err.code === 'NOT_FOUND') {
        close();
        settle(new Error(messageOf(err), { cause: err }));
        return;
      }
      if (!done) {
        // The server answered, so this key has its reply: the next try needs
        // a new one. A reply lost offline keeps it, so a retry can't grant twice.
        if (!(err instanceof ApiRequestError && err.code === 'OFFLINE')) key = newIdempotencyKey();
        error.textContent = messageOf(err);
        refresh();
        return;
      }
    }
    if (mine !== session || mapId !== forMap) return;
    if (line !== null) {
      // Their very first pick: tell them about Sprout's Heart Charms first.
      showGift(line, choice);
      await new Promise<void>((resolve) => {
        giftShown = resolve;
      });
      if (mine !== session || mapId !== forMap) return;
    }
    close();
    settle(null);
  }

  return {
    setUser: (next) => {
      if (next?.id === user?.id) return;
      session += 1;
      user = next;
      close();
      settle(new Error(STARTER_TEXT.loadFailed));
    },

    ensure: async (next) => {
      const mine = session;
      let info: { needsStarter: boolean; preselectSpeciesId: string | null };
      try {
        info = await api.pickInfo(next);
      } catch (err) {
        throw new Error(messageOf(err), { cause: err });
      }
      if (mine !== session) throw new Error(STARTER_TEXT.loadFailed);
      if (!info.needsStarter) return;
      // Asked again while open (a double tap): the newest call waits instead.
      settle(new Error(STARTER_TEXT.loadFailed));
      const done = new Promise<void>((resolve, reject) => {
        pending = { resolve, reject };
      });
      open(next, info.preselectSpeciesId);
      return done;
    },

    get isOpen() {
      return mapId !== null;
    },

    get debug() {
      if (!user) return null;
      const now = performance.now();
      return {
        mapId,
        picked: picked?.speciesId ?? null,
        shown: preview?.shown ?? [],
        hopping: picked !== null && (preview?.isPlaying(picked.speciesId, now) ?? false),
        gift: giftCard.hidden ? null : giftText.textContent,
      };
    },
  };
}
