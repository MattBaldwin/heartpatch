import { GAME_DATA, MAP_MAX_PLAYERS, type MapSummary, type PatchType } from '@heartpatch/shared';

// Cozy Patch or Wild Isle (#621, plan §5): the choice on "Make a patch" and
// the 🌊 chip that marks a Wild Isle in the list and on its card. Copy
// follows docs/STYLE_GUIDE.md.

export const PATCH_TYPE_CHOICES: readonly {
  type: PatchType;
  icon: string;
  label: string;
  hint: string;
  /** The name field's hint while this card is picked. */
  nameHint: string;
}[] = [
  {
    type: 'cozy',
    icon: '🌳',
    label: 'Cozy Patch',
    hint: 'Gentle land, perfect to start.',
    nameHint: 'Something cozy, like "Pumpkin Meadow".',
  },
  {
    type: 'wild-isle',
    icon: '🌊',
    label: 'Wild Isle',
    hint: 'Rivers, storms and the sea. For brave Keepers!',
    nameHint: 'Something splashy, like "Seashell Cove".',
  },
];

/** The chip on a Wild Isle's row and card. */
export const WILD_ISLE_CHIP = '🌊 Wild Isle';

/**
 * Whether the form offers a Wild Isle: the server says this player may make
 * one, and the seats a new patch gets have a Wild layout (6 only for now).
 * The server checks both again; this only keeps a card off that would fail.
 */
export function wildIsleOffered(
  canMakeWildIsle: boolean | undefined,
  seats: number = MAP_MAX_PLAYERS,
): boolean {
  return (
    canMakeWildIsle === true &&
    (GAME_DATA.mapGen.wildIsle?.layouts.some((l) => l.players === seats) ?? false)
  );
}

/** A patch from an older server has no type: it's cozy. */
export const isWildIsle = (map: Pick<MapSummary, 'patchType'>): boolean =>
  map.patchType === 'wild-isle';
