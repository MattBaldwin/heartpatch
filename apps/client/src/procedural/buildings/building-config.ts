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
