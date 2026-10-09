import type { TradeRules, TradeValues } from '../schemas/data/trading.js';

/** Trades and gifts at trading posts (#271). Checked by `checkTradeRules` in tests. */
export const TRADE_RULES: TradeRules = {
  offerDays: 3, // TUNE: #30 contract proposal §5
  squishiesPerSide: 3, // TUNE:
  linesPerSide: 6, // TUNE:
  openPerSender: 5, // TUNE:
  openPerPair: 1, // TUNE: one open offer per pair per direction
};

/**
 * What things are worth on the fairness meter (#305; #272's values, pulled
 * forward). Shown as 1–5 hearts, never numbers. Checked by `checkTradeValues`
 * in tests. Guesses until playtests: a level-1 common squishy is about two
 * stacks of everyday goodies.
 */
export const TRADE_VALUES: TradeValues = {
  squishyRarity: {
    common: 40, // TUNE:
    uncommon: 60, // TUNE:
    rare: 100, // TUNE:
    epic: 160, // TUNE:
    legendary: 260, // TUNE:
    mythic: 400, // TUNE:
    secret: 400, // TUNE:
  },
  stage: [1, 1.5, 2.2], // TUNE:
  levelStep: 0.08, // TUNE: level 9 is worth about 1.6× level 1
  mysteryRarity: 'uncommon', // TUNE: a plain middle value
  items: {
    timber: 4, // TUNE:
    stone: 4, // TUNE:
    emberwood: 8, // TUNE:
    glimmer: 12, // TUNE:
    water: 3, // TUNE:
    greens: 4, // TUNE:
    ice: 6, // TUNE:
    heartdust: 15, // TUNE:
    treats: 6, // TUNE:
    pumpkins: 8, // TUNE:
    'witch-dust': 12, // TUNE:
    'magic-fallen-leaves': 10, // TUNE:
    'turkey-feathers': 10, // TUNE:
    presents: 14, // TUNE:
    fireworks: 14, // TUNE:
    'heart-charm': 20, // TUNE:
    'jack-o-lantern-hearthfire': 40, // TUNE:
    'brave-brew': 18, // TUNE:
    'cozy-cocoa': 18, // TUNE:
    'hearty-soup': 18, // TUNE:
  },
  clothingRarity: {
    common: 30, // TUNE:
    uncommon: 50, // TUNE:
    rare: 90, // TUNE:
    epic: 150, // TUNE:
    legendary: 240, // TUNE:
    mythic: 360, // TUNE:
  },
  hearts: [40, 100, 200, 400], // TUNE:
  evenBand: 0.15, // TUNE: design doc §10
  lopsided: 2, // TUNE: #272
};
