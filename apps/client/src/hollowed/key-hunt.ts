import type { CommunityView, Hex, MapView, PublicTile } from '@heartpatch/shared';
import type { MapLayer, TileActions } from '../map/map-screen.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { cellarApi, type CellarApi } from './cellar-api.js';
import { KEY_HUNT } from './hollowed-config.js';
import { KEY_TEXT, keyHuntOn, newMaps, type KeyHuntBlock } from './key-hunt-view.js';
import './hollowed.css';

// The key hunt and the hidden cellar on the map (#306 PR 2c, owner decision
// 5): winning a village pops a map card ("A map to the key! 🗺️") once, a
// flag marks the key's tile (community-flags.ts), its panel digs the key up
// once my land reaches it, and the square's panel opens the cellar door and
// takes me down into it (the explore view, explore-screen.ts). The server
// decides everything (rule 1); this only shows what the map view says.

export interface KeyHuntOptions {
  root: HTMLElement;
  me: () => string | null;
  mapId: () => string | null;
  api?: Pick<CellarApi, 'dig' | 'open'>;
  /** Glides the camera to the key's tile and taps it (the card's "Show me on the map"). */
  showKey: (at: Hex) => void;
  /** Down into the open cellar. */
  enterCellar: (communityId: string) => void;
  /** Another card is up (the joy or naming card, the care sheet): the map card waits its turn. */
  busy: () => boolean;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface KeyHuntDebug {
  /** The map card's village, or null. */
  readonly card: string | null;
  /** The panel's block on the tile shown, or null. */
  readonly block: { kind: KeyHuntBlock['kind']; state: string; canDig: boolean } | null;
  readonly said: string | null;
}

export interface KeyHunt {
  readonly tileActions: TileActions;
  /** Watches the map view for a newly won village's map. */
  readonly layer: MapLayer;
  /** Another card closed: a map card that waited shows after a beat, once nothing else is up. */
  showWaiting: () => void;
  close: () => void;
  readonly debug: KeyHuntDebug;
}

export function createKeyHunt(options: KeyHuntOptions): KeyHunt {
  const api = options.api ?? cellarApi;
  const card = el('section', {
    class: 'hollowed-sheet',
    role: 'dialog',
    'aria-labelledby': 'key-map-title',
    'data-testid': 'key-map-card',
  });
  card.hidden = true;
  options.root.append(card);

  /** Villages whose map card waits its turn (another card up, then a beat). */
  const waiting: CommunityView[] = [];
  let carded: CommunityView | null = null;
  let seen: { mapId: string; communities: readonly CommunityView[] } | null = null;
  let shown: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  let working = false;
  /** What the last dig or open said, on that tile until the panel shows another. */
  let said: { at: string; ok: boolean; text: string } | null = null;
  let block: KeyHunt['debug']['block'] = null;
  /** The next look for a turn to show a waiting card, while one is pending. */
  let turn: ReturnType<typeof setTimeout> | null = null;
  /** Arms the card's buttons `KEY_HUNT.tapGuardMs` after it shows. */
  let arming: ReturnType<typeof setTimeout> | null = null;

  const where = (t: Hex) => `${String(t.q)},${String(t.r)}`;

  const closeCard = (): void => {
    if (turn !== null) clearTimeout(turn);
    if (arming !== null) clearTimeout(arming);
    turn = null;
    arming = null;
    carded = null;
    card.hidden = true;
    card.replaceChildren();
  };

  const showCard = (c: CommunityView): void => {
    carded = c;
    const key = c.cellar?.state === 'hunt' ? c.cellar.keyTile : undefined;
    const button = (label: string, testId: string, soft: boolean, onTap: () => void) => {
      const b = el(
        'button',
        {
          type: 'button',
          class: soft
            ? 'auth-button auth-button-soft hollowed-soft'
            : 'auth-button hollowed-primary',
          'data-testid': testId,
        },
        label,
      );
      b.addEventListener('click', () => {
        // A tap that was meant for the card before this one isn't for us.
        if (card.dataset['armed'] !== 'true') return;
        onTap();
      });
      return b;
    };
    card.replaceChildren(
      el('p', { class: 'hollowed-kicker' }, KEY_TEXT.mapKicker(c.name)),
      el('h3', { class: 'hollowed-title', id: 'key-map-title' }, KEY_TEXT.mapTitle),
      el('p', { class: 'hollowed-line' }, KEY_TEXT.mapLine),
      el(
        'div',
        { class: 'hollowed-actions' },
        ...(key
          ? [
              button(KEY_TEXT.showMe, 'key-map-show', false, () => {
                closeCard();
                options.showKey(key);
                showWaiting();
              }),
            ]
          : []),
        button(KEY_TEXT.later, 'key-map-later', true, () => {
          closeCard();
          // A second Hollow's map, if one is waiting, takes its turn next.
          showWaiting();
        }),
      ),
    );
    card.dataset['armed'] = 'false';
    card.hidden = false;
    arming = setTimeout(() => {
      arming = null;
      card.dataset['armed'] = 'true';
    }, KEY_HUNT.tapGuardMs);
  };

  /**
   * Waits its turn: a beat after the last look, and only once nothing else
   * is up (it looks again until then). One look pending at a time.
   */
  const showWaiting = (): void => {
    if (carded || turn !== null || waiting.length === 0) return;
    turn = setTimeout(() => {
      turn = null;
      if (carded || waiting.length === 0) return;
      if (options.busy()) {
        showWaiting();
        return;
      }
      const next = waiting.shift();
      if (next) showCard(next);
    }, KEY_HUNT.afterCardMs);
  };

  const watch = (view: MapView): void => {
    const communities = view.communities ?? [];
    const before = seen?.mapId === view.map.id ? seen.communities : null;
    if (seen?.mapId !== view.map.id) {
      waiting.length = 0;
      closeCard();
    }
    seen = { mapId: view.map.id, communities };
    waiting.push(...newMaps(before, communities, options.me()));
    showWaiting();
  };

  /** Digs or opens; the view comes back with the map's next resync. */
  const act = async (which: 'dig' | 'open', c: CommunityView, at: Hex): Promise<void> => {
    const mapId = options.mapId();
    if (!mapId || working) return;
    working = true;
    render();
    try {
      // A lost reply is retried with the same key, so a dig that went in replays.
      const done = await sendCommand(
        {
          newKey: newIdempotencyKey,
          wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          retryAfterMs: COMMAND_RETRY_MS,
        },
        (key) => api[which](mapId, c.id, key),
        () => options.mapId() === mapId,
      );
      if (done === null) return;
      said = which === 'dig' ? { at: where(at), ok: true, text: KEY_TEXT.found(c.name) } : null;
      if (which === 'open') options.enterCellar(c.id);
    } catch (err) {
      said = { at: where(at), ok: false, text: messageOf(err) };
    } finally {
      working = false;
      render();
    }
  };

  const render = (): void => {
    block = null;
    if (!shown) return;
    const { container, tile, view } = shown;
    const lastSaid = said?.at === where(tile) ? said : null;
    const note = lastSaid
      ? [
          el(
            'p',
            {
              class: `tile-action-note ${lastSaid.ok ? 'community-said' : 'community-oops'}`,
              'data-testid': 'key-said',
            },
            lastSaid.text,
          ),
        ]
      : [];
    const on = keyHuntOn(view, tile, options.me());
    if (!on) {
      container.replaceChildren(...note);
      return;
    }
    const line = (text: string) => el('p', { class: 'tile-action-note community-line' }, text);
    const button = (label: string, testId: string, disabled: boolean, onTap: () => void) => {
      const b = el(
        'button',
        { type: 'button', class: 'auth-button bag-action', 'data-testid': testId },
        label,
      );
      b.disabled = disabled || working;
      b.addEventListener('click', onTap);
      return b;
    };
    const c = on.community;
    if (on.kind === 'key') {
      // Dug up: the view says so once its resync lands; until then, just the news.
      if (lastSaid?.ok) {
        container.replaceChildren(...note);
        return;
      }
      block = { kind: 'key', state: 'hunt', canDig: on.inReach };
      container.replaceChildren(
        el(
          'div',
          { class: 'community-block', 'data-testid': 'key-block' },
          line(KEY_TEXT.here(c.name)),
          ...(on.inReach ? [] : [line(KEY_TEXT.away)]),
        ),
        button(working ? KEY_TEXT.digging : KEY_TEXT.dig, 'key-dig', !on.inReach, () => {
          void act('dig', c, tile);
        }),
        ...note,
      );
      return;
    }
    block = { kind: 'square', state: on.state, canDig: false };
    const words =
      on.state === 'hunt'
        ? KEY_TEXT.hunt
        : on.state === 'key'
          ? KEY_TEXT.hasKey
          : KEY_TEXT.cellarLine;
    const actions =
      on.state === 'hunt'
        ? [
            button(KEY_TEXT.showMe, 'key-show', false, () => {
              const key = c.cellar?.keyTile;
              if (key) options.showKey(key);
            }),
          ]
        : on.state === 'key'
          ? [
              button(working ? KEY_TEXT.opening : KEY_TEXT.open, 'cellar-open', false, () => {
                void act('open', c, tile);
              }),
            ]
          : [
              button(KEY_TEXT.goDown, 'cellar-enter', false, () => {
                options.enterCellar(c.id);
              }),
            ];
    container.replaceChildren(
      el('div', { class: 'community-block', 'data-testid': 'cellar-block' }, line(words)),
      ...actions,
      ...note,
    );
  };

  return {
    tileActions: {
      show: (container, tile, view) => {
        if (shown && where(shown.tile) !== where(tile)) said = null;
        shown = { container, tile, view };
        render();
      },
      hide: () => {
        shown?.container.replaceChildren();
        shown = null;
        said = null;
        block = null;
      },
    },
    layer: {
      attach: (_scene, view) => {
        watch(view);
      },
      update: watch,
    },
    showWaiting,
    close: () => {
      waiting.length = 0;
      closeCard();
    },
    get debug() {
      return { card: carded?.id ?? null, block, said: said?.text ?? null };
    },
  };
}
