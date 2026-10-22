import {
  GAME_DATA,
  hexKey,
  hexNeighbors,
  isTradingPost,
  keyInReach,
  type CommunityView,
  type Hex,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';

// The key hunt and the hidden cellar (#306 PR 2c, the plan's screens; the
// treasure map, the glow and the explore find, owner decision 2026-10-22).
// Copy follows docs/STYLE_GUIDE.md: short, warm, a little spooky, never
// scary. Pure, so every case is unit-tested. Where the key hides reaches the
// client only for the Hollow's own winner, while they hunt for it
// (`CommunityView.cellar.keyTile`, rule 6).

export const KEY_TEXT = {
  // The treasure map, once a Hollow is won, and again from the bag or the square.
  mapKicker: (name: string) => `${name.toUpperCase()} · A SECRET`,
  mapTitle: 'A treasure map! 🗺️',
  mapLine: 'The squishies hid the cellar key from the Hollow Man. Find the ✕!',
  mapHow: 'Make that land yours, then explore it. Look for a glint! ✨',
  mapLabel: (name: string) => `An old map of your patch. An ✕ marks where ${name}'s key hides.`,
  showMe: 'Show me on the map',
  later: 'Later',
  close: 'Close',
  // The bag's way back to it while the hunt is on.
  bagTile: 'Treasure map',
  bagLine: (name: string) => `${name}'s cellar key`,
  // The key's tile (its panel; the map itself only glows).
  glintMine: '✨ Something glints here… Explore to look!',
  glintWild: '✨ Something glints here… Claim this land to look!',
  glintTheirs: '✨ Something glints here… Challenge this land to look!',
  // A patch with no challenges, and no wild land near enough for the key to move to.
  glintNext: '✨ Something glints here… Explore your land next to it!',
  glintNear: '✨ Something glints here… Claim land next to it to look!',
  glintTaken: 'Something glints here… the land around it is all taken for now. 🌙',
  // In explore: the glinting spot, and finding the key there.
  dig: 'Dig it up',
  foundTitle: 'You found the cellar key!',
  foundLine: (name: string) => `Open the cellar on ${name}'s square.`,
  // The square.
  hunt: '🗺️ The cellar key is out there somewhere…',
  openMap: 'Treasure map 🗺️',
  hasKey: '🔑 You have the key! The cellar door is right here.',
  open: 'Open the cellar 🔑',
  opening: 'Unlocking… 🔑',
  goDown: 'Go down to the cellar 🕯️',
  cellarLine: 'Better finds down here… 🎁',
  // Inside: the explore header.
  title: (name: string) => `${name}'s cellar 🕯️`,
} as const;

/**
 * Whose land the key's tile is, as its panel says it. On a patch with no
 * challenges a key stays on someone else's land only with no wild land near
 * enough to move to: then my land next to it finds it (`next`), else I claim
 * some (`near`), or, with nothing next to it left to claim, it waits (`taken`).
 * Display only: the server enforces the rule.
 */
export type KeyLand = 'mine' | 'wild' | 'theirs' | 'next' | 'near' | 'taken';

/** What the key hunt shows on one tile's panel, or null for none. */
export type KeyHuntBlock =
  /** The key's tile: explore it once it's mine (owner decision 2026-10-22). */
  | { readonly kind: 'key'; readonly community: CommunityView; readonly land: KeyLand }
  /** My won Hollow's square: the treasure map, the locked door, or the way down. */
  | {
      readonly kind: 'square';
      readonly community: CommunityView;
      readonly state: 'hunt' | 'key' | 'open';
    };

/** My won Hollows whose cellar I'm on the way to. */
function hunting(view: MapView, me: string | null): CommunityView[] {
  if (me === null) return [];
  return (view.communities ?? []).filter((c) => c.ownerUserId === me && c.cellar !== undefined);
}

const same = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;

/**
 * The key hunt's block on `tile`'s panel: the key's tile while I hunt for it
 * (a Hollow's key never sits on another's square), else my won Hollow's square.
 */
export function keyHuntOn(view: MapView, tile: PublicTile, me: string | null): KeyHuntBlock | null {
  if (me === null) return null;
  const mine = hunting(view, me);
  for (const c of mine) {
    const key = c.cellar?.state === 'hunt' ? c.cellar.keyTile : undefined;
    if (key && same(key, tile)) {
      const pvpOff = view.map.pvpMode === 'off';
      const land: KeyLand =
        tile.ownerUserId === me
          ? 'mine'
          : tile.ownerUserId === null
            ? 'wild'
            : !pvpOff
              ? 'theirs'
              : keyInReach(key, view.tiles, me, 'off')
                ? 'next'
                : claimableNextTo(key, view.tiles)
                  ? 'near'
                  : 'taken';
      return { kind: 'key', community: c, land };
    }
  }
  const square = mine.find((c) => same(c.square, tile));
  return square?.cellar ? { kind: 'square', community: square, state: square.cellar.state } : null;
}

/** Is any tile next to `at` wild land someone could still claim? */
function claimableNextTo(at: Hex, tiles: readonly PublicTile[]): boolean {
  const next = new Set(hexNeighbors(at).map(hexKey));
  return tiles.some(
    (t) =>
      next.has(hexKey(t)) &&
      t.ownerUserId === null &&
      t.homeSlot === null &&
      // A grey village's tiles are restored, not claimed.
      (t.communityId ?? null) === null &&
      !isTradingPost(t) &&
      t.terrain !== GAME_DATA.mapGen.gapTerrain,
  );
}

/** The panel's line on the key's tile: what to do next to find it. */
export function glintLine(land: KeyLand): string {
  return {
    mine: KEY_TEXT.glintMine,
    wild: KEY_TEXT.glintWild,
    theirs: KEY_TEXT.glintTheirs,
    next: KEY_TEXT.glintNext,
    near: KEY_TEXT.glintNear,
    taken: KEY_TEXT.glintTaken,
  }[land];
}

/** My treasure maps: one for each won Hollow whose key I'm still hunting for, and where it hides. */
export function keyMaps(
  view: MapView,
  me: string | null,
): { community: CommunityView; keyTile: Hex }[] {
  return hunting(view, me).flatMap((c) =>
    c.cellar?.state === 'hunt' && c.cellar.keyTile
      ? [{ community: c, keyTile: c.cellar.keyTile }]
      : [],
  );
}

/**
 * The bag's treasure maps: one tile per hunt on, each saying whose cellar key
 * it leads to. A Hollow named after its win changes its line.
 */
export function bagMaps(view: MapView, me: string | null): { id: string; line: string }[] {
  return keyMaps(view, me).map(({ community }) => ({
    id: community.id,
    line: KEY_TEXT.bagLine(community.name),
  }));
}

/** The tiles that glow on the world map: each key I'm still hunting for. */
export function keyGlows(view: MapView, me: string | null): Hex[] {
  return keyMaps(view, me).map((m) => m.keyTile);
}

/**
 * Hollows that showed me a treasure map for the first time in `after`: won by
 * me and hunting now, but not hunting (or not mine) in `before`. Null
 * `before` (a first look at the map) shows none, so a reload never pops it.
 */
export function newMaps(
  before: readonly CommunityView[] | null,
  after: readonly CommunityView[],
  me: string | null,
): CommunityView[] {
  if (before === null || me === null) return [];
  const was = new Set(
    before.filter((c) => c.ownerUserId === me && c.cellar?.state === 'hunt').map((c) => c.id),
  );
  return after.filter((c) => c.ownerUserId === me && c.cellar?.state === 'hunt' && !was.has(c.id));
}
