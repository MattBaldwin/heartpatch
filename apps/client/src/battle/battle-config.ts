/**
 * Battle scene and HUD tunables (design doc §6, §19, §20; owner decision
 * 2026-10-05: Lantern Hour's stage, Saturday Morning Smackdown's hits, the
 * Storybook Diorama's HUD). First guesses, to be judged on the playtest
 * devices.
 */

/** Where the two fighters stand on the stage (world units; −z is towards the camera). */
export const HOMES = {
  /** The player's squishy: near left. */
  mine: { x: -2.15, z: -1.2 }, // TUNE
  /** The other side: further away, right. */
  theirs: { x: 2.15, z: 1.9 }, // TUNE
} as const;

/**
 * A team battle (#190, a mini-boss; owner-approved arena layout A): the
 * player's squishies in a row on the near side, left to right in slot order,
 * and the big boss alone on the far side, about 1.8× their size (plan §10).
 */
export const TEAM_ARENA = {
  /** Where each of the player's squishies stands, for teams of 1, 2 and 3 (slot order). */
  posts: {
    1: [{ x: 0.4, z: -2.6 }],
    2: [
      { x: -1.45, z: -3.06 },
      { x: 2.25, z: -2.14 },
    ],
    3: [
      { x: -4.3, z: -3.77 },
      { x: 0.4, z: -2.6 },
      { x: 5.1, z: -1.43 },
    ],
  } as Readonly<Record<1 | 2 | 3, readonly { x: number; z: number }[]>>, // TUNE: a close-up squishy is ~2.5 wide, so 4.8 apart (gaps the boss shows through), across the camera's view (yaw −14°), near the camera
  /** The boss: far back and centred on screen. */
  boss: { x: -1.0, z: 9.5 }, // TUNE: far enough back that its feet stand above the row on screen
  /** Where the Keeper stands: this far left of, and behind, the row's left end. */
  keeperBeside: { x: 2.2, z: 1.2 }, // TUNE
  /** The boss's size against a usual fighter's (plan §10: "about 1.8×"). */
  bossScale: 2.2, // TUNE: drawn bigger than 1.8× because it stands further back; reads as ~1.8× on screen
} as const;

export const FIGHTER = {
  /** Extra scale on the squishies (a close-up, like the gallery's). */
  scale: 2.7, // TUNE
  /**
   * Big squishies are drawn a little smaller in battle (#652), so the camera
   * never backs off to fit them: above `knee` (battle units, hat included)
   * only `keep` of the extra height stays, and nobody stands taller than
   * `maxHeight`. Most species (about 5 or less) are drawn as they are.
   */
  tall: { knee: 5, keep: 0.25, maxHeight: 5.6 }, // TUNE
  /**
   * Three-quarter facing: each face turns between "at the other fighter" (1)
   * and "at the camera" (0), so both faces always show.
   */
  facing: { mine: 0.5, theirs: 0.62 }, // TUNE
  /** The player's Keeper stands at their squishy's back, nearly upright under the low camera. */
  keeper: { offset: { x: 1.25, z: 3.4 }, yaw: -0.25, leanShare: 0.3 }, // TUNE
  /**
   * A fence segment standing in for a squishy (#203): the map's fence look,
   * built `length` long and scaled up to about a squishy's height.
   */
  fence: { length: 0.6, scale: 7 }, // TUNE
} as const;

/** Timings for playing the server's resolved log back, ms. */
export const PLAYBACK = {
  /** A move name shows this long before its result lands. */
  moveMs: 650, // TUNE
  /** A hit: squash, energy bar drop, callout. */
  hitMs: 800, // TUNE
  missMs: 700, // TUNE
  /** Heals, stat changes and statuses: a bounce or wobble plus a line. */
  effectMs: 700, // TUNE
  /** Flopping over when tuckered out. */
  tuckeredMs: 1100, // TUNE
  swapMs: 700, // TUNE
  /** Offering a Heart Charm: a hopeful pause, then a bounce or a wiggle. */
  captureMs: 1300, // TUNE
  /** A potion (#214): a cosy sip, a happy wiggle, and the sparkle shield. */
  itemMs: 1000, // TUNE
  /** A raid replay (#16) rests on its first turn this long before it plays. */
  replayLeadMs: 900, // TUNE
  /** Breather before the result screen. */
  endMs: 900, // TUNE
} as const;

