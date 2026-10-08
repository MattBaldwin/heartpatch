import {
  GAME_EVENTS,
  hexKey,
  type HexKey,
  type MapMember,
  type MapView,
  type PlacedBuilding,
  type PlacedFence,
  type PublicTile,
  type WsEventMessage,
} from '@heartpatch/shared';

// The client's copy of one map (tech spec §6 "State"): exactly what the
// server sent, plus live events applied in seq order. The server is the
// source of truth; nothing here decides who owns what.

/**
 * What a live event means for the map on screen:
 * - `none`: nothing to redraw (the copy may still have changed, e.g. a setting).
 * - `redraw`: the copy changed in a way the event fully describes (a capture,
 *   #15; a Keeper's outfit, #43): it's updated, so redraw the map and the tile
 *   panel from it.
 * - `resync`: the change touches tiles and members in ways only the server
 *   knows (a member joining gets a home base, a leaver's land goes wild), so
 *   refetch the map view rather than guess.
 */
export type LiveEventEffect = 'none' | 'redraw' | 'resync';

export class MapState {
  private current: MapView;
  private byHex = new Map<HexKey, PublicTile>();
  private byUser = new Map<string, MapMember>();

  constructor(view: MapView) {
    this.current = view;
    this.index();
  }

  get view(): MapView {
    return this.current;
  }

  get id(): string {
    return this.current.map.id;
  }

  tileAt(key: HexKey): PublicTile | undefined {
    return this.byHex.get(key);
  }

  member(userId: string): MapMember | undefined {
    return this.byUser.get(userId);
  }

  /** Swaps in a fresh view from the server (open, resync). */
  replace(view: MapView): void {
    this.current = view;
    this.index();
  }

