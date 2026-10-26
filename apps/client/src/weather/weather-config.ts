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
    blend: 0.18,
    /** Size of a puff, before the front grows in: base plus up to `spread`. // TUNE: */
    size: 0.62,
    spread: 0.35,
    /** Soft white for rain; slate grey (not purple) for a storm's bank; solid, so a cloud hides what is behind it. // TUNE: */
    colour: {
      rain: [0.92, 0.94, 0.98, 1],
      storm: [0.62, 0.64, 0.69, 1],
    } satisfies Record<'rain' | 'storm', Rgba>,
    /** A cloud's flat bottom, as a share of a unit puff's height below its middle. // TUNE: */
    floor: 0.02,
    /**
     * Light on the cloud, from its own shape (cloud-plugin.ts): how dim the
     * flat belly is, how bright the top, and the warm edge light round the
     * tops (strongest on the sunny side, sharper as `rimPower` grows). // TUNE:
     */
    shade: {
      belly: 0.4,
      /** A pale (rain) cloud's belly: light grey, so it stays soft white. */
      paleBelly: 0.85,
      top: 1.2,
      /** How much the sunny side of each lump is lit over its shady side. */
      key: 0.8,
      /** Warm gold (#FFC24A), added last as its own light, so the slate and the light can't mute it. */
      rim: [1, 0.761, 0.29] as const,
      rimStrength: 1.1,
      rimPower: 1.6,
    },
    /** What a lightning flash adds to the cloud: most on the belly, a little on top. // TUNE: */
    flash: { colour: [0.85, 0.88, 1] as const, belly: 0.6, top: 0.15 },
    /**
     * My Keeper stays visible under a cloud: where the line from the eye to
     * the Keeper (at `height` over its tile) passes within `radius` of a
     * cloud, the cloud thins to `alpha`, fading back over the outer
     * `soft` share of the radius. // TUNE:
     */
    clearing: { height: 0.4, radius: 0.55, soft: 0.45, alpha: 0.3 },
    /** The sun's side, for the rim. // TUNE: */
    sun: [0.75, 0.55, 0.35] as const,
    /**
     * A storm's bank (weather-clouds.ts `bankShape`): one wide slab per storm
     * front, its many puffs fused along the top (they show only as bumps on
     * its outline) over a hard, flat belly. Sizes are a radius-3 front's, in
     * world units; other radii scale it. // TUNE:
     */
    bank: {
      /** Half-width (east-west) and half-depth (north-south) of the slab. */
      wide: 3.2,
      deep: 1.5,
      /** The slab's own thickness over its flat belly, at the middle, and how round its edges are. */
      thick: 0.45,
      round: 0.35,
      /** How high the belly hangs over the tiles. */
      belly: 1.75,
      /** Puffs heaped along the top: how many, a puff's radius (base plus up to `spread`), and their squash. */
      puffs: 16,
      size: 0.55,
      spread: 0.3,
      squash: 0.75,
      /** Puffs round the rim, bulging past the slab: how many and how big. */
      rim: 11,
      rimSize: 0.72,
      /** How softly the puffs melt into the slab and each other. */
      blend: 0.18,
    },
    /**
     * A storm's lower deck: a flat, see-through, darker slab hanging `drop`
     * under the bank's belly, wider than the bank and pulled `near` its
     * half-depth towards the camera, so it shows under the bank's near
     * edge. // TUNE:
     */
    deck: { drop: 0.35, grow: 1.2, near: 1.15, colour: [0.14, 0.16, 0.22] as const, alpha: 0.8 },
    /** The soft shadow a cloud casts on the tiles: its colour, height, and its alpha by kind. // TUNE: */
    shadow: {
      /** sRGB, like the cloud colours. */
      colour: [0.106, 0.141, 0.2] as const,
      height: 0.75,
      size: 1.05,
      alpha: { rain: 0.12, storm: 0.32 },
      rings: [
        [0.5, 1],
        [0.85, 0.5],
        [1, 0],
      ] as readonly [number, number][],
    },
  },
  /** The low tier draws fewer, solid clouds, and a lighter storm rain; no plain rain. // TUNE: */
  lowTier: { share: 0.5, alpha: 1, stormRain: 0.75 },
  /** A storm's rain is heavier and falls at a slant. // TUNE: */
  storm: {
    /** Streak size against plain rain, and how far across it drifts per unit it falls. */
    thick: 1.2,
    long: 1.6,
    slant: 0.6,
    /**
     * Lightning: bolts per radius-3 storm front, size, how many hold still
     * when motion is off; a white core `width` wide inside a soft `halo`
     * (`haloWidth` across, colour and alpha at its middle), added onto what
     * is behind. // TUNE:
     */
    bolts: {
      per: 3,
      height: 1.6,
      width: 0.11,
      haloWidth: 0.7,
      halo: [0.42, 0.52, 1, 0.6] as const,
      hold: 2,
      /** How far towards the camera from under its deck cloud's middle, as a share of the cloud's size. */
      edge: 0.7,
      /** How far its foot leans towards the camera per unit it falls, so it isn't foreshortened to a stub. */
      lean: 0.8,
      /**
       * Soft glow sprites in the bolt's own mesh (so the low tier, with no
       * GlowLayer, glows too): one round its middle and one where it leaves
       * the belly, lighting the cloud from inside. Radius in bolt lengths,
       * alpha against the halo's.
       */
      sprite: { radius: 0.5, alpha: 0.45, belly: 0.55, bellyAlpha: 0.6 },
    },
    /**
     * A flash lights the scene: the sun and sky light rise by up to this
     * share, and a cool sky-wide (hemispheric) light rises to `hemi`, so the
     * tiles light up on both tiers. `still` is how lit a held bolt (motion
     * off) keeps things. // TUNE:
     */
    flash: { sun: 1.6, sky: 0.55, hemi: 1, hemiColour: [0.78, 0.84, 1] as const, still: 0.2 },
    /**
     * The mood while a storm is over the patch: the sun and the sky light dim
     * to these shares and the cool sky-wide light stays at `hemi`, so the
     * land goes dim and slate. Done in the scene, not as a wash over the
     * canvas, so the clouds' gold edge stays gold. // TUNE:
     */
    mood: { sun: 0.25, sky: 0.3, hemi: 0.1 },
    /** The high tier's glow round the bolts (a GlowLayer): its size, blur and strength. // TUNE: */
    glow: { ratio: 0.5, blur: 16, intensity: 0.25 },
  },
  rain: {
    /** One streak: a thin cylinder, `height` long. // TUNE: */
    height: 0.62,
    diameter: 0.06,
    /** A cool blue that shows over pale grass and over dark woods. // TUNE: */
    colour: '#6c8fd6',
    alpha: 0.75,
    /** How far a streak falls in one cycle (world units). // TUNE: */
    fall: 1.9,
    /** Where a streak starts: this far under a cloud's middle, out of the cloud's body. // TUNE: */
    below: 0.5,
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
