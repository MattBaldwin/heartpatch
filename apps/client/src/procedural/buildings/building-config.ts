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
} as const;

/** How strongly glowing parts (flames, a lit grin) shine. */
export const GLOW = 1.1; // TUNE
