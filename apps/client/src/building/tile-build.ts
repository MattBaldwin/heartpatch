import type { ItemCounts, MapView, PublicTile } from '@heartpatch/shared';
import type { MapScreen, TileActions } from '../map/map-screen.js';
import { el, messageOf } from '../ui/dom.js';
import { ApiRequestError } from '../net/api.js';
import { BUILD_TEXT, pickCard, type BuildCard } from './build-model.js';
import { createBuildSheet } from './build-sheet.js';
import { setPanelFocus } from './panel-focus.js';

// Building on my land from the map (#371): tap the tile, tap Build, tap the
// lit spot or edges on the 3D tile, pick the building from the row, tap
// Build!. Fires, lanterns, Training Grounds and fences are all the same
// sheet; each feature only says what it can build here and how. The server
// checks every cost and rule (CLAUDE.md rule 1).

/** What one feature can build on my tile. */
export interface BuildSource {
  /** The cards it offers on `tile` (none: not mine, no room, nothing to build). */
  cards: (tile: PublicTile, view: MapView) => readonly BuildCard[];
  /** Edges a card that goes on edges could use on `tile`. */
  openEdges?: (tile: PublicTile, view: MapView) => readonly number[];
  /** My bag, read fresh when the sheet opens. */
  bag?: () => Promise<ItemCounts>;
  /**
   * Builds `card` on `tile` (on `edges`, for edge cards). Resolves to the line
   * to say, or null when the map moved on; throws what the server said.
   */
  build: (card: BuildCard, tile: PublicTile, edges: readonly number[]) => Promise<string | null>;
  /** Registers who to tell when its cards may have changed (its data loaded). */
  onChange: (listener: () => void) => void;
  /** Another source built something: read your own state again. */
  invalidate?: () => void;
}

