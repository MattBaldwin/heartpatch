import {
  keyInReach,
  type CommunityView,
  type Hex,
  type MapView,
  type PublicTile,
} from '@heartpatch/shared';

// The key hunt and the hidden cellar (#306 PR 2c, the plan's screens; copy
// follows docs/STYLE_GUIDE.md: short, warm, a little spooky, never scary).
// Pure, so every case is unit-tested. Where the key hides reaches the client
// only for the village's own winner, while they hunt for it
// (`CommunityView.cellar.keyTile`, rule 6).

export const KEY_TEXT = {
  // The map card, once a village is won.
  mapKicker: (name: string) => `${name.toUpperCase()} · A SECRET`,
  mapTitle: 'A map to the key! 🗺️',
  mapLine:
    'The village squishies hid the cellar key from the Hollow Man. The map shows the tile where they tucked it away.',
  showMe: 'Show me on the map',
  later: 'Later',
  // The key's tile.
  flag: '🗺️ The cellar key is hidden here',
  here: (name: string) => `🗺️ ${name}'s cellar key is hidden here!`,
  dig: 'Dig for the key 🔑',
  digging: 'Digging… 🔑',
  away: 'Claim land next to it to dig for the key!',
  found: (name: string) => `You found the cellar key! 🔑 Open the cellar on ${name}'s square.`,
  // The square.
  hunt: '🗺️ The cellar key is out there somewhere…',
  hasKey: '🔑 You have the key! The cellar door is right here.',
  open: 'Open the cellar 🔑',
  opening: 'Unlocking… 🔑',
  goDown: 'Go down to the cellar 🕯️',
  cellarLine: 'Better finds down here… 🎁',
  // Inside: the explore header.
  title: (name: string) => `${name}'s cellar 🕯️`,
} as const;

/** What the key hunt shows on one tile's panel, or null for none. */
export type KeyHuntBlock =
  /** The key's tile: dig here, once my land reaches it. */
  | { readonly kind: 'key'; readonly community: CommunityView; readonly inReach: boolean }
  /** My won village's square: the map, the locked door, or the way down. */
  | {
      readonly kind: 'square';
      readonly community: CommunityView;
      readonly state: 'hunt' | 'key' | 'open';
    };

/** My won villages whose cellar I'm on the way to. */
function hunting(view: MapView, me: string | null): CommunityView[] {
  if (me === null) return [];
  return (view.communities ?? []).filter((c) => c.ownerUserId === me && c.cellar !== undefined);
}

const same = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;

/**
 * The key hunt's block on `tile`'s panel: the key's tile while I hunt for it
 * (a village's key never sits on another's square), else my won village's square.
 */
export function keyHuntOn(view: MapView, tile: PublicTile, me: string | null): KeyHuntBlock | null {
  const mine = hunting(view, me);
  for (const c of mine) {
    const key = c.cellar?.state === 'hunt' ? c.cellar.keyTile : undefined;
    if (key && same(key, tile)) {
      return { kind: 'key', community: c, inReach: keyInReach(key, view.tiles, me as string) };
    }
  }
  const square = mine.find((c) => same(c.square, tile));
  return square?.cellar ? { kind: 'square', community: square, state: square.cellar.state } : null;
}

/** Flags over the keys I hunt for: one per village, at its key's tile. */
export function keyFlags(
  view: MapView,
  me: string | null,
): { id: string; community: CommunityView; tile: Hex }[] {
  return hunting(view, me).flatMap((c) =>
    c.cellar?.state === 'hunt' && c.cellar.keyTile
      ? [{ id: `key:${c.id}`, community: c, tile: c.cellar.keyTile }]
      : [],
  );
}

/**
 * Villages that showed me a key map for the first time in `after`: won by
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
