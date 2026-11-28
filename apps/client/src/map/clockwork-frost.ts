import type { PatchType } from '@heartpatch/shared';

// A Clockwork Isle's frost (#874 C4, plan R1.1, mockup M1): the frosty
// Christmas headline as client dressing only. One uniform, read by the
// terrain plugin on the map's tile and prop materials: a cool tint over
// their colour and a pale frost rim where a surface turns away from the
// eye. Buildings, wires and bulbs keep their own materials, so warm brass
// and window glow stand out against it. No mesh and no draw call (CLAUDE.md
// rule 8); Cozy and Wild Isle maps don't carry it at all. Christmas snow
// still falls through `season=christmas` (map-dressing.ts); this adds none.
// The season-neutral look of Wave 2 drops it by data, not code.

/** The look (sRGB 0–1). TUNE: all of it. */
export const FROST_LOOK = {
  /** The cool tint, mixed into the albedo by `tint`. */
  color: [0.84, 0.92, 1] as const,
  tint: 0.2,
  /** The frost rim: its colour, strength, and how tight to the silhouette (a higher power is thinner). */
  rim: [0.93, 0.97, 1] as const,
  rimStrength: 0.32,
  rimPower: 3,
} as const;

/** sRGB (0–1) to linear, as Babylon's `toLinearSpace` does. */
function toLinear(rgb: readonly [number, number, number]): [number, number, number] {
  return [rgb[0] ** 2.2, rgb[1] ** 2.2, rgb[2] ** 2.2];
}

/**
 * The frost's uniform: one per map scene, shared by every frosty material
 * and changed in place, so a change compiles nothing. `amount` 0 turns it
 * off without a recompile.
 */
export class ClockworkFrost {
  amount = 1;
  /** Linear RGB for the shader (the look is sRGB, like the snow caps' `toLinearSpace`). */
  readonly color: readonly [number, number, number] = toLinear(FROST_LOOK.color);
  readonly tint: number = FROST_LOOK.tint;
  readonly rim: readonly [number, number, number] = toLinear(FROST_LOOK.rim);
  readonly rimStrength: number = FROST_LOOK.rimStrength;
  readonly rimPower: number = FROST_LOOK.rimPower;
}

/** The frost a map of this type wears: a Clockwork Isle's, or none (Cozy, Wild, an older server). */
export function clockworkFrost(patchType: PatchType | undefined): ClockworkFrost | null {
  return patchType === 'clockwork-isle' ? new ClockworkFrost() : null;
}

/** The four floats the shader reads as `terrainFrost`: tint, rim strength, rim power, on/off. */
export function frostUniform(frost: ClockworkFrost): [number, number, number, number] {
  return [
    frost.tint * frost.amount,
    frost.rimStrength * frost.amount,
    frost.rimPower,
    frost.amount,
  ];
}
