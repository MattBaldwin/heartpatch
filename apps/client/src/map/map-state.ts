import {
  GAME_EVENTS,
  hexKey,
  type HexKey,
  type MapMember,
  type MapView,
  type PlacedBuilding,
  type PublicTile,
  type WsEventMessage,
} from '@heartpatch/shared';

// The client's copy of one map (tech spec §6 "State"): exactly what the
// server sent, plus live events applied in seq order. The server is the
// source of truth; nothing here decides who owns what.

/**
 * What a live event means for the map on screen:
 * - `none`: nothing to redraw (the copy may still have changed, e.g. a setting).
 * - `resync`: the change touches tiles and members in ways only the server
 *   knows (a member joining gets a home base, a leaver's land goes wild), so
 *   refetch the map view rather than guess.
 */
export type LiveEventEffect = 'none' | 'resync';

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
      case 'member.joined':
      case 'member.left':
      case 'member.removed':
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
        const key = hexKey(parsed.data);
        const tile = this.byHex.get(key);
        if (!tile) return 'none';
        const next = { ...tile, gathering };
        this.byHex.set(key, next);
        this.current = {
          ...this.current,
          tiles: this.current.tiles.map((t) => (t === tile ? next : t)),
        };
        return 'none';
      }
      case 'building.placed':
      case 'building.fueled': {
        // A building went up, or a fire was fuelled and lit (#18).
        const parsed = GAME_EVENTS[event.type].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        this.putBuilding(parsed.data.building);
        return 'none';
      }
      case 'building.moved': {
        const parsed = GAME_EVENTS['building.moved'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        this.dropBuilding(hexKey(parsed.data.from), parsed.data.building.id);
        this.putBuilding(parsed.data.building);
        return 'none';
      }
      case 'building.removed': {
        const parsed = GAME_EVENTS['building.removed'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        this.dropBuilding(hexKey(parsed.data), parsed.data.buildingRowId);
        return 'none';
      }
      default:
        // Types this map doesn't draw (yet). Tile events arrive with their
        // issue (#13) and are applied here then.
        return 'none';
    }
  }

  /** Adds or replaces a building on its tile, keeping spot order. */
  private putBuilding(placed: PlacedBuilding): void {
    const { q, r, ...building } = placed;
    const key = hexKey({ q, r });
    this.editTile(key, (tile) =>
      [...tile.buildings.filter((b) => b.id !== building.id), building].sort(
        (a, b) => a.spot - b.spot,
      ),
    );
  }

  private dropBuilding(key: HexKey, id: string): void {
    this.editTile(key, (tile) => tile.buildings.filter((b) => b.id !== id));
  }

  private editTile(key: HexKey, buildings: (tile: PublicTile) => PublicTile['buildings']): void {
    const tile = this.byHex.get(key);
    if (!tile) return;
    const next = { ...tile, buildings: buildings(tile) };
    this.byHex.set(key, next);
    this.current = {
      ...this.current,
      tiles: this.current.tiles.map((t) => (t === tile ? next : t)),
    };
  }

  private index(): void {
    this.byHex = new Map(this.current.tiles.map((t) => [hexKey(t), t]));
    this.byUser = new Map(this.current.members.map((m) => [m.user.id, m]));
  }
}
