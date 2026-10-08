// A picture for every item (style guide §3 "show, then tell"): emoji, so the
// bag needs no image assets. Unknown ids (newer server data) get a sparkle.

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
  shovel: '🪏',
  net: '🥅',
  rope: '🪢',
  lantern: '🪔',
};

export const FALLBACK_ICON = '✨';

export function itemIcon(itemId: string): string {
  return ICONS[itemId] ?? FALLBACK_ICON;
}