  /** Applies one live event (in seq order, once each; ws-client guarantees both). */
  apply(event: WsEventMessage): LiveEventEffect {
    switch (event.type) {
      case 'map.updated': {
        const parsed = GAME_EVENTS['map.updated'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        this.current = { ...this.current, map: { ...this.current.map, ...parsed.data } };
        return 'none';
      }
      // Members came or went, or untended land went wild again at nightfall
      // (owner decision 2026-10-06): neutral now, with guardians whose hints
      // come from the map view, so refetch it (once a night at most). Trading
      // posts came to this older patch (#269): new terrain and names, from the view.
      case 'member.joined':
      case 'member.left':
      case 'member.removed':
      case 'tile.rewilded':
      case 'post.placed':
        return 'resync';
      case 'gather.started':
      case 'resource.gathered': {
        // A gather started ("gathering here, ready at …") or was collected (#17).
        const parsed =
          event.type === 'gather.started'
            ? GAME_EVENTS['gather.started'].public.safeParse(event.data)
            : GAME_EVENTS['resource.gathered'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        const gathering = 'readyAt' in parsed.data ? { readyAt: parsed.data.readyAt } : null;
        this.patchTile(parsed.data, { gathering });
        return 'none';
      }
      case 'outfit.changed': {
        // A member's Keeper changed clothes (#43): dress it on the map.
        const parsed = GAME_EVENTS['outfit.changed'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        const member = this.byUser.get(parsed.data.userId);
        if (!member?.keeper) return 'none';
        const next = { ...member, keeper: { ...member.keeper, wearing: parsed.data.wearing } };
        this.current = {
          ...this.current,
          members: this.current.members.map((m) => (m === member ? next : m)),
        };
        this.byUser.set(next.user.id, next);
        return 'redraw';
      }
      case 'tile.attacked': {
        // A battle for the tile started (#15): it rests until `cooldownUntil`.
        const parsed = GAME_EVENTS['tile.attacked'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        return this.patchTile(parsed.data, { cooldownUntil: parsed.data.cooldownUntil })
          ? 'redraw'
          : 'none';
      }
      case 'tile.captured': {
        // The tile changed hands (#15). Squishies on watch went home, the
        // old owner's gather there no longer shows (#17), and owned land has
        // no wild guardians to hint at (owner decision 10).
        const parsed = GAME_EVENTS['tile.captured'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        const changed = this.patchTile(parsed.data, {
          ownerUserId: parsed.data.userId,
          defenders: 0,
          gathering: null,
          guardianHint: null,
          // The old owner's gatherer there stopped (squishy jobs).
          workers: 0,
          // Explored and homestead belong to the owner (#199): the new
          // owner's homestead events follow, and a refresh fills the rest.
          explored: false,
          homestead: null,
        });
        return changed ? 'redraw' : 'none';
      }
      case 'tile.explored': {
        // Its owner searched every spot (#199): the map shows a sparkle.
        const parsed = GAME_EVENTS['tile.explored'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        return this.patchTile(parsed.data, { explored: true }) ? 'redraw' : 'none';
      }
      case 'homestead.joined':
      case 'homestead.paused':
      case 'homestead.resumed': {
        // Homesteads joined home, napped when cut off, or woke up (#199).
        const parsed = GAME_EVENTS[event.type].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        const homestead = event.type === 'homestead.paused' ? 'paused' : 'joined';
        let changed = false;
        for (const t of parsed.data.tiles) changed = this.patchTile(t, { homestead }) || changed;
        return changed ? 'redraw' : 'none';
      }
      case 'squishy.assigned': {
        // A squishy left or started gathering on a tile (squishy jobs): the
        // tile's gatherer count follows it.
        const parsed = GAME_EVENTS['squishy.assigned'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        const { from, to } = parsed.data;
        const workers = (at: { q: number; r: number }) => this.byHex.get(hexKey(at))?.workers ?? 0;
        const left = from
          ? this.patchTile(from, { workers: Math.max(0, workers(from) - 1) })
          : false;
        const came = to ? this.patchTile(to, { workers: workers(to) + 1 }) : false;
        return left || came ? 'redraw' : 'none';
      }
      case 'defenders.changed': {
        const parsed = GAME_EVENTS['defenders.changed'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        return this.patchTile(parsed.data, { defenders: parsed.data.count }) ? 'redraw' : 'none';
      }
      case 'building.placed':
      case 'building.fueled':
      case 'building.upgraded': {
        // A building went up, a fire was fuelled and lit (#18), or a building
        // was upgraded: a new level, model and safe radius (owner decision 2026-10-06).
        const parsed = GAME_EVENTS[event.type].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        // Fires on land are built and fuelled from the map itself (#202), so
        // the map redraws them (and their glow) at once.
        return this.putBuilding(parsed.data.building) ? 'redraw' : 'none';
      }
      case 'building.moved': {
        const parsed = GAME_EVENTS['building.moved'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        const left = this.dropBuilding(hexKey(parsed.data.from), parsed.data.building.id);
        const came = this.putBuilding(parsed.data.building);
        return left || came ? 'redraw' : 'none';
      }
      case 'building.removed': {
        const parsed = GAME_EVENTS['building.removed'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        return this.dropBuilding(hexKey(parsed.data), parsed.data.buildingRowId)
          ? 'redraw'
          : 'none';
      }
      case 'fence.built':
      case 'fence.upgraded':
      case 'fence.repaired':
      case 'fence.damaged': {
        // A fence segment went up, grew, was mended, or held against a
        // challenger and kept the energy it lost (#203).
        const parsed = GAME_EVENTS[event.type].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        return this.putFence(parsed.data.fence) ? 'redraw' : 'none';
      }
      case 'fence.broken':
      case 'fence.removed': {
        // Broken by a challenger, or taken down (#203).
        const parsed = GAME_EVENTS[event.type].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        return this.dropFence(hexKey(parsed.data), parsed.data.fenceId) ? 'redraw' : 'none';
      }
      default:
        // Types this map doesn't draw (yet).
        return 'none';
    }
  }

  /** Changes one tile in the copy; false if the map has no such tile. */
  private patchTile(at: { q: number; r: number }, change: Partial<PublicTile>): boolean {
    const key = hexKey(at);
    const tile = this.byHex.get(key);
    if (!tile) return false;
    const next = { ...tile, ...change };
    this.byHex.set(key, next);
    this.current = {
      ...this.current,
      tiles: this.current.tiles.map((t) => (t === tile ? next : t)),
    };
    return true;
  }

  /** Adds or replaces a building on its tile, keeping spot order. */
  private putBuilding(placed: PlacedBuilding): boolean {
    const { q, r, ...building } = placed;
    const key = hexKey({ q, r });
    return this.editTile(key, (tile) =>
      [...tile.buildings.filter((b) => b.id !== building.id), building].sort(
        (a, b) => a.spot - b.spot,
      ),
    );
  }

  private dropBuilding(key: HexKey, id: string): boolean {
    return this.editTile(key, (tile) => tile.buildings.filter((b) => b.id !== id));
  }

  /** Adds or replaces a fence segment on its tile, keeping edge order (#203). */
  private putFence(placed: PlacedFence): boolean {
    const { q, r, ...fence } = placed;
    const tile = this.byHex.get(hexKey({ q, r }));
    if (!tile) return false;
    const fences = [...(tile.fences ?? []).filter((f) => f.id !== fence.id), fence].sort(
      (a, b) => a.edge - b.edge,
    );
    return this.patchTile(tile, { fences });
  }

  private dropFence(key: HexKey, id: string): boolean {
    const tile = this.byHex.get(key);
    if (!tile) return false;
    return this.patchTile(tile, { fences: (tile.fences ?? []).filter((f) => f.id !== id) });
  }

  /** Changes a tile's buildings; false if the map has no such tile. */
  private editTile(key: HexKey, buildings: (tile: PublicTile) => PublicTile['buildings']): boolean {
    const tile = this.byHex.get(key);
    return tile ? this.patchTile(tile, { buildings: buildings(tile) }) : false;
  }

  private index(): void {
    this.byHex = new Map(this.current.tiles.map((t) => [hexKey(t), t]));
    this.byUser = new Map(this.current.members.map((m) => [m.user.id, m]));
  }
}