/**
 * Render-on-demand pacing (tech spec §6): while only breathing animates, a
 * frame is asked for at most this often; while a move plays, every frame.
 * Asks land on display ticks, so this is a 30 fps interval less half a
 * 120 Hz tick: every 2nd tick at 60 Hz and every 4th at 120 Hz, both 30 fps,
 * with margin for timer jitter. A full 33.3 ms would round to every 3rd
 * tick (20 fps) at 60 Hz; exactly 25 ms sits on the 120 Hz boundary.
 */
export const BREATHING_FRAME_MS = 29; // TUNE: 30 fps is plenty for a slow breath

/**
 * From this page width (an iPad, never an upright phone) a boss fight's HUD
 * treats the screen as wide: the friends stand well apart, so the result
 * card leaves them more room (`battle-hud.ts`). The sheet itself only turns into a card
 * later, at `BATTLE_CAMERA.narrowSheetFrom` (900 px).
 */
export const WIDE_MIN = 600; // TUNE:

/** A submit that never reached the server is sent once more, with the same key, after this long. */
export const RETRY_AFTER_MS = 1200; // TUNE: a phone's radio often comes back within a second

/**
 * Saturday Morning Smackdown's hits (owner decision 2026-10-05): fractions are
 * of the step's length (`PLAYBACK`), distances in world units, angles in
 * radians.
 */
export const CHOREO = {
  /** Squash and stretch exaggeration (1 is the map's gentle squish). */
  exaggeration: 1.5, // TUNE: B's 1.6 trimmed a little for readability
  dash: {
    /** Anticipation (pull back and squat) before the dash, fraction of the move step. */
    windup: 0.36, // TUNE
    /** The dash itself, fraction of the move step; the rest is the brace at arm's length. */
    travel: 0.26, // TUNE
  },
  /**
   * Hit-stop, ms (longer for a super hit): when a hit lands, both fighters
   * hold their contact pose this long before the knockback.
   */
  hitStop: 120, // TUNE
  knockback: { distance: 1.2 }, // TUNE
  dodge: { side: 0.9 }, // TUNE
  /** How far a tuckered-out squishy flops over and sinks. */
  faint: { roll: 1.35, sink: 0.1 }, // TUNE
  swap: { out: 0.45 }, // TUNE: fraction of the swap step spent hopping out
  swapIn: { height: 3 }, // TUNE: drops from this high
  /** The Heart Charm: when it lands, when the wobble ends, when the result shows (fractions). */
  charm: { throwAt: 0.3, wobbleAt: 0.42, resultAt: 0.78, shrink: 0.2, lift: 0.9 }, // TUNE
  /** Hit strength per effectiveness tier (`BATTLE_RULES.effectiveness`). */
  strength: { super: 1.45, good: 1.2, normal: 1, weak: 0.65 } as Readonly<Record<string, number>>, // TUNE
  /** Standing ready: lean in a touch, a light bob on the toes. */
  ready: { lean: 0.06, bob: 0.045, bobHz: 1.3, otherPhase: 0.37 }, // TUNE: otherPhase keeps the two out of step
  /** A fighter left at arm's length (a dash that didn't land) hops home this fast, ms. */
  returnMs: 320, // TUNE
  /** Reduced motion: moves this size (dashes become a short lunge), no twirls, shake, flash or hit-stop. */
  reduced: { size: 0.45, reach: 0.35 }, // TUNE
} as const;

/** The battle camera's tunables (`BATTLE_CAMERA`, where each one is described). */
export interface BattleCameraConfig {
  pitch: number;
  yaw: number;
  fov: number;
  minZ: number;
  maxZ: number;
  aim: { readonly x: number; readonly y: number; readonly z: number };
  feetY: number;
  fitHalfWidth: number;
  fitHeight: number;
  rimMargin: number;
  minDistance: number;
  maxDistance: number;
  maxFitDistance: number;
  fogReference: number;
  faceMargin: number;
  faceFacingMin: number;
  narrowSheetFrom: number;
  feetRoom: number;
  fitFrom: number;
  hitPush: number;
  followPush: number;
  koPush: number;
  shake: number;
  roll: number;
  focusShift: number;
  follow: number;
  shakeHz: number;
  shakeDecay: number;
  beatDecay: number;
}

/** The boss camera's beats (#190 PR 2): fractions of distance, world units, radians. */
export interface BossCameraBeats {
  readonly windupPush: number;
  readonly windupRoll: number;
  readonly landingPush: number;
  readonly landingShake: number;
  readonly koRelax: number;
}

