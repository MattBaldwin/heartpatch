import {
  GAME_EVENTS,
  type ItemCounts,
  type MapView,
  type PublicFence,
  type PublicTile,
  type PublicUser,
  type WsEventMessage,
} from '@heartpatch/shared';
import { COMMAND_RETRY_MS, sendCommand } from '../inventory/send-command.js';
import type { TileActions } from '../map/map-screen.js';
import type { TerritoryScreen } from '../territory/territory-screen.js';
import { ApiRequestError } from '../net/api.js';
import { newIdempotencyKey } from '../net/idempotency-key.js';
import { el, messageOf } from '../ui/dom.js';
import { fenceApi, type FenceApi } from './fence-api.js';
import {
  canAfford,
  edgeName,
  fenceBuildCards,
  fenceCard,
  fenceIcon,
  FENCE_TEXT,
  isInterior,
  openEdges,
} from './fence-model.js';
import { setPanelFocus } from '../building/panel-focus.js';
import type { BuildSource } from '../building/tile-build.js';
import './fences.css';

// Fences in the tile panel (#203, the owner-approved mockup): on a tile of
// mine, a line saying whether it's fenced and a Fences button. That opens the
// fence sheet in the panel: each segment's card (energy, Repair, Upgrade with
// before and after, Take down with what comes back). Building a fence is the
// shared Build sheet's job (#371, build/tile-build.ts): this screen is its
// source for fence cards. The server checks every cost and rule (CLAUDE.md
// rule 1); this only shows what the map says and sends taps.

export interface FenceScreenOptions {
  api?: FenceApi;
}

/** Read-only state for the dev hook (Playwright asserts on it, not on pixels). */
export interface FenceDebug {
  readonly mapId: string;
  readonly mode: Mode['kind'] | null;
  readonly items: ItemCounts | null;
}

export interface FenceScreen {
  setMap: (mapId: string | null) => void;
  setUser: (user: PublicUser | null) => void;
  /** Every live event: my fences that a capture left on inner edges (#244). */
  liveEvent: (event: WsEventMessage) => void;
  readonly tileActions: TileActions;
  /** The fences the shared Build sheet can put up on a tile of mine. */
  readonly buildSource: BuildSource;
  readonly debug: FenceDebug | null;
}

type Mode =
  | { readonly kind: 'card' }
  | { readonly kind: 'list' }
  | { readonly kind: 'fence'; readonly id: string }
  | { readonly kind: 'confirm'; readonly id: string };

