import type { FarHollowView, PlayerBattle } from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { terrainName } from '../explore/explore-view.js';
import { el, messageOf } from '../ui/dom.js';
import { farHollowApi, type FarHollowApi } from './far-hollow-api.js';
import {
  FAR_HOLLOW_TERRAIN_EMOJI,
  FAR_HOLLOW_TEXT as T,
  farHollowProgress,
  farHollowSpots,
  farHollowState,
  freshLine,
  type FarHollowState,
} from './far-hollow-model.js';
import './hollowed.css';

// The far Hollow's sheet (#306 PR 6, plan Q7): my own grey Hollow this
// season, opened from a trading post's panel. Away: the far road's trail and
// "Take the far road". There: its tiles as a little hex map, each greyer the
// less of it I've searched; a tap explores it. Done: every tile glowing, and
// when a fresh one comes. The server decides everything (CLAUDE.md rule 1).

export interface FarHollowSheetOptions {
  root: HTMLElement;
  api?: Pick<FarHollowApi, 'view' | 'road'>;
  mapId: () => string | null;
  /** It's night on the map: the far Hollow is shut till morning, like every Hollow. */
  night: () => boolean;
  /** The far road started (or one going came back): the battle screen takes over. */
  openBattle: (battle: PlayerBattle) => void;
  /** A tile tapped: explore it up close. */
  explore: (index: number) => void;
  /** The sheet opened: the map's tile panel steps aside. */
  onOpen?: () => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface FarHollowSheetDebug {
  readonly open: boolean;
  readonly state: FarHollowState | null;
  readonly tiles: number;
  readonly searched: number;
  readonly total: number;
}

export interface FarHollowSheet {
  /** Opens the sheet; `post` is the trading post it was opened from (the far road starts there). */
  open: (post: { q: number; r: number } | null) => Promise<void>;
  /** Reads it again if it's open (a search landed, the season turned). */
  refresh: () => Promise<void>;
  close: () => void;
  /** The far road battle a tap here started: its result card says where to. */
  isRoad: (battleId: string) => boolean;
  readonly isOpen: boolean;
  readonly debug: FarHollowSheetDebug;
}

export function createFarHollowSheet(options: FarHollowSheetOptions): FarHollowSheet {
  const api = options.api ?? farHollowApi;
  const sheet = el('section', {
    class: 'hollowed-sheet far-hollow-sheet',
    role: 'dialog',
    'aria-labelledby': 'far-hollow-title',
    'data-testid': 'far-hollow-sheet',
  });
  sheet.hidden = true;
  options.root.append(sheet);

  let view: FarHollowView | null = null;
  let post: { q: number; r: number } | null = null;
  let generation = 0;
  let working = false;
  let note: string | null = null;
  /** Far road battles started here. */
  const roads = new Set<string>();

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  const close = (): void => {
    generation += 1;
    view = null;
    note = null;
    working = false;
    sheet.hidden = true;
    sheet.replaceChildren();
  };

  const button = (label: string, testId: string, soft: boolean, onTap: () => void) => {
    const b = el(
      'button',
      {
        type: 'button',
        class: soft ? 'auth-button auth-button-soft hollowed-soft' : 'auth-button hollowed-primary',
        'data-testid': testId,
      },
      label,
    );
    b.addEventListener('click', onTap);
    return b;
  };

  async function setOff(): Promise<void> {
    const id = options.mapId();
    const from = post;
    if (!id || !from || working) return;
    const at = generation;
    const stillHere = () => at === generation && options.mapId() === id;
    working = true;
    note = null;
    render();
    try {
      const battle = await sendCommand(sendDeps, (key) => api.road(id, from, key), stillHere);
      if (battle && stillHere()) {
        // A battle already going comes back instead (one at a time).
        if (battle.kind === 'journey') roads.add(battle.id);
        close();
        options.openBattle(battle);
        return;
      }
    } catch (err) {
      if (stillHere()) note = messageOf(err);
    } finally {
      if (stillHere()) {
        working = false;
        render();
      }
    }
  }

  /** The tiles as a little hex map: greyer the less of each I've searched. */
  const tileMap = (v: FarHollowView, tappable: boolean) => {
    const { spots, aspect, tile } = farHollowSpots(v.tiles);
    const map = el('div', {
      class: 'far-hollow-map',
      'data-testid': 'far-hollow-map',
      style: `aspect-ratio: ${String(aspect)}`,
    });
    for (const t of v.tiles) {
      const spot = spots.find((s) => s.index === t.index);
      if (!spot) continue;
      const joy = t.total > 0 ? t.searched / t.total : 0;
      const done = t.total > 0 && t.searched >= t.total;
      const b = el(
        'button',
        {
          type: 'button',
          class: `far-hollow-tile far-hollow-${t.terrain}${done ? ' far-hollow-tile-done' : ''}`,
          'data-testid': 'far-hollow-tile',
          'data-index': String(t.index),
          'aria-label': T.tileLabel(terrainName(t.terrain), t.searched, t.total),
          style: [
            `left: ${String(spot.left)}%`,
            `top: ${String(spot.top)}%`,
            `width: ${String(tile.width)}%`,
            `height: ${String(tile.height)}%`,
            `--joy: ${String(Math.round(joy * 100) / 100)}`,
          ].join('; '),
        },
        el(
          'span',
          { class: 'far-hollow-tile-art', 'aria-hidden': 'true' },
          FAR_HOLLOW_TERRAIN_EMOJI[t.terrain] ?? '🌫️',
        ),
        el(
          'span',
          { class: 'far-hollow-tile-count', 'aria-hidden': 'true' },
          done ? '✨' : `${String(t.searched)}/${String(t.total)}`,
        ),
      );
      b.disabled = !tappable;
      b.addEventListener('click', () => {
        close();
        options.explore(t.index);
      });
      map.append(b);
    }
    return map;
  };

  function render(): void {
    const v = view;
    if (!v) return;
    const state = farHollowState(v);
    const kicker = el('p', { class: 'hollowed-kicker' }, T.kicker(v.season.name));
    const title = el(
      'h3',
      { class: 'hollowed-title', id: 'far-hollow-title' },
      state === 'complete' ? T.doneTitle : T.title(v.name),
    );
    const said = note
      ? [
          el(
            'p',
            { class: 'hollowed-said', role: 'status', 'data-testid': 'far-hollow-note' },
            note,
          ),
        ]
      : [];
    const closeButton = button(T.close, 'far-hollow-close', true, close);
    const progress = farHollowProgress(v.tiles);
    if (state === 'away') {
      const go = button(working ? '…' : T.start, 'far-hollow-road', false, () => {
        void setOff();
      });
      go.disabled = working || options.night();
      sheet.replaceChildren(
        kicker,
        title,
        el('p', { class: 'hollowed-line' }, T.awayLead),
        el(
          'p',
          { class: 'hollowed-seed', 'data-testid': 'far-hollow-trail' },
          `🧭 ${T.road(v.road.teamSize, v.road.level)}`,
        ),
        ...said,
        el(
          'p',
          { class: 'hollowed-note' },
          options.night() ? T.night : post ? T.roadStakes : T.fromPost,
        ),
        el('div', { class: 'hollowed-actions' }, ...(post ? [go] : []), closeButton),
      );
    } else {
      const night = options.night();
      sheet.replaceChildren(
        kicker,
        title,
        el('p', { class: 'hollowed-line' }, state === 'complete' ? T.doneLead : T.arrivedLead),
        tileMap(v, state === 'arrived' && !night),
        el(
          'p',
          { class: 'hollowed-line far-hollow-progress', 'data-testid': 'far-hollow-progress' },
          T.progress(progress.searched, progress.total),
        ),
        ...said,
        el(
          'p',
          { class: 'hollowed-note', 'data-testid': 'far-hollow-next' },
          state === 'complete' ? freshLine(v.nextSeason) : night ? T.night : T.tapTile,
        ),
        el('div', { class: 'hollowed-actions' }, closeButton),
      );
    }
    sheet.hidden = false;
  }

  async function load(): Promise<void> {
    const id = options.mapId();
    if (!id) return;
    const at = generation;
    try {
      const fresh = await api.view(id);
      if (at !== generation) return;
      view = fresh;
      render();
    } catch (err) {
      if (at !== generation) return;
      note = messageOf(err);
      if (view) render();
    }
  }

  return {
    open: async (from) => {
      close();
      post = from;
      options.onOpen?.();
      await load();
    },
    refresh: async () => {
      if (!sheet.hidden) await load();
    },
    close,
    isRoad: (battleId) => roads.has(battleId),
    get isOpen() {
      return !sheet.hidden;
    },
    get debug() {
      const progress = view ? farHollowProgress(view.tiles) : { searched: 0, total: 0 };
      return {
        open: !sheet.hidden,
        state: view ? farHollowState(view) : null,
        tiles: view?.tiles.length ?? 0,
        ...progress,
      };
    },
  };
}
