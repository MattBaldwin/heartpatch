/**
 * Procedural building tunables (design doc §13, §19: soft vinyl toys). A
 * model is about 1 world unit across at scale 1 and stands on y = 0; scenes
 * scale it to their tiles. Colours are sRGB hex. All first guesses to judge
 * on the playtest devices.
 */
export const BUILDING_COLORS = {
  stone: '#d9cfe0', // TUNE: lavender-grey fire stones
  stoneDark: '#b9adc4', // TUNE
  log: '#b07a55', // TUNE
  logEnd: '#e8c39a', // TUNE
  flame: '#ff9b3d', // TUNE
  flameCore: '#ffe27a', // TUNE
  flameTip: '#ff6a2b', // TUNE: the flame's top (a gradient from the white-gold heart)
  flameHeart: '#fff6c8', // TUNE: hot enough to bloom
  fireWarm: '#ffbf7a', // TUNE: firelight on the stones' inner faces
  ash: '#9a8f99', // TUNE: a fire that's out
  pumpkin: '#ff9a3c', // TUNE
  pumpkinDark: '#e57a22', // TUNE
  stem: '#6aa84f', // TUNE
  face: '#ffd65c', // TUNE: a lit Jack-o'-Lantern's grin
  faceOut: '#5a3a2a', // TUNE
  den: '#ff8a6b', // TUNE: Ember Den dome
  denTrim: '#ffd1a6', // TUNE
  door: '#7a3b3b', // TUNE
  grass: '#9ed98a', // TUNE: Cozy Meadow
  fence: '#f3dcb0', // TUNE
  petal: '#ffb3d1', // TUNE
  petalAlt: '#fff0a8', // TUNE
  plain: '#e8dcf0', // TUNE: anything without its own model yet
  lantern: '#fff1b8', // TUNE: a level-3 Hearthfire's lantern posts (glow)
  window: '#ffd27a', // TUNE: a level-2 Ember Den's lit window (glow)
  mat: '#9fe3c8', // TUNE: Training Grounds practice mat
  matTrim: '#fdfbf4', // TUNE
  target: '#ff7aa8', // TUNE: the bouncy practice target
  targetRing: '#fff3b0', // TUNE
  post: '#c9a27e', // TUNE
  flag: '#7ab8ff', // TUNE: a level-2 Training Grounds' pennant
  workshop: '#f8cfa4', // TUNE: Crafting Factory walls (#294), a soft peach
  workshopRoof: '#e8709f', // TUNE: its rosy roof
  chimney: '#c98aa8', // TUNE
  puff: '#fff6fb', // TUNE: the chimney's little puffs
  porthole: '#cdeefa', // TUNE: round windows
  gear: '#7aa9c7', // TUNE: the gear in the big window, and the belt
  crate: '#ff8fb8', // TUNE: a little heart crate riding the belt
  // The Joy Lantern (#306 PR 5): a little lantern house with a heart flame.
  joyBase: '#e9d6c4', // TUNE: its soft stone step
  joyFrame: '#a8716f', // TUNE: the posts
  joyRoof: '#e8709f', // TUNE: the rosy roof, like the Factory's
  joyFlame: '#ff7aa8', // TUNE: the heart flame, pink
  joyCore: '#ffe1ec', // TUNE: its hot heart, bright enough to bloom
  joyOut: '#9a8f99', // TUNE: a lantern that's out (the fire's ash)
} as const;

/**
 * How much bigger each building level stands (owner decision 2026-10-06:
 * every upgrade visibly changes the building). Index 0 is level 1. The
 * footprint grows a little (spots sit about 1.35 units apart in the home
 * view); most of the growth is height and detail.
 */
export const LEVEL_SCALE = [
  { across: 1, up: 1 },
  { across: 1.08, up: 1.3 },
  { across: 1.15, up: 1.6 },
] as const; // TUNE

/** How strongly glowing parts (flames, a lit grin) shine. */
export const GLOW = 1.1; // TUNE

/**
 * The soft pool of firelight on the ground under a lit fire (owner decision
 * 2026-10-06: light falls on the stones and the ground). Radius in model
 * units (a level-1 fire is ~1 across), sRGB, and its alpha at the middle.
 */
export const FIRE_POOL = { radius: 1.1, color: '#ff8a3a', alpha: 0.38 } as const; // TUNE
