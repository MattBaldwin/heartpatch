import {
  GAME_DATA,
  GLIMMER_SWAP,
  type GlimmerSwapRules,
  type GlimmerSwapView,
} from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';

// The trading post's Glimmer swap (#523; the owner-approved mockup). The
// rate, the resources and the cap are shared data (`GLIMMER_SWAP`); the
// server checks them all again (CLAUDE.md rule 1). Pure, so it's tested
// without a DOM.

const RESOURCES = new Map(GAME_DATA.resources.map((r) => [r.id, r]));
const nameOf = (itemId: string) => RESOURCES.get(itemId)?.name ?? itemId;

// Kid-readable words (style guide §2): short, warm, no stats-speak.
export const SWAP_TEXT = {
  intro: (rules: GlimmerSwapRules) =>
    `Swap ${String(rules.give)} of one thing for ${String(rules.get)} 💎 Glimmer!`,
  today: (view: GlimmerSwapView, rules: GlimmerSwapRules) =>
    `Today: ${String(view.swappedToday)} of ${String(rules.dailyCap)} 💎`,
  have: (n: number) => `You have ${String(n)}`,
  swap: 'Swap',
  need: (n: number) => `Need ${String(n)}`,
  confirm: (itemId: string, rules: GlimmerSwapRules) =>
    `Swap ${String(rules.give)} ${nameOf(itemId)} for ${String(rules.get)} 💎?`,
  yes: 'Swap!',
  no: 'Not now',
  done: (rules: GlimmerSwapRules) => `Yay! ${String(rules.get)} 💎 Glimmer is in your bag!`,
  // The server's cap message too (modules/glimmer-swap): change both together.
  capped: "That's all the Glimmer for today! Come back tomorrow. 🌙",
  resetsIn: (hours: number) =>
    hours <= 1 ? 'New swaps in less than an hour' : `New swaps in ${String(hours)} hours`,
} as const;

/** One accepted resource's card: what I have and whether I can swap it now. */
export interface SwapCard {
  readonly itemId: string;
  readonly icon: string;
  readonly name: string;
  readonly have: number;
  readonly canSwap: boolean;
}

/** Glimmer I can still swap today. */
export const swapsLeft = (view: GlimmerSwapView, rules: GlimmerSwapRules = GLIMMER_SWAP) =>
  Math.max(0, rules.dailyCap - view.swappedToday);

/** The accepted resources in data order, each with what I have and whether it swaps. */
export function swapCards(
  view: GlimmerSwapView,
  rules: GlimmerSwapRules = GLIMMER_SWAP,
): SwapCard[] {
  const open = swapsLeft(view, rules) >= rules.get;
  return rules.accepts.map((itemId) => {
    const have = view.have[itemId] ?? 0;
    return {
      itemId,
      icon: itemIcon(itemId),
      name: nameOf(itemId),
      have,
      canSwap: open && have >= rules.give,
    };
  });
}

/** Whole hours (rounded up) until my day's swaps come back. */
export function hoursToReset(view: Pick<GlimmerSwapView, 'resetsAt'>, nowMs: number): number {
  return Math.max(1, Math.ceil((Date.parse(view.resetsAt) - nowMs) / 3_600_000));
}
