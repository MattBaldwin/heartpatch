import { strokeIcon } from './trays/trays.js';

// Drawn line icons (#291, like the boards' button icons), shared by explore
// and the Bag (#308). The shovel emoji (U+1FA8F) is Emoji 16.0, which iOS
// only draws from 18.4; on the iOS 17 floor (tech spec) and other older
// systems it's an empty box. A drawn icon looks the same everywhere and
// matches the boards. Plain text can't hold one, so text keeps an emoji
// every supported system has (see `TOOL_WORDS`, `item-icons.ts`).

/** 24 × 24 stroke paths for `strokeIcon`: the tools and the things a Keeper lifts. */
export const ICON_PATHS = {
  shovel: 'M4 20l9-9 M13 11l3-3 4 4-3 3z M3 21l2-2',
  net: 'M4 20l7.2-7.2 M9.5 9a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0-11 0 M12 6.5l6 5 M12 11.5l6-5',
  rope: 'M12 5a7 7 0 1 0 7 7 M12 9a3 3 0 1 0 3 3 M19 12v8',
  lantern: 'M12 2.5v2 M9.5 4.5h5 M8 7h8 M9 7v11h6V7 M12 10.5v4 M7 20h10',
  rock: 'M4 18l2.5-6 4-4 5 1.5 3.5 4 1 4.5Z',
  log: 'M6 8h12a4 4 0 0 1 0 8H6 M6 8a4 4 0 0 0 0 8a4 4 0 0 0 0-8 M6 11v2',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** True when `icon` names a drawn icon (else it's an emoji or text). */
export function isIconName(icon: string): icon is IconName {
  return Object.hasOwn(ICON_PATHS, icon);
}

/**
 * An icon as a node: a drawn line icon when `icon` names one (with `className`
 * for its size), else the emoji or text itself.
 */
export function iconNode(icon: string, className: string): Node {
  if (!isIconName(icon)) return document.createTextNode(icon);
  const svg = strokeIcon(ICON_PATHS[icon]);
  svg.classList.add(className);
  return svg;
}
