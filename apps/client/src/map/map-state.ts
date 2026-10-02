import {
  GAME_EVENTS,
  hexKey,
  type HexKey,
  type MapMember,
  type MapView,
  type PublicTile,
  type WsEventMessage,
} from '@heartpatch/shared';

// The client's copy of one map (tech spec §6 "State"): exactly what the
// server sent, plus live events applied in seq order. The server is the
// source of truth; nothing here decides who owns what.

/**
 * What a live event means for the map on screen:
 * - `none`: nothing to redraw (the copy may still have changed, e.g. a setting).
 * - `redraw`: a tile changed in a way the event fully describes (a capture,
 *   #15): the copy is updated, so redraw the map and the tile panel from it.
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
        this.patchTile(parsed.data, { gathering });
        return 'none';
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
        // The tile changed hands (#15). Squishies on watch went home, and the
        // old owner's gather there no longer shows (#17).
        const parsed = GAME_EVENTS['tile.captured'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        const changed = this.patchTile(parsed.data, {
          ownerUserId: parsed.data.userId,
          defenders: 0,
          gathering: null,
        });
        return changed ? 'redraw' : 'none';
      }
      case 'defenders.changed': {
        const parsed = GAME_EVENTS['defenders.changed'].public.safeParse(event.data);
        if (!parsed.success) return 'resync';
        return this.patchTile(parsed.data, { defenders: parsed.data.count }) ? 'redraw' : 'none';
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

  private index(): void {
    this.byHex = new Map(this.current.tiles.map((t) => [hexKey(t), t]));
    this.byUser = new Map(this.current.members.map((m) => [m.user.id, m]));
  }
}
