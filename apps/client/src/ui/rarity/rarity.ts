import type { Rarity } from '@heartpatch/shared';
import { el } from '../dom.js';
import './rarity.css';

/*
 * Rarity's words and colours, for squishies (#240) and clothing (#44) alike,
 * so the two can't drift (design doc §23: clothing matches squishy rarity
 * colours). The colours are CSS custom properties in `rarity.css`
 * (`.rarity-<id>` sets `--rarity`); this file holds the words and builds
 * the chip and the dot.
 */

// Player-facing text (style guide §2, §6).
export const RARITY_NAMES = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  secret: 'Secret',
} as const satisfies Record<Rarity, string>;

/** A rarity's player-facing name. */
export function rarityName(rarity: Rarity): string {
  return RARITY_NAMES[rarity];
}

/** The class that sets `--rarity` to a rarity's colour. */
export function rarityClass(rarity: Rarity): string {
  return `rarity-${rarity}`;
}

/** The chip: a coloured dot and the word ("● Rare"), for screens with room. */
export function rarityChip(rarity: Rarity): HTMLElement {
  return el(
    'span',
    { class: `rarity-chip ${rarityClass(rarity)}`, 'data-rarity': rarity },
    rarityName(rarity),
  );
}

/**
 * Just the dot, for rows where space is tight. VoiceOver still reads the
 * word, so it never rests on colour alone.
 */
export function rarityDot(rarity: Rarity): HTMLElement {
  return el('span', {
    class: `rarity-dot ${rarityClass(rarity)}`,
    'data-rarity': rarity,
    role: 'img',
    'aria-label': rarityName(rarity),
  });
}