export interface TileBuildOptions {
  readonly sources: readonly BuildSource[];
  /** The map screen's lit-tile hook (late-bound: the map is made with this). */
  readonly area: () => Pick<MapScreen, 'setBuildArea'>;
  /** Brings the tile into view above the sheet (the camera glides to it). */
  readonly reveal?: (tile: PublicTile) => void;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface TileBuildDebug {
  readonly mode: 'card' | 'build' | null;
  readonly cards: readonly string[];
  readonly selected: string | null;
  readonly edges: readonly number[];
  readonly bag: ItemCounts | null;
}

export interface TileBuild {
  readonly tileActions: TileActions;
  readonly debug: TileBuildDebug;
}

type Mode = 'card' | 'build';

export function createTileBuild(options: TileBuildOptions): TileBuild {
  const sheet = createBuildSheet();
  let panel: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  let mode: Mode = 'card';
  let selectedId: string | null = null;
  /** Edges picked on the 3D tile, in order. */
  let picked: readonly number[] = [];
  let bag: ItemCounts | null = null;
  let working = false;
  let note = '';
  /** Bumped when the panel moves on, so an answer to an old tile is dropped. */
  let generation = 0;

  const cardsFor = (tile: PublicTile, view: MapView) =>
    options.sources.flatMap((s) => s.cards(tile, view));
  const sourceOf = (tile: PublicTile, view: MapView, card: BuildCard) =>
    options.sources.find((s) => s.cards(tile, view).some((c) => c.id === card.id));
  const openFor = (tile: PublicTile, view: MapView) => [
    ...new Set(options.sources.flatMap((s) => s.openEdges?.(tile, view) ?? [])),
  ];

  const setFocus = (container: HTMLElement, focused: boolean) => {
    setPanelFocus(container, 'build', focused);
  };

  function light(tile: PublicTile, view: MapView, cards: readonly BuildCard[]): void {
    const card = pickCard(cards, selectedId, bag);
    const open = openFor(tile, view);
    options.area().setBuildArea({
      view: {
        tile,
        edges:
          card?.area === 'edges' ? open.map((edge) => ({ edge, on: picked.includes(edge) })) : [],
        centre: card?.area === 'spot' ? 'on' : null,
      },
      onTap: (hit) => {
        if (working || hit === 'centre' || card?.area !== 'edges') return;
        if (!open.includes(hit.edge)) return;
        picked = picked.includes(hit.edge)
          ? picked.filter((e) => e !== hit.edge)
          : [...picked, hit.edge].sort((a, b) => a - b);
        render();
      },
    });
  }

  function render(): void {
    if (!panel) return;
    const { container, tile, view } = panel;
    const cards = cardsFor(tile, view);
    const saying = () =>
      note
        ? [
            el(
              'p',
              { class: 'tile-action-note', role: 'status', 'data-testid': 'tile-build-note' },
              note,
            ),
          ]
        : [];
    if (cards.length === 0) {
      // Nothing left to build (the last edge was just fenced): still say so.
      if (mode === 'build') leave(note);
      container.replaceChildren(...saying());
      setFocus(container, false);
      return;
    }
    if (mode === 'card') {
      setFocus(container, false);
      const go = el(
        'button',
        {
          type: 'button',
          class: 'auth-button bag-action',
          'data-testid': 'tile-build',
        },
        BUILD_TEXT.build,
      );
      go.addEventListener('click', open);
      container.replaceChildren(...saying(), go);
      return;
    }
    const open_ = openFor(tile, view);
    picked = picked.filter((e) => open_.includes(e));
    const card = pickCard(cards, selectedId, bag);
    selectedId = card?.id ?? null;
    const edgeCard = card?.area === 'edges';
    sheet.update({
      cards,
      selectedId,
      bag,
      areas: edgeCard ? picked.length : 1,
      hint: edgeCard
        ? picked.length === 0
          ? BUILD_TEXT.pickAnEdge
          : BUILD_TEXT.tapEdges
        : BUILD_TEXT.centre,
      allEdges: edgeCard ? { all: picked.length === open_.length } : null,
      working,
      note,
      onSelect: (id) => {
        selectedId = id;
        note = '';
        render();
      },
      onAllEdges: () => {
        picked = picked.length === open_.length ? [] : [...open_];
        render();
      },
      onBuild: () => void build(),
      onCancel: () => {
        leave('');
        render();
      },
    });
    setFocus(container, true);
    if (sheet.element.parentElement !== container) container.replaceChildren(sheet.element);
    light(tile, view, cards);
  }

  function leave(say: string): void {
    mode = 'card';
    note = say;
    selectedId = null;
    picked = [];
    options.area().setBuildArea(null);
  }

  function open(): void {
    if (!panel) return;
    const { tile, view } = panel;
    mode = 'build';
    note = '';
    selectedId = null;
    picked = [...openFor(tile, view)];
    options.reveal?.(tile);
    render();
    const at = generation;
    const reader = options.sources.find((s) => s.bag)?.bag;
    if (reader) {
      void reader()
        .then((fresh) => {
          if (at !== generation) return;
          bag = fresh;
          render();
        })
        .catch(() => {
          // The sheet still works without the bag; the server checks the cost.
        });
    }
  }

  async function build(): Promise<void> {
    if (!panel || working) return;
    const { tile, view } = panel;
    const cards = cardsFor(tile, view);
    const card = pickCard(cards, selectedId, bag);
    if (!card) return;
    const source = sourceOf(tile, view, card);
    if (!source) return;
    const edges = card.area === 'edges' ? picked : [];
    const at = generation;
    working = true;
    note = '';
    render();
    try {
      const say = await source.build(card, tile, edges);
      if (at !== generation || say === null) return;
      working = false;
      for (const other of options.sources) if (other !== source) other.invalidate?.();
      leave(say);
      // The bag moved on: the next sheet reads it again.
      bag = null;
      render();
    } catch (err) {
      if (at !== generation) return;
      note = messageOf(err);
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') bag = null;
    } finally {
      if (at === generation) {
        working = false;
        render();
      }
    }
  }

  for (const source of options.sources) source.onChange(render);

  return {
    tileActions: {
      show: (container, tile, view) => {
        const same = panel?.tile.q === tile.q && panel.tile.r === tile.r;
        if (!same) {
          generation += 1;
          if (mode === 'build') options.area().setBuildArea(null);
          mode = 'card';
          note = '';
          selectedId = null;
          picked = [];
          bag = null;
          working = false;
        }
        panel = { container, tile, view };
        render();
      },
      hide: () => {
        generation += 1;
        if (panel) setFocus(panel.container, false);
        panel?.container.replaceChildren();
        panel = null;
        if (mode === 'build') options.area().setBuildArea(null);
        mode = 'card';
        note = '';
        selectedId = null;
        picked = [];
        bag = null;
        working = false;
      },
    },
    get debug() {
      const cards = panel ? cardsFor(panel.tile, panel.view) : [];
      return {
        mode: panel ? mode : null,
        cards: cards.map((c) => c.id),
        selected: pickCard(cards, selectedId, bag)?.id ?? null,
        edges: picked,
        bag,
      };
    },
  };
}