/**
 * The boss fight's camera (#190 PR 2, owner answer 3: one continuous low
 * camera with push-ins and a thump, no cuts), `BATTLE_CAMERA.boss`: laid
 * over the rest by `cameraFor` (camera-director.ts), only when a boss is in
 * the fight. On a portrait phone the three friends' row sets the distance (it must fit
 * across), so the low angle doesn't shrink anyone: the camera comes down to
 * about the boss's chest height and the fight sits low in the tall band, the
 * team's feet just over the handle and the boss towering behind them.
 */
const BOSS_PROFILE = {
  /** Nearly level: a low hero shot looking up at the boss (the team fight was 21°). */
  pitch: (4 * Math.PI) / 180, // TUNE
  /**
   * Where it looks: about a 1.8× boss's chest high, over the middle of the
   * row across the view (the yaw), so both end friends get the same margin
   * at the screen's edges (M0: the left one was clipped).
   */
  aim: { x: -0.33, y: 4, z: 0.33 }, // TUNE
  /** The aim (the boss's chest) on screen: low in the tall band. */
  feetY: 0.62, // TUNE: the team's feet a little over 0.11 above a notched iPhone's handle (was 0.28)
  /** Room under the aim on a short band (the picker risen): the team's eyes stay above the sheet. */
  feetRoom: 0.12, // TUNE: 0.2 sent a tall team's camera to the 70 cap with the picker up
  /** Heights count from the aim (the boss's chest, `aim.y`), not the ground: the camera looks from there. */
  fitFrom: 4, // TUNE: = aim.y
  /** A 1.8× boss's box (the 1-v-1's 3.6 × 1.8); the row's width binds first on a phone. */
  fitHeight: 6.5, // TUNE
  /** The picker's lean towards the friend picking (the team fight's is 0.35). */
  focusShift: 0.15, // TUNE: the picker's lean kept every end friend on screen (0.35 clipped up to 17%)
  beats: {
    /** A windup: a slow push-in across the step, with a little lean. */
    windupPush: 0.18, // TUNE
    windupRoll: (1 * Math.PI) / 180, // TUNE
    /** The windup's move landing: twice the hit push (`hitPush`), and a thump. */
    landingPush: 0.2, // TUNE
    landingShake: 0.2, // TUNE
    /** The boss tuckered out: `koPush`, then a slow pull-back (per second, `beatDecay` is 2.4). */
    koRelax: 0.8, // TUNE
  } satisfies BossCameraBeats,
} as const;

/** The battle camera, with the boss fight's profile on it. */
type BattleCamera = Readonly<BattleCameraConfig> & { readonly boss: typeof BOSS_PROFILE };

/**
 * Lantern Hour's camera (owner decision 2026-10-05): low, swung a little to
 * the player's side, framing the fight into the safe region between the
 * HUD's pills and its bottom sheet. Angles in radians, distances in world units.
 */
