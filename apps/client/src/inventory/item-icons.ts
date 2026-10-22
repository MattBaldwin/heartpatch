import { GAME_DATA, type ClearToolId } from '@heartpatch/shared';
import { iconNode, type IconName } from '../ui/line-icons.js';
import { TOOL_ICONS, TOOL_WORDS, toolOf } from './tool-uses.js';

// A picture for every item (style guide §3 "show, then tell"): emoji, so the
// bag needs no image assets. Unknown ids (newer server data) get a sparkle.
// Tools are drawn where an element shows them (`itemIconNode`, #308); in text
// they use the same emoji as their pop-ups (`TOOL_WORDS`).

const ICONS: Readonly<Record<string, string>> = {
  timber: '🪵',
  stone: '🪨',
  emberwood: '🔥',
  glimmer: '💎',
  heartdust: '💖',
  treats: '🍪',
  pumpkins: '🎃',
  'witch-dust': '🔮',
  'magic-fallen-leaves': '🍂',
  'turkey-feathers': '🪶',
  presents: '🎁',
  fireworks: '🎆',
  'heart-charm': '💗',
  'jack-o-lantern-hearthfire': '🏮',
  // Battle potions (#214).
  'brave-brew': '🧪',
  'cozy-cocoa': '☕',
  'hearty-soup': '🍲',
  // Rekindled finds and makes (#306 PR 5).
  'joy-ember': '🔆',
  'heart-petals': '🌸',
  'joy-lantern': '🕯️',
  'heart-tea': '🍵',
  // New things to gather (#238).
  water: '💧',
  greens: '🌿',
  ice: '🧊',
  // Explore tools (#199).
  shovel: TOOL_WORDS.shovel.icon,
  net: TOOL_WORDS.net.icon,
  rope: TOOL_WORDS.rope.icon,
  lantern: TOOL_WORDS.lantern.icon,
  // Clearing tools (#242): the Axe's emoji is Emoji 12.0; the others share
  // the dig emoji in text. Elements draw them (`CLEAR_TOOL_ICONS`).
  axe: '🪓',
  pickaxe: '⛏️',
  spade: '⛏️',
};

/** Each clearing tool's drawn icon (#242), for the Bag's tiles and the clear sheet. */
export const CLEAR_TOOL_ICONS: Readonly<Record<ClearToolId, IconName>> = {
  axe: 'axe',
  pickaxe: 'pickaxe',
  spade: 'spade',
};

const CLEAR_TOOL_OF = new Map(
  GAME_DATA.resources.flatMap((r) => (r.clearTool ? [[r.id, r.clearTool] as const] : [])),
);

export const FALLBACK_ICON = '✨';

export function itemIcon(itemId: string): string {
  return ICONS[itemId] ?? FALLBACK_ICON;
}

/**
 * An item's icon as a node, for a tile or card: a tool's drawn icon (the same
 * as explore's, #291), else its emoji. `className` sizes the drawn one.
 */
export function itemIconNode(itemId: string, className: string): Node {
  const tool = toolOf(itemId);
  const clears = CLEAR_TOOL_OF.get(itemId);
  const drawn = tool ? TOOL_ICONS[tool.tool] : clears ? CLEAR_TOOL_ICONS[clears] : null;
  return iconNode(drawn ?? itemIcon(itemId), className);
}

/** One clothing slot's little picture (a trade line, a find card). */
const CLOTHING_SLOT_ICONS: Readonly<Record<string, string>> = {
  hat: '🎩',
  'hair-accessory': '🎀',
  top: '👕',
  bottom: '👖',
  shoes: '👟',
  back: '🎒',
  held: '🧸',
  costume: '🎭',
  squishy: '🧣',
};

/** The picture for a piece of clothing in `slot`; a sparkle for a slot this client doesn't know. */
export function clothingSlotIcon(slot: string): string {
  return CLOTHING_SLOT_ICONS[slot] ?? '✨';
}
