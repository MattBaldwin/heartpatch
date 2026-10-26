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
  // The Joy Lantern (#306 PR 5): an open lantern with a heart flame.
  joyBase: '#e9d6c4', // TUNE: its soft stone step
  joyFrame: '#a8716f', // TUNE: the posts
  joyRoof: '#e8709f', // TUNE: the rosy ring, like the Factory's roof
  joyFlame: '#ff7aa8', // TUNE: the heart flame, pink
  joyCore: '#ffe1ec', // TUNE: its hot heart, bright enough to bloom
  joyOut: '#9a8f99', // TUNE: a lantern that's out (the fire's ash)
  // Resource buildings (#601 PR 7): soft vinyl toys, one look per land.
  windowOut: '#8f7f9a', // TUNE: a napping building's dark window
  cabin: '#c98e62', // TUNE: the Woodcutter's Hut's log walls
  cabinRoof: '#6fbf8e', // TUNE: its mossy roof
  stump: '#a0704c', // TUNE
  axeHead: '#cfd8e3', // TUNE
  kiln: '#e58a64', // TUNE: the Ember Kiln's terracotta dome
  kilnTrim: '#f6c9a8', // TUNE
  ember: '#ff8a3d', // TUNE: its glowing mouth
  rock: '#c4bccb', // TUNE: the Stone Quarry's boulders
  rockDark: '#a69cb0', // TUNE
  cart: '#7aa9c7', // TUNE: its little cart
  ice: '#cfeefe', // TUNE: the Ice Cutter's blocks
  iceDeep: '#9fd6f5', // TUNE
  iceGlow: '#e9f8ff', // TUNE: its frosty lamp
  wellStone: '#d7cde2', // TUNE: the Water Well's ring
  water: '#7cc8f2', // TUNE
  bucket: '#e8a26a', // TUNE
  glass: '#cfeee4', // TUNE: the Greenhouse's panes
  glassFrame: '#fdfbf4', // TUNE
  leaf: '#7fcf7a', // TUNE
  leafDark: '#5fae64', // TUNE
  bloom: '#ffb3d1', // TUNE
  barn: '#e86f5c', // TUNE: the Pumpkin Barn's walls
  barnRoof: '#8a4d6e', // TUNE
  barnTrim: '#fff3e0', // TUNE
  hay: '#f2d27a', // TUNE
  // The Warehouse (#601 PR 9): a big soft storehouse with crates and parcels.
  store: '#cfdcf5', // TUNE: periwinkle walls
  storeRoof: '#8f9fe0', // TUNE: its deeper roof
  storeDoor: '#f2c48a', // TUNE: the honey roller door
  storeTrim: '#fdfbf4', // TUNE: door slats and the sign
  parcel: '#e8b27a', // TUNE: cardboard parcels
  ribbon: '#ff7aa8', // TUNE: their pink ribbons, and the sign's heart
  crateMint: '#9fe3c8', // TUNE
  // Wild Isle works (#621 W1-10): toys by the water.
  fish: '#ffab6b', // TUNE: a caught fish, peachy orange
  fishAlt: '#8fc7ff', // TUNE: a blue one
  salt: '#e6e0ea', // TUNE: salt heaps, off-white so they don't bloom
  brine: '#bfe9f2', // TUNE: the pans' shallow sea water
  soil: '#a8775a', // TUNE: the field's tilled earth
  wheel: '#d49a6a', // TUNE: the Watermill's wheel
  millWall: '#fde6c8', // TUNE: its creamy walls
  millRoof: '#7fb7c9', // TUNE: its blue-green roof
  hoop: '#8a96a8', // TUNE: the Rain Barrel's hoops, the vane's metal
  barrel: '#c98e62', // TUNE
  bank: '#8fd17e', // TUNE: the Levee's grassy bank
  wall: '#cfc6d9', // TUNE: the Seawall's blocks
  wallDark: '#aea4bd', // TUNE
  shell: '#ffc9d6', // TUNE: a seashell on the wall
  clay: '#d9a07c', // TUNE: the Salt Pans' clay rims
  plank: '#c99a6e', // TUNE: the Levee's plank edge
  stave: '#a8734f', // TUNE: the lines between the Rain Barrel's staves
  seaStone: '#97adc0', // TUNE: the Seawall's grey-blue blocks
  seaStoneLight: '#b6c8d8', // TUNE
  seaStoneDark: '#7b93a9', // TUNE
  riverStone: '#a89c90', // TUNE: the Levee's rounded grey-brown stones
  mortar: '#5f6b7d', // TUNE: the dark lines between them
  foam: '#eef8ff', // TUNE: the Seawall's splash, a soft blue-white
  brass: '#e6b85c', // TUNE: the Rain Barrel's tap
  napZ: '#e4dcff', // TUNE: the lilac "z z" over a napping works
  napDusk: '#6f6a8f', // TUNE: what a napping works' colours dim towards
} as const;

/** TUNE: how far a napping works' colours dim towards `napDusk` (0 none, 1 all). */
export const NAP_DIM = 0.5;

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
  // Level 4 (#601 PR 7): resource buildings go one step further.
  { across: 1.2, up: 1.85 },
] as const; // TUNE

/** How strongly glowing parts (flames, a lit grin) shine. */
export const GLOW = 1.1; // TUNE

/**
 * The soft pool of firelight on the ground under a lit fire (owner decision
 * 2026-10-06: light falls on the stones and the ground). Radius in model
 * units (a level-1 fire is ~1 across), sRGB, and its alpha at the middle.
 */
export const FIRE_POOL = { radius: 1.1, color: '#ff8a3a', alpha: 0.38 } as const; // TUNE