export const BATTLE_CAMERA: BattleCamera = {
  /** Tilt down from the horizon. */
  pitch: (11 * Math.PI) / 180, // TUNE
  /** Swing around the fight (0 looks along +z). */
  yaw: (-14 * Math.PI) / 180, // TUNE
  fov: 0.74, // TUNE
  minZ: 0.3, // TUNE
  maxZ: 300,
  /** Where it looks: a point at the fighters' feet, between them. */
  aim: { x: 0.35, y: 0.1, z: 0.5 }, // TUNE
  /** Where the aim lands on screen, as a fraction of the height from the top. */
  feetY: 0.56, // TUNE: low enough to use the room above the sheet
  /** The fight's box that must always fit in the safe region: half width and height. */
  fitHalfWidth: 3.9, // TUNE
  fitHeight: 3.6, // TUNE
  /**
   * The arena's reach (#652, `arenaReach`): the lowest row of the stage stays
   * `rimMargin` inside the ground's rim (room for the lean and a shake).
   * `minDistance` and `maxDistance` only bound it (a row that never meets the
   * ground has no reach of its own).
   */
  rimMargin: 2, // TUNE
  minDistance: 10, // TUNE
  maxDistance: 90, // TUNE
  /**
   * The furthest the camera ever sits, even when the fighters ask for more
   * (#234): a big boss in a notched iPhone's thin stage band asked for 160,
   * past the sky dome (`ARENA_STAGE.skyRadius`, 95), which then hid the whole
   * fight, and past both fog ends (85 / 90). The cost: in that band a 7-unit
   * boss's head and most of its body sit under the plate (measured: head at
   * 0.25 of the screen, feet at 0.40, band from 0.38). An empty screen is
   * worse; giving the stage more room is the follow-up.
   */
  maxFitDistance: 70, // TUNE: under the sky dome (the boss stands ~10 past the aim); the result screen's 65 still fits
  /**
   * The usual framing distance the arena fog was tuned at: a shot further
   * back than this pushes the fog back by the difference (`fogFor`), so the
   * ground round the fighters never fades into the haze.
   */
  fogReference: 45, // TUNE
  /**
   * A boss fight frames the boss's face first (#868): its eyes and mouth stay
   * this far (a fraction of the screen height) inside the stage band. When
   * the band is too short for the face and the team at once (a notched
   * iPhone), the picture slides down and the near team tucks its feet under
   * the team cards, whose meters show how each is doing.
   */
  faceMargin: 0.015, // TUNE: about 13 CSS px on an iPhone
  /**
   * The boss's face is framed only while it looks this squarely at the camera
   * (#868: 1 straight on, 0 side-on, below 0 away). Turned further away (a
   * taunt's twirl), the slide holds its last target instead of chasing the
   * back of its head.
   */
  faceFacingMin: 0.3, // TUNE
  /** From this window width (CSS px) the sheet is a centred card (battle.css), so the screen's bottom shows. */
  narrowSheetFrom: 900,
  /** The aim lands at least this far (a fraction of the screen height) above the band's bottom. */
  feetRoom: 0.08, // TUNE
  /** Fit points' heights count from this height: the ground (the aim's at the fighters' feet). */
  fitFrom: 0,
  /** Camera beats (B): push-in on a hit (fraction of distance), shake (world units), dutch roll (radians). */
  hitPush: 0.1, // TUNE
  followPush: 0.04, // TUNE
  koPush: 0.08, // TUNE
  shake: 0.12, // TUNE: light
  roll: (1.5 * Math.PI) / 180, // TUNE: only on super hits
  /** Leans the framing this far towards the fighter a step is about. */
  focusShift: 0.35, // TUNE
  /** Camera follow smoothing, per second (higher is snappier). */
  follow: 4.5, // TUNE
  /** Shake: wobbles per second and how fast it dies away. */
  shakeHz: 21, // TUNE
  shakeDecay: 9, // TUNE
  /** How fast a push-in and a beat decay back, per second. */
  beatDecay: 2.4, // TUNE
  /** The boss fight's profile (#190 PR 2): only with a boss, see above. */
  boss: BOSS_PROFILE,
};

/**
 * The boss fight's stage band (#868, #190). Since the phone-first boss HUD
 * (#190 PR 1) the band at rest is about 0.73 of a notched iPhone's height, so
 * nothing fades any more; `shortBand` stays as the safety net's yardstick
 * (`shortBand()` in camera-director.ts, pinned by its tests).
 */
export const BOSS_CARDS = {
  /** A stage band shorter than this (a fraction of the screen height) is short. */
  // TUNE: the #868 table: a notched iPhone 15 under the old plate and cards
  // ~0.15; 393x852 with no insets (the WebKit e2e, which can't emulate them)
  // ~0.253; the result band ~0.31; an iPad's ~0.38.
  shortBand: 0.28,
} as const;

/**
 * The phone-first boss HUD (#190 PR 1, owner option 1): a slim strip at the
 * top and a bottom sheet whose collapsed handle holds the team as chips; the
 * sheet rises with the picker on the player's turn. CSS px unless named.
 * battle.css reads these as custom properties (`bossHudVars`), and
 * `bossRestEdges` and `bossBand` work out the band they leave, so they live
 * in one place.
 */
