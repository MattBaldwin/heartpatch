// How the Wild Isle weather looks (#621 W1-9): sizes, colours and see-through
// amounts for the clouds, rain and fog, tuned on an iPhone-sized still frame
// so rain, a storm and fog each read at a glance. Counts live in
// weather-layout.ts (`WEATHER_CAPS`, `PER_FRONT`).

/** sRGB red, green, blue and alpha, 0 to 1. */
export type Rgba = readonly [number, number, number, number];

export const WEATHER_LOOK = {
  clouds: {
    /** World height of a cloud's middle over the tiles. // TUNE: */
    height: 2.1,
    /** A puff is flattened to this share of its width: a cushion, not a ball. // TUNE: */
    squash: 0.6,
    /** Size of a puff, before the front grows in: base plus up to `spread`. // TUNE: */
    size: 0.62,
    spread: 0.35,
    /** Soft white for rain; slate grey (not purple) for a storm, solid so its puffs fuse. // TUNE: */
    colour: {
      rain: [0.92, 0.94, 0.98, 0.7],
      storm: [0.86, 0.9, 0.96, 1],
    } satisfies Record<'rain' | 'storm', Rgba>,
    /** A cloud's flat bottom, as a share of a unit puff's height below its middle. // TUNE: */
    floor: -0.12,
    /**
     * Light on the cloud, from its own shape (cloud-plugin.ts): how dim the
     * flat belly is, how bright the top, and the warm rim light on the sunny
     * side. // TUNE:
     */
    shade: { belly: 0.7, top: 1.12, rim: [0.95, 0.62, 0.28] as const, rimStrength: 1.5 },
    /** The sun's side, for the rim. // TUNE: */
    sun: [0.75, 0.55, 0.35] as const,
    /** A storm's lower deck: every other cloud sits this much lower, bigger and darker. // TUNE: */
    deck: { drop: 0.38, grow: 1.25, dark: 0.82 },
    /** The soft shadow a cloud casts on the tiles: its colour, height, and its alpha by kind. // TUNE: */
    shadow: {
      colour: '#1b2433',
      height: 0.75,
      size: 1.05,
      alpha: { rain: 0.12, storm: 0.5 },
      rings: [
        [0.5, 1],
        [0.85, 0.5],
        [1, 0],
      ] as readonly [number, number][],
    },
  },
  /** The low tier draws fewer, solid clouds, and a lighter storm rain; no plain rain. // TUNE: */
  lowTier: { share: 0.5, alpha: 1, stormRain: 0.45 },
  /** A storm's rain is heavier and falls at a slant. // TUNE: */
  storm: {
    /** Streak size against plain rain, and how far across it drifts per unit it falls. */
    thick: 1.15,
    long: 1.35,
    slant: 0.45,
    /** Lightning: bolts per radius-3 storm front, size, colour, and how many hold still when motion is off. */
    bolts: { per: 3, height: 1.25, width: 0.2, colour: '#fffbe0', alpha: 0.95, hold: 2 },
  },
  rain: {
    /** One streak: a thin cylinder, `height` long. // TUNE: */
    height: 0.62,
    diameter: 0.06,
    /** A cool blue that shows over pale grass and over dark woods. // TUNE: */
    colour: '#5f86dc',
    alpha: 0.9,
    /** How far a streak falls in one cycle (world units). // TUNE: */
    fall: 1.9,
  },
  fog: {
    /** Low over the tiles, in big soft banks. // TUNE: */
    height: 0.85,
    size: 1.5,
    spread: 0.9,
    colour: '#fbfaff',
    /** The bank's rings: radius and alpha, from the middle out. // TUNE: */
    rings: [
      [0.35, 0.36],
      [0.7, 0.2],
      [1, 0],
    ] as readonly [number, number][],
  },
} as const;
