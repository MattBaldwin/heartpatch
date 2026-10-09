import { iconNode } from '../ui/line-icons.js';
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
  // New things to gather (#238).
  water: '💧',
  greens: '🌿',
  ice: '🧊',
  // Explore tools (#199).
  shovel: TOOL_WORDS.shovel.icon,
  net: TOOL_WORDS.net.icon,
  rope: TOOL_WORDS.rope.icon,
  lantern: TOOL_WORDS.lantern.icon,
};

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
  return iconNode(tool ? TOOL_ICONS[tool.tool] : itemIcon(itemId), className);
}
