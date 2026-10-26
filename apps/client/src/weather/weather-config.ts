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
    /** Every puff is flattened by this on top of its own squash: a cushion, not a ball. // TUNE: */
    squash: 1,
    /** How softly the puffs melt into one another (a smooth union's blend width). // TUNE: */
    blend: 0.1,
    /** A storm's main clouds are this much bigger, so they close up into one heavy mass. // TUNE: */
    stormGrow: 1.35,
    /** Size of a puff, before the front grows in: base plus up to `spread`. // TUNE: */
    size: 0.62,
    spread: 0.35,
    /** Soft white for rain; slate grey (not purple) for a storm, solid so its puffs fuse. // TUNE: */
    colour: {
      rain: [0.92, 0.94, 0.98, 0.7],
      storm: [0.64, 0.68, 0.78, 1],
    } satisfies Record<'rain' | 'storm', Rgba>,
    /** A cloud's flat bottom, as a share of a unit puff's height below its middle. // TUNE: */
    floor: -0.12,
    /**
     * Light on the cloud, from its own shape (cloud-plugin.ts): how dim the
     * flat belly is, how bright the top, and the warm edge light round the
     * tops (strongest on the sunny side, sharper as `rimPower` grows). // TUNE:
     */
    shade: {
      belly: 0.4,
      top: 1.2,
      /** How much the sunny side of each lump is lit over its shady side. */
      key: 0.8,
      rim: [1, 0.66, 0.3] as const,
      rimStrength: 1.4,
      rimPower: 1.8,
    },
    /** What a lightning flash adds to the cloud: most on the belly, a little on top. // TUNE: */
    flash: { colour: [0.85, 0.88, 1] as const, belly: 0.6, top: 0.15 },
    /** The sun's side, for the rim. // TUNE: */
    sun: [0.75, 0.55, 0.35] as const,
    /**
     * A storm's lower deck: extra clouds, `per` a radius-3 front, this much
     * lower, wider, flatter and darker than the main layer. // TUNE:
     */
    deck: { per: 6, drop: 0.55, grow: 1.5, flat: 0.55, dark: 0.6 },
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
  lowTier: { share: 0.5, alpha: 1, stormRain: 0.8 },
  /** A storm's rain is heavier and falls at a slant. // TUNE: */
  storm: {
    /** Streak size against plain rain, and how far across it drifts per unit it falls. */
    thick: 1.15,
    long: 1.35,
    slant: 0.45,
    /**
     * Lightning: bolts per radius-3 storm front, size, how many hold still
     * when motion is off; a white core `width` wide inside a soft `halo`
     * (`haloWidth` across, colour and alpha at its middle), added onto what
     * is behind. // TUNE:
     */
    bolts: {
      per: 3,
      height: 1.6,
      width: 0.09,
      haloWidth: 0.6,
      halo: [0.72, 0.78, 1, 0.6] as const,
      hold: 2,
      /** How far towards the camera from under its deck cloud's middle, as a share of the cloud's size. */
      edge: 0.7,
      /** How far its foot leans towards the camera per unit it falls, so it isn't foreshortened to a stub. */
      lean: 0.8,
    },
    /**
     * A flash lights the scene: the sun and sky light rise by up to this
     * share. `still` is how lit a held bolt (motion off) keeps things. // TUNE:
     */
    flash: { sun: 1.6, sky: 0.55, still: 0.45 },
    /** The high tier's glow round the bolts (a GlowLayer): its size, blur and strength. // TUNE: */
    glow: { ratio: 0.25, blur: 32, intensity: 0.35 },
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
