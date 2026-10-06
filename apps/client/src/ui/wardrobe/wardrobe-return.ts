// Where "Done" takes the player (owner playtest, 2026-10-06): back to the
// patch they opened the wardrobe from, or the lobby if that's where they
// were. Worked out when it opens, since opening puts the map away.

/** Where the wardrobe was opened: a patch (or the Tutorial Glade), or null for the lobby. */
export type WardrobeFrom = { readonly mapId: string; readonly glade: boolean } | null;

export interface WardrobeOpenedOver {
  /** The lobby's panel is up: the wardrobe came from its list. */
  readonly lobbyOpen: boolean;
  /** The patch on screen: its map, home base, a battle or a close-up. */
  readonly patch: string | null;
  /** The Tutorial Glade, while a tutorial run has it open. */
  readonly glade: string | null;
}

/** Remembers where the player was as the wardrobe opens. */
export function wardrobeFrom(over: WardrobeOpenedOver): WardrobeFrom {
  if (over.lobbyOpen) return null;
  const mapId = over.patch ?? over.glade;
  return mapId === null ? null : { mapId, glade: mapId === over.glade };
}

/**
 * The map to go back to as the wardrobe closes, or null for the lobby. The
 * Glade only while its run still has it open: a run put away or finished
 * meanwhile has no Glade to go back to.
 */
export function wardrobeBackTo(from: WardrobeFrom, glade: string | null): string | null {
  if (from === null) return null;
  if (from.glade && from.mapId !== glade) return null;
  return from.mapId;
}
