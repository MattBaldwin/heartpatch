import { GAME_DATA, MAP_MAX_PLAYERS, type MapSummary, type PatchType } from '@heartpatch/shared';

// Cozy Patch, Wild Isle (#621, plan §5) or Clockwork Isle (#874): the choice
// on "Make a patch" and the chip that marks an isle in the list and on its
// card. Copy follows docs/STYLE_GUIDE.md.

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
  {
    type: 'clockwork-isle',
    icon: '⚙️',
    label: 'Clockwork Isle',
    // Plan §7 (#874): the card's line.
    hint: 'Wind, wires and workshops. For clever Keepers!',
    nameHint: 'Something clever, like "Tinker Bay".',
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

/** The chip on a Clockwork Isle's row and card (#874). */
export const CLOCKWORK_ISLE_CHIP = '⚙️ Clockwork Isle';

/**
 * Whether the form offers a Clockwork Isle (#874): the server says this
 * player may make one (`HP_CLOCKWORK_ISLE`), and the seats a new patch gets
 * have a Clockwork layout. The server checks both again.
 */
export function clockworkIsleOffered(
  canMakeClockworkIsle: boolean | undefined,
  seats: number = MAP_MAX_PLAYERS,
): boolean {
  return (
    canMakeClockworkIsle === true &&
    (GAME_DATA.mapGen.clockworkIsle?.island.layouts.some((l) => l.players === seats) ?? false)
  );
}

/** Is this patch a Clockwork Isle (#874)? */
export const isClockworkIsle = (map: Pick<MapSummary, 'patchType'>): boolean =>
  map.patchType === 'clockwork-isle';

/** A patch from an older server has no type: it's cozy. */
export const isWildIsle = (map: Pick<MapSummary, 'patchType'>): boolean =>
  map.patchType === 'wild-isle';
