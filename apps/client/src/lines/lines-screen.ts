import {
  hexKey,
  type Hex,
  type HexKey,
  type LineKind,
  type MapView,
  type PublicLine,
  type PublicTile,
  type RailSpot,
  type Supply,
} from '@heartpatch/shared';
import type { BuildCard } from '../building/build-model.js';
import type { BuildSource } from '../building/tile-build.js';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { MapLayer, TileActions } from '../map/map-screen.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { buttonClass } from '../ui/button/button.js';
import { el, messageOf } from '../ui/dom.js';
import { lineApi, type LineApi } from './line-api.js';
import { createLineFeed, isClockworkView } from './line-feed.js';
import { LineField, type LineFieldStats } from './line-field.js';
import {
  LINE_TEXT,
  lineCardOf,
  lineCards,
  lineCommandFor,
  lineRefund,
  refundText,
} from './line-model.js';

// Wires and rails on a Clockwork Isle (#874 C4), as one feature main.ts
// mounts: the lines' map layer (drawn from `GET /maps/:id/lines`), the
// Build sheet's Wire and Rail cards, and the tile panel's Take up. The
// server checks every cost, reach and rule and says which wires carry power
// (CLAUDE.md rule 1); this shows and sends.

export interface LinesOptions {
  /** Who is signed in. */
  me: () => string | null;
  /** Ask for another frame (the scene changed outside a render). */
  invalidate: () => void;
  /** My supply line (roads and rails in), or undefined before it loads: cut-off cards. */
  supply: (view: MapView) => Supply | undefined;
  api?: LineApi;
  /** The lines were read again (rails move the supply line). */
  onLinesChange?: () => void;
}

export interface LinesDebug {
  readonly lines: number;
  readonly loaded: boolean;
  /** What the map draws, or null before the map is up. */
  readonly drawn: LineFieldStats | null;
}

export interface Lines {
  /** The map layer: pass it to `createMapScreen({ layers })`. */
  readonly layer: MapLayer;
  /** Wire and Rail cards for a tile of mine, for the land Build sheet. */
  readonly buildSource: BuildSource;
  /** Take up a wire or a rail, in the land tile's panel. */
  readonly tileActions: TileActions;
  /** Every rail, for the supply line (`withRails`). */
  readonly rails: () => readonly RailSpot[];
  /** Bumps whenever the lines change (for memoising). */
  readonly version: () => number;
  readonly lines: () => readonly PublicLine[];
  readonly debug: LinesDebug;
}

type Mode = { confirm: LineKind } | 'card';