export function createFenceScreen(options: FenceScreenOptions = {}): FenceScreen {
  const api = options.api ?? fenceApi;
  let user: PublicUser | null = null;
  let mapId: string | null = null;
  let generation = 0;
  let items: ItemCounts | null = null;
  let loading = false;
  let working = false;
  let note = '';
  let mode: Mode = { kind: 'card' };
  let panel: { container: HTMLElement; tile: PublicTile; view: MapView } | null = null;
  /** My fences a capture of mine took down from inner edges, not yet said (#244). */
  let innerDown = 0;
  /** A command's answer for the tile on screen, until the map catches up. */
  let answer: { q: number; r: number; fences: readonly PublicFence[] } | null = null;

  const sendDeps = {
    newKey: newIdempotencyKey,
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    retryAfterMs: COMMAND_RETRY_MS,
  };

  /** The tile with the freshest fences we know of. */
  const current = (): PublicTile | null => {
    if (!panel) return null;
    const { tile } = panel;
    return answer && answer.q === tile.q && answer.r === tile.r
      ? { ...tile, fences: [...answer.fences] }
      : tile;
  };

  async function loadItems(): Promise<void> {
    const id = mapId;
    const at = generation;
    if (!id || loading) return;
    loading = true;
    try {
      const fresh = await api.items(id);
      if (at === generation) items = fresh;
    } catch (err) {
      if (at === generation) note = messageOf(err);
    } finally {
      loading = false;
      if (at === generation) render();
    }
  }

  async function act(run: (id: string, stillHere: () => boolean) => Promise<void>): Promise<void> {
    const id = mapId;
    if (!id || working) return;
    const at = generation;
    const stillHere = () => at === generation && mapId === id;
    working = true;
    note = '';
    render();
    try {
      await run(id, stillHere);
    } catch (err) {
      if (stillHere()) {
        note = messageOf(err);
        if (err instanceof ApiRequestError && err.code === 'CONFLICT') void loadItems();
      }
    } finally {
      working = false;
      if (stillHere()) render();
    }
  }

  const command = (
    send: (id: string, key: string) => ReturnType<FenceApi['build']>,
    after: (refund: ItemCounts) => void,
  ) =>
    act(async (id, stillHere) => {
      const res = await sendCommand(sendDeps, (key) => send(id, key), stillHere);
      if (!res || !stillHere()) return;
      items = res.items;
      answer = { q: res.q, r: res.r, fences: res.fences };
      after(res.refund);
    });

  // ── Drawing ───────────────────────────────────────────────────────────

  const line = (text: string, testId?: string) =>
    el('p', { class: 'tile-action-note', ...(testId ? { 'data-testid': testId } : {}) }, text);

  const button = (
    label: string,
    onTap: () => void,
    extra: Record<string, string> = {},
    soft = false,
  ) => {
    const b = el(
      'button',
      {
        type: 'button',
        class: `auth-button bag-action${soft ? ' auth-button-soft' : ''}`,
        ...extra,
      },
      label,
    );
    b.disabled = working;
    b.addEventListener('click', onTap);
    return b;
  };

  const go = (next: Mode) => {
    mode = next;
    note = '';
    render();
  };

  /** The one line the tile's card shows, and the button into the sheet. */
  function cardNodes(tile: PublicTile, view: MapView, me: string): HTMLElement[] {
    const fences = tile.fences ?? [];
    const open = openEdges(tile, view, me).length;
    // Nothing to say on a home tile with no fences: nobody can take it.
    if (tile.homeSlot !== null && fences.length === 0) return [];
    let status: string;
    if (open === 0 && fences.length === 0) status = FENCE_TEXT.inside;
    else if (open === 0) status = FENCE_TEXT.fenced;
    else status = FENCE_TEXT.open(open);
    return [
      line(status, 'fence-status'),
      ...(fences.length > 0
        ? [
            button(
              FENCE_TEXT.openSheet(fences.length),
              () => {
                go({ kind: 'list' });
              },
              { 'data-testid': 'fence-open' },
              true,
            ),
          ]
        : []),
    ];
  }

  function listNodes(tile: PublicTile, view: MapView, me: string): HTMLElement[] {
    const fences = [...(tile.fences ?? [])].sort((a, b) => a.edge - b.edge);
    const open = openEdges(tile, view, me);
    const rows = fences.map((f) => {
      const card = fenceCard(f);
      const b = button(
        `${fenceIcon(f.buildingId)} ${FENCE_TEXT.segment(card?.name ?? 'Fence', edgeName(f.edge), card?.percent ?? 100)}`,
        () => {
          go({ kind: 'fence', id: f.id });
        },
        { 'data-testid': 'fence-segment', 'data-edge': String(f.edge) },
        true,
      );
      b.classList.add('fence-row');
      return el('li', {}, b);
    });
    return [
      line(
        open.length === 0
          ? fences.length > 0
            ? FENCE_TEXT.fenced
            : FENCE_TEXT.inside
          : FENCE_TEXT.open(open.length),
        'fence-status',
      ),
      ...(rows.length > 0
        ? [el('ul', { class: 'fence-list', 'data-testid': 'fence-list' }, ...rows)]
        : []),
      el(
        'div',
        { class: 'territory-row fence-actions' },
        button(
          FENCE_TEXT.back,
          () => {
            go({ kind: 'card' });
          },
          {},
          true,
        ),
      ),
    ];
  }

  function fenceNodes(fence: PublicFence): HTMLElement[] {
    const card = fenceCard(fence);
    if (!card) return [line(FENCE_TEXT.noRefund)];
    const bar = el('progress', {
      class: 'fence-energy',
      max: String(fence.maxHp),
      value: String(fence.hp),
      'aria-label': FENCE_TEXT.energy(card.percent),
    });
    const bag = items ?? {};
    const nodes: HTMLElement[] = [
      el(
        'p',
        { class: 'fence-card-title', 'data-testid': 'fence-card' },
        `${fenceIcon(fence.buildingId)} ${card.name} · ${edgeName(fence.edge)}`,
      ),
      el(
        'div',
        { class: 'fence-energy-row' },
        bar,
        el('span', { 'data-testid': 'fence-percent' }, FENCE_TEXT.energy(card.percent)),
      ),
      line(`${FENCE_TEXT.level(fence.level)} · ${FENCE_TEXT.cracks(card.element)}`),
    ];
    const row: HTMLElement[] = [];
    if (card.repair) {
      const repair = card.repair;
      const b = button(
        FENCE_TEXT.repair(FENCE_TEXT.costOf(repair)),
        () =>
          void command(
            (id, key) => api.act(id, fence.id, 'repair', key),
            () => {
              note = FENCE_TEXT.repaired;
            },
          ),
        { 'data-testid': 'fence-repair' },
      );
      if (items && !canAfford(bag, repair)) b.disabled = true;
      row.push(b);
    }
    if (card.upgrade) {
      const up = card.upgrade;
      nodes.push(
        line(
          FENCE_TEXT.upgradeFrom(fence.hp, fence.maxHp, up.hp, up.maxHp),
          'fence-upgrade-preview',
        ),
      );
      const b = button(
        FENCE_TEXT.upgrade(FENCE_TEXT.costOf(up.cost)),
        () =>
          void command(
            (id, key) => api.act(id, fence.id, 'upgrade', key),
            () => {
              note = FENCE_TEXT.upgraded(fence.level + 1);
            },
          ),
        { 'data-testid': 'fence-upgrade' },
      );
      if (items && !canAfford(bag, up.cost)) b.disabled = true;
      row.push(b);
    } else {
      nodes.push(line(FENCE_TEXT.topLevel));
    }
    if (row.length > 0) nodes.push(el('div', { class: 'territory-row fence-actions' }, ...row));
    nodes.push(
      el(
        'div',
        { class: 'territory-row fence-actions' },
        button(
          FENCE_TEXT.takeDown,
          () => {
            go({ kind: 'confirm', id: fence.id });
          },
          { 'data-testid': 'fence-take-down' },
          true,
        ),
        button(
          FENCE_TEXT.back,
          () => {
            go({ kind: 'list' });
          },
          {},
          true,
        ),
      ),
    );
    if (!items) void loadItems();
    return nodes;
  }

  function confirmNodes(
    tile: PublicTile,
    view: MapView,
    me: string,
    fence: PublicFence,
  ): HTMLElement[] {
    const card = fenceCard(fence);
    const refund = card?.refund ?? {};
    const words = FENCE_TEXT.items(refund);
    return [
      el('p', { class: 'fence-card-title' }, FENCE_TEXT.takeDownTitle),
      ...(isInterior(tile, fence.edge, view, me)
        ? [line(FENCE_TEXT.interiorNote, 'fence-interior')]
        : []),
      line(words ? FENCE_TEXT.refund(words) : FENCE_TEXT.noRefund),
      el(
        'div',
        { class: 'territory-row fence-actions' },
        button(
          FENCE_TEXT.keep,
          () => {
            go({ kind: 'fence', id: fence.id });
          },
          {},
          true,
        ),
        button(
          FENCE_TEXT.yesTakeDown,
          () =>
            void command(
              (id, key) => api.act(id, fence.id, 'remove', key),
              (back) => {
                mode = { kind: 'list' };
                note = FENCE_TEXT.takenDown(FENCE_TEXT.items(back));
              },
            ),
          { 'data-testid': 'fence-yes-take-down' },
        ),
      ),
    ];
  }

  function render(): void {
    if (!panel) return;
    const { container, view } = panel;
    const tile = current();
    const me = user?.id ?? null;
    const mine = tile !== null && me !== null && tile.ownerUserId === me;
    if (!tile || !mine) {
      container.replaceChildren();
      setFocus(container, false);
      return;
    }
    const byId = (id: string) => (tile.fences ?? []).find((f) => f.id === id);
    let nodes: HTMLElement[];
    // A fence that's gone (broken, taken down elsewhere): back to the list.
    if ((mode.kind === 'fence' || mode.kind === 'confirm') && !byId(mode.id))
      mode = { kind: 'list' };
    switch (mode.kind) {
      case 'card':
        nodes = cardNodes(tile, view, me);
        break;
      case 'list':
        nodes = listNodes(tile, view, me);
        break;
      case 'fence': {
        const fence = byId(mode.id);
        nodes = fence ? fenceNodes(fence) : [];
        break;
      }
      case 'confirm': {
        const fence = byId(mode.id);
        nodes = fence ? confirmNodes(tile, view, me, fence) : [];
        break;
      }
    }
    if (note && nodes.length > 0) nodes.push(line(note, 'fence-note'));
    // Said once, on the next tile of mine the panel shows.
    if (innerDown > 0) {
      nodes.unshift(line(FENCE_TEXT.innerDown(innerDown), 'fence-inner'));
      innerDown = 0;
    }
    setFocus(container, mode.kind !== 'card');
    container.replaceChildren(...nodes);
  }

  /** A step of the fence sheet has the panel to itself, like a fire's card. */
  function setFocus(container: HTMLElement, focused: boolean): void {
    setPanelFocus(container, 'fences', focused);
  }

  const reset = () => {
    generation += 1;
    items = null;
    answer = null;
    innerDown = 0;
    mode = { kind: 'card' };
    note = '';
  };

  /** The fences, as the shared Build sheet's cards (#371). */
  const buildSource: BuildSource = {
    cards: (tile, view) => {
      const me = user?.id ?? null;
      if (!me || tile.ownerUserId !== me || tile.homeSlot !== null) return [];
      const here = panel && panel.tile.q === tile.q && panel.tile.r === tile.r ? current() : null;
      return fenceBuildCards(here ?? tile, view, me);
    },
    openEdges: (tile, view) => {
      const me = user?.id ?? null;
      if (!me || tile.ownerUserId !== me || tile.homeSlot !== null) return [];
      const here = panel && panel.tile.q === tile.q && panel.tile.r === tile.r ? current() : null;
      return openEdges(here ?? tile, view, me);
    },
    bag: async () => {
      const id = mapId;
      if (!id) throw new Error('no map');
      const fresh = await api.items(id);
      items = fresh;
      return fresh;
    },
    build: async (card, tile, edges) => {
      const id = mapId;
      if (!id) return null;
      const at = generation;
      const stillHere = () => at === generation && mapId === id;
      const res = await sendCommand(
        sendDeps,
        (key) =>
          api.build(id, { buildingId: card.id, q: tile.q, r: tile.r, edges: [...edges] }, key),
        stillHere,
      );
      if (!res || !stillHere()) return null;
      items = res.items;
      answer = { q: res.q, r: res.r, fences: res.fences };
      render();
      return FENCE_TEXT.built(edges.length);
    },
    // The fences come with the map view, which re-shows the panel itself.
    onChange: () => undefined,
    invalidate: () => {
      items = null;
    },
  };

  return {
    buildSource,
    setMap: (next) => {
      if (next === mapId) return;
      reset();
      mapId = next;
      render();
    },
    setUser: (next) => {
      if (next?.id === user?.id) return;
      user = next;
      mapId = null;
      reset();
      render();
    },
    liveEvent: (event) => {
      if (event.mapId !== mapId || event.type !== 'fence.removed') return;
      const parsed = GAME_EVENTS['fence.removed'].public.safeParse(event.data);
      if (parsed.success && parsed.data.lost === 'inner' && parsed.data.userId === user?.id) {
        innerDown += 1;
        render();
      }
    },
    tileActions: {
      show: (container, tile, view) => {
        const same = panel?.tile.q === tile.q && panel.tile.r === tile.r;
        if (!same) {
          mode = { kind: 'card' };
          note = '';
        }
        // Another tile, or the map has caught up with our last command.
        if (!same || (answer && sameFences(answer.fences, tile.fences ?? []))) answer = null;
        panel = { container, tile, view };
        render();
      },
      hide: () => {
        if (panel) setFocus(panel.container, false);
        panel?.container.replaceChildren();
        panel = null;
        mode = { kind: 'card' };
        note = '';
      },
    },
    get debug() {
      if (!mapId) return null;
      return { mapId, mode: panel ? mode.kind : null, items };
    },
  };
}

/** The same segments, each at the same level and energy. */
function sameFences(a: readonly PublicFence[], b: readonly PublicFence[]): boolean {
  const key = (f: PublicFence) => `${f.id}:${String(f.level)}:${String(f.hp)}`;
  const set = new Set(a.map(key));
  return a.length === b.length && b.every((f) => set.has(key(f)));
}

/**
 * Fences follow the territory screen onto and off every map (main.ts calls
 * `territory.setMap` wherever a map opens or closes), like the raid report.
 * Their tile actions go in the panel's list on their own, so a fence step can
 * have the panel to itself.
 */
export function withFences(territory: TerritoryScreen, fences: FenceScreen): TerritoryScreen {
  return {
    setMap: async (mapId) => {
      fences.setMap(mapId);
      await territory.setMap(mapId);
    },
    setUser: (next) => {
      fences.setUser(next);
      territory.setUser(next);
    },
    tileActions: territory.tileActions,
    get debug() {
      return territory.debug;
    },
  };
}
