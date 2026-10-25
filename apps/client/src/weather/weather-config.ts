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
    size: 0.75,
    spread: 0.45,
    /** Soft grey-white for rain; a heavy slate for a storm. // TUNE: */
    colour: {
      rain: [0.9, 0.92, 0.97, 0.78],
      storm: [0.66, 0.67, 0.73, 0.86],
    } satisfies Record<'rain' | 'storm', Rgba>,
  },
  rain: {
    /** One streak: a thin cylinder, `height` long. // TUNE: */
    height: 0.42,
    diameter: 0.035,
    /** A cool blue that shows over pale grass and over dark woods. // TUNE: */
    colour: '#5d7fd6',
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
