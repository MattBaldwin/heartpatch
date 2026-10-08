import type { TradeRules } from '../schemas/data/trading.js';

/** Trades and gifts at trading posts (#271). Checked by `checkTradeRules` in tests. */
export const TRADE_RULES: TradeRules = {
  offerDays: 3, // TUNE: #30 contract proposal §5
  squishiesPerSide: 3, // TUNE:
  linesPerSide: 6, // TUNE:
  openPerSender: 5, // TUNE:
  openPerPair: 1, // TUNE: one open offer per pair per direction
};