export const BOSS_HUD = {
  /** The top strip's height (one 44 pt row, two lines inside), and its gap under the inset. */
  stripHeight: 44, // TUNE:
  stripTop: 8, // TUNE:
  /** The camera's margin under the strip (the `safe()` pattern). */
  stripMargin: 10, // TUNE:
  /** The collapsed handle's height (the chips' row), and the stage's clearance above it. */
  handleHeight: 64, // TUNE:
  handleClear: 8, // TUNE:
  /**
   * The risen sheet with the picker, a share of the screen height (handle
   * included): the owner's ~34vh on a tall phone, more on a short one so the
   * moves never scroll (the battle sheet's own #656 steps, battle.css).
   */
  sheetVh: 34, // TUNE:
  sheetVhShort: {
    /** At most 840 px tall (an iPhone mini). */
    h840: 42, // TUNE:
    /** At most 700 px tall (an iPhone SE). */
    h700: 48, // TUNE:
    /** At most 600 px tall. */
    h600: 52, // TUNE:
    /** A phone on its side (at most 520 px tall, at least 640 px wide). */
    sideways: 46, // TUNE:
  },
  /** A team chip's disc, and how far the squishy picking now rises out of the handle. */
  chipSize: 56, // TUNE: a 44 pt target with a ring around it
  chipRaise: 8, // TUNE:
  /** The sheet's rise and drop, ms (a snap under reduced motion). */
  riseMs: 220, // TUNE:
  // The strip's row, left to right: the edge, the strip (at most `stripMax`
  // wide, centred), a gap, the ✕ (a 44 pt target, moved up into this row so
  // it never covers the stage), the edge. Inside the strip, two lines: the
  // name and the order dots, then the energy bar and the one chip slot.
  edge: 12, // TUNE:
  closeSize: 44,
  closeGap: 8, // TUNE:
  stripMax: 560, // TUNE:
  stripPad: 12, // TUNE:
  /** The order dots: one per mover (three friends and the boss), lit in turn. */
  dots: 4,
  dotSize: 16, // TUNE:
  dotGap: 3, // TUNE:
  /** The one chip slot (⏳ while the boss winds up, or nothing): an icon, so it always fits. */
  chipSlot: 20, // TUNE:
  innerGap: 6, // TUNE:
  /** The energy bar never gets narrower than this (M0: it shrank to ~40 px at 393). */
  minBar: 120,
  /**
   * A friend's callout: how far its sticker sits above its chip, and its gap
   * over the caption pill when one shows there (the two stack, never cover).
   */
  calloutLift: 10, // TUNE:
  calloutGap: 6, // TUNE:
  /** The callout sticker's tilt, degrees: battle.css's `rotate(-6deg)` (its corners dip below its box). */
  calloutTilt: 6,
} as const;

/**
 * A potion's sparkle shield (#214): a soft lavender bubble over the squishy
 * until the next hit lands. `fit` is its size against the squishy's.
 */
export const SHIELD_BUBBLE = {
  color: [0.82, 0.72, 1] as const, // TUNE
  glow: [0.42, 0.34, 0.62] as const, // TUNE
  alpha: 0.24, // TUNE
  fit: 1.25, // TUNE
};

/**
 * Finding a rare one (#391, owner decisions 2026-10-12: the mockup's reveal
 * beat). Each tier's length, words and size step (`scale`, rare = 1) are
 * shared data (`RARE_FIND_TIERS`); this is how a step looks here. It grows
 * with the step: more sparkles, a deeper dim, a bigger banner with a thicker
 * ring and one more chime note (the `find-*` cues). Index `scale - 1`; a step
 * past the end uses the last. A kind met before shows only the banner, for
 * `briefMs`, with no pause.
 */
export const RARE_REVEAL = {
  sparkles: [6, 12, 16, 20, 24, 28], // TUNE
  dim: [0.14, 0.22, 0.28, 0.32, 0.35, 0.38], // TUNE
  banner: [16, 18, 19, 20, 21, 22], // TUNE
  ring: [2, 3, 4, 5, 6, 6], // TUNE
  briefMs: 1000, // TUNE
  /** The banner's text grows on wide screens (an iPad), as in the mockup. */
  wideScreen: 500,
  wideBanner: 1.25, // TUNE
  /** The banner sits this far above the bottom sheet (CSS px). */
  sheetGap: 12,
  /** Sparkles stay this far above the sheet and below the name pills (CSS px). */
  sparkleClear: { sheet: 70, pills: 10 },
  /** Sparkles land this far out from the squishy's middle, in its half-heights. */
  sparkleReach: [1.2, 1.9] as const, // TUNE
  /** The fade out at the end (ms). */
  fadeMs: 250,
  /** Frames to wait for the arena to draw the squishy before dimming mid-screen instead. */
  waitFrames: 30,
  /** How long after a skipping tap lifts its click is swallowed (ms; it follows at once). */
  clickGraceMs: 350,
} as const;

/** A step's value from one of `RARE_REVEAL`'s lists (the last past the end). */
export function revealStep(list: readonly number[], scale: number): number {
  return list[Math.min(Math.max(scale, 1), list.length) - 1] ?? 0;
}

/**
 * Befriending a rare one (#391): hearts that fall over the new friend, by the
 * tier's size step (index `scale - 1`, the last past the end); fewer, and only
 * fading in, with Reduce Motion. They keep `heartClear` px off the pills, and
 * three times that off the card.
 */
export const BEFRIEND_CHEER = {
  hearts: [8, 12, 16, 20, 24], // TUNE
  calmHearts: 6, // TUNE
  heartClear: 10,
} as const;