export function createLines(options: LinesOptions): Lines {
  const api = options.api ?? lineApi;
  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  let view: MapView | null = null;
  let field: LineField | null = null;
  const listeners: (() => void)[] = [];
  /** Bumped when the map changes, so a late answer to an old map is dropped. */
  let generation = 0;
  let mapId: string | null = null;

  let panel: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  let mode: Mode = 'card';
  let note = '';
  let working = false;

  const tell = () => {
    for (const listener of listeners) listener();
  };

  const feed = createLineFeed(
    (id) => api.list(id),
    () => {
      draw();
      render();
      tell();
      options.onLinesChange?.();
    },
  );

  const byKey = (v: MapView): Map<HexKey, PublicTile> =>
    new Map(v.tiles.map((t) => [hexKey(t), t]));

  function draw(): void {
    if (!field || !view) return;
    field.draw(isClockworkView(view) ? feed.lines : [], byKey(view));
    options.invalidate();
  }

  const follow = (next: MapView): void => {
    if (next.map.id !== mapId) {
      mapId = next.map.id;
      generation += 1;
    }
    view = next;
    feed.follow(next);
    draw();
  };

  const myLine = (tile: Hex, kind: LineKind, me: string | null): PublicLine | null =>
    me === null
      ? null
      : (feed.lines.find(
          (l) => l.q === tile.q && l.r === tile.r && l.kind === kind && l.ownerUserId === me,
        ) ?? null);

  const cards = (tile: PublicTile, v: MapView): BuildCard[] => {
    view = v;
    const me = options.me();
    if (!isClockworkView(v) || !me || tile.ownerUserId !== me) return [];
    // Until the lines load, offer nothing rather than a second wire.
    if (!feed.loaded) return [];
    const supply = options.supply(v);
    return lineCards({
      tile,
      me,
      wire: myLine(tile, 'wire', me) !== null,
      rail: myLine(tile, 'rail', me)?.level ?? null,
      supplied: supply ? supply.supplied.has(hexKey(tile)) : null,
    });
  };

  const buildSource: BuildSource = {
    cards,
    bag: async () => {
      if (!mapId) throw new Error('no map');
      return api.items(mapId);
    },
    build: async (card, tile) => {
      const id = mapId;
      const me = options.me();
      const line = lineCardOf(card.id);
      if (!id || !me || !line) return null;
      const at = generation;
      const stillHere = () => at === generation && mapId === id;
      const res = await sendCommand(
        sendDeps,
        (key) =>
          api.act(id, lineCommandFor(line.level), { q: tile.q, r: tile.r, kind: line.kind }, key),
        stillHere,
      );
      if (!res || !stillHere()) return null;
      feed.apply(res, me);
      return line.kind === 'wire' ? LINE_TEXT.wireBuilt : LINE_TEXT.railBuilt(line.level);
    },
    onChange: (listener) => {
      listeners.push(listener);
    },
  };

  // --- The land tile's panel: what runs here, and Take up. ---

  async function takeUp(kind: LineKind): Promise<void> {
    if (!panel || working || !mapId) return;
    const id = mapId;
    const me = options.me();
    const { tile } = panel;
    if (!me) return;
    const at = generation;
    const stillHere = () => at === generation && mapId === id;
    working = true;
    note = '';
    render();
    try {
      const res = await sendCommand(
        sendDeps,
        (key) => api.act(id, 'remove', { q: tile.q, r: tile.r, kind }, key),
        stillHere,
      );
      if (res && stillHere()) {
        feed.apply(res, me);
        note = LINE_TEXT.tookUp(kind, refundText(res.refund));
      }
    } catch (err) {
      if (stillHere()) note = messageOf(err);
    } finally {
      working = false;
      mode = 'card';
      if (stillHere()) render();
    }
  }

  function render(): void {
    if (!panel) return;
    const { container, tile, view: v } = panel;
    const me = options.me();
    const parts: HTMLElement[] = [];
    const say = (text: string, testId?: string) =>
      el(
        'p',
        { class: 'tile-action-note road-row', ...(testId ? { 'data-testid': testId } : {}) },
        text,
      );
    const button = (label: string, testId: string, onClick: () => void, soft = false) => {
      const b = el(
        'button',
        {
          type: 'button',
          class: `${buttonClass({ variant: soft ? 'secondary' : 'primary' })} bag-action tile-action-pair road-row`,
          'data-testid': testId,
        },
        label,
      );
      b.disabled = working;
      b.addEventListener('click', onClick);
      return b;
    };
    if (isClockworkView(v)) {
      for (const kind of ['wire', 'rail'] as const) {
        const line = myLine(tile, kind, me);
        if (!line) continue;
        parts.push(
          say(
            kind === 'wire'
              ? line.powered === true
                ? LINE_TEXT.wireLit
                : LINE_TEXT.wireDark
              : LINE_TEXT.railLine(line.level),
            `${kind}-line`,
          ),
        );
        if (mode !== 'card' && mode.confirm === kind) {
          const back = refundText(lineRefund(kind, line.level));
          parts.push(
            say(LINE_TEXT.takeUpAsk(kind, back), `${kind}-confirm`),
            button(LINE_TEXT.yes, `${kind}-take-up-yes`, () => void takeUp(kind)),
            button(
              LINE_TEXT.keep,
              `${kind}-keep`,
              () => {
                mode = 'card';
                render();
              },
              true,
            ),
          );
        } else {
          parts.push(
            button(
              kind === 'wire' ? LINE_TEXT.takeUpWire : LINE_TEXT.takeUpRail,
              `${kind}-take-up`,
              () => {
                mode = { confirm: kind };
                note = '';
                render();
              },
              true,
            ),
          );
        }
      }
    }
    if (note) {
      const n = say(note, 'line-note');
      n.classList.remove('road-row');
      parts.push(n);
    }
    container.replaceChildren(...parts);
  }

  const tileActions: TileActions = {
    show: (container, tile, next) => {
      const same = panel?.tile.q === tile.q && panel.tile.r === tile.r;
      if (!same) {
        mode = 'card';
        note = '';
      }
      panel = { container, tile, view: next };
      render();
    },
    hide: () => {
      panel?.container.replaceChildren();
      panel = null;
      mode = 'card';
      note = '';
    },
  };

  const layer: MapLayer = {
    attach: (scene, next) => {
      field = new LineField(scene);
      scene.onDisposeObservable.addOnce(() => {
        field = null;
      });
      follow(next);
    },
    update: (next) => {
      follow(next);
    },
  };

  return {
    layer,
    buildSource,
    tileActions,
    rails: () =>
      feed.lines
        .filter((l) => l.kind === 'rail')
        .map((l) => ({ q: l.q, r: l.r, ownerUserId: l.ownerUserId, level: l.level })),
    version: () => feed.version,
    lines: () => feed.lines,
    get debug() {
      return {
        lines: feed.lines.length,
        loaded: feed.loaded,
        drawn: field ? field.debug : null,
      };
    },
  };
}
