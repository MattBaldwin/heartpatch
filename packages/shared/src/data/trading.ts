import type {
  GlimmerSwapRules,
  SellRules,
  TradeRules,
  TradeValues,
} from '../schemas/data/trading.js';

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
  // TUNE: baby, kid, teen, grown-up (#443). Kids share the teen's step for now, so
  // a line's teens are worth the same whether or not its kid has shipped yet.
  stage: [1, 1.5, 1.5, 2.2],
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
    fish: 5, // TUNE: Wild Isle (#621 W1-8)
    flour: 6, // TUNE: two Greens and a mill's work
    salt: 5, // TUNE:
    pies: 8, // TUNE: a third of 2 Flour, 1 Fish and 1 Salt, plus the baking
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
    // Rekindled (#306 PR 5): made from finds only Hollowed villages give.
    'joy-lantern': 45, // TUNE: a bit above the Jack-o'-Lantern
    'heart-tea': 20, // TUNE: a Heart Snack's Heartdust and change
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

/**
 * The trading post's Glimmer swap (#523; owner decision 2026-10-18). Checked
 * by `checkGlimmerSwapRules` in tests. About 10 everyday resources for 1
 * Glimmer, and about 3 a day, so the swap never replaces exploring.
 */
export const GLIMMER_SWAP: GlimmerSwapRules = {
  accepts: ['timber', 'stone', 'greens', 'water', 'ice'], // TUNE: #523
  give: 10, // TUNE: #523
  get: 1, // TUNE: #523
  dailyCap: 3, // TUNE: #523, Glimmer a day
};

/**
 * Selling extras to the trading post for Heart Coins (#601 PR 3; #320 part 1).
 * Checked by `checkSellRules` in tests. Selling should feel like tidying up,
 * not a money-maker: prices are small, the day's cap is Heart Coins' own
 * (`HEART_COIN_RULES.dailyCaps.sell`), and well below the Glimmer swap's 10
 * for 1, so selling never beats swapping for Glimmer. `pnpm sim:patch-economy`
 * (#601 PR 5) sets the numbers against building upkeep.
 */
export const SELL_RULES: SellRules = {
  items: {
    timber: { lot: 5, coins: 1 }, // TUNE: #601 plan §3
    stone: { lot: 5, coins: 1 }, // TUNE:
    greens: { lot: 5, coins: 1 }, // TUNE:
    water: { lot: 5, coins: 1 }, // TUNE:
    ice: { lot: 3, coins: 1 }, // TUNE:
    // Wild Isle (#621 W1-8): `pnpm sim:wild-isle` sets them against works upkeep.
    fish: { lot: 3, coins: 1 }, // TUNE:
    flour: { lot: 2, coins: 1 }, // TUNE: more than the two Greens it's ground from
    salt: { lot: 3, coins: 1 }, // TUNE:
    pies: { lot: 1, coins: 1 }, // TUNE: a bake's 3 beat its Flour, Fish and Salt's ~2
    emberwood: { lot: 3, coins: 1 }, // TUNE:
    pumpkins: { lot: 3, coins: 1 }, // TUNE:
    glimmer: { lot: 1, coins: 2 }, // TUNE:
    treats: { lot: 3, coins: 1 }, // TUNE:
    'heart-charm': { lot: 1, coins: 2 }, // TUNE:
    'brave-brew': { lot: 1, coins: 2 }, // TUNE: a potion, like a Heart Charm
    'cozy-cocoa': { lot: 1, coins: 2 }, // TUNE:
    'hearty-soup': { lot: 1, coins: 2 }, // TUNE:
  },
  // TUNE: a spare piece, by rarity; even a mythic one is half a day's cap.
  clothing: { common: 2, uncommon: 3, rare: 5, epic: 8, legendary: 12, mythic: 15 },
  // Heartdust is rare (rescues only); a Hearthfire is a season's centrepiece.
  neverSold: ['heartdust', 'jack-o-lantern-hearthfire'],
};
