import { rareFindTier, type PlayerBattle, type Rarity, type Species } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { rarityClass } from '../ui/rarity/rarity.js';
import { BEFRIEND_CHEER, revealStep } from './battle-config.js';
import { wildOf } from './rare-reveal.js';
import './befriend-cheer.css';

/*
 * Befriending a rare one (#391, owner decisions 2026-10-12): the result card
 * becomes a celebration. It drops low, where the battle buttons were, so the
 * new friend stays in view above it; it wears the tier's colour and word, and
 * hearts fall in that colour (more for rarer). "First ever!" shows the first
 * time the player befriends that kind on the patch (the server's `firstEver`),
 * on any befriend. Page elements only: transform and opacity move.
 */

// Player-facing text (style guide §2).
export const CHEER_TEXT = {
  firstEver: 'First ever!',
} as const;

export interface BefriendCheer {
  /** The tier's look, or null for a kind below Rare (only "First ever!" then). */
  readonly rare: { readonly rarity: Rarity; readonly label: string; readonly scale: number } | null;
  readonly firstEver: boolean;
}

/** A wild battle the player won by befriending the wild squishy. */
export function befriended(b: Pick<PlayerBattle, 'kind' | 'view' | 'mySide'>): boolean {
  const phase = b.view.phase;
  return (
    b.kind === 'wild' &&
    phase.type === 'over' &&
    phase.result.reason === 'captured' &&
    phase.result.winner === b.mySide
  );
}

/** What the result card celebrates, if anything (a befriend that's rare or a first). */
export function cheerFor(
  b: Pick<PlayerBattle, 'kind' | 'view' | 'mySide' | 'firstEver'>,
  species: ReadonlyMap<string, Pick<Species, 'rarity'>>,
): BefriendCheer | null {
  if (!befriended(b)) return null;
  const wild = wildOf(b);
  const rarity = wild ? species.get(wild.speciesId)?.rarity : undefined;
  const tier = rarity ? rareFindTier(rarity) : null;
  const firstEver = b.firstEver === true;
  if (!tier && !firstEver) return null;
  return {
    rare: rarity && tier ? { rarity, label: tier.label, scale: tier.scale } : null,
    firstEver,
  };
}

/** A little seeded random, so the hearts fall the same way each time. */
function seeded(seed: number): () => number {
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/**
 * Where the hearts come to rest: across the screen, between the pills and the
 * card. None when the band is empty (no room above the card), rather than a pile.
 */
export function heartSpots(
  count: number,
  band: { top: number; bottom: number; width: number },
  seed: number,
): { x: number; y: number; rot: number; size: number; tint: boolean; glyph: string }[] {
  if (band.bottom <= band.top) return [];
  const rand = seeded(seed);
  const span = band.bottom - band.top;
  return Array.from({ length: count }, (_, k) => ({
    x: Math.round(band.width * (0.08 + rand() * 0.84)),
    y: Math.round(band.top + rand() * span),
    rot: Math.round(rand() * 60 - 30),
    size: Math.round(12 + rand() * 14),
    tint: k % 2 === 1,
    glyph: k % 3 === 2 ? '✦' : '♥',
  }));
}

/**
 * Where the hearts may land: between the pills and the card, clear of both.
 * It can come back empty (`bottom <= top`) when the card rests under the pills.
 */
export function heartBand(
  pillsBottom: number,
  cardTop: number,
  width: number,
): { top: number; bottom: number; width: number } {
  return {
    top: pillsBottom + BEFRIEND_CHEER.heartClear,
    bottom: cardTop - BEFRIEND_CHEER.heartClear * 3,
    width,
  };
}

/**
 * The card's top edge on the page once it has come to rest: its layout box
 * (`offsetTop`), which its entrance animation's transform doesn't move.
 */
function restingTop(card: HTMLElement): number {
  const parent = card.offsetParent;
  return (parent ? parent.getBoundingClientRect().top : 0) + card.offsetTop;
}

/**
 * Dresses the result card for `cheer` and drops hearts into `layer`; returns
 * the undo (the card is reused for every battle).
 */
export function dressResult(
  card: HTMLElement,
  layer: HTMLElement,
  cheer: BefriendCheer,
  options: { reducedMotion: boolean; pillsBottom: number; width: number },
): () => void {
  const added: Element[] = [];
  const classes: string[] = ['battle-result-cheer'];
  if (options.reducedMotion) classes.push('battle-result-calm');
  if (cheer.firstEver) {
    const sticker = el(
      'span',
      { class: 'battle-first-ever', 'data-testid': 'battle-first-ever' },
      CHEER_TEXT.firstEver,
    );
    card.prepend(sticker);
    added.push(sticker);
  }
  if (cheer.rare) classes.push('battle-result-rare', rarityClass(cheer.rare.rarity));
  // Dressed first: the hearts are placed against where the card comes to rest.
  card.classList.add(...classes);
  if (cheer.rare) {
    // The rarity chip's look (ui/rarity), with the tier's word ("Special").
    const chip = el(
      'span',
      {
        class: `rarity-chip ${rarityClass(cheer.rare.rarity)}`,
        'data-testid': 'battle-cheer-chip',
      },
      cheer.rare.label,
    );
    card.querySelector('.auth-title')?.after(chip);
    added.push(chip);
    // The hearts land above the card, which sits low now.
    const count = options.reducedMotion
      ? BEFRIEND_CHEER.calmHearts
      : revealStep(BEFRIEND_CHEER.hearts, cheer.rare.scale);
    const band = heartBand(options.pillsBottom, restingTop(card), options.width);
    const seed = cheer.rare.rarity.length * 31 + Math.round(options.width);
    // No room above the card (a phone held sideways): heartSpots gives none.
    for (const h of heartSpots(count, band, seed)) {
      const heart = el('span', { class: 'battle-heart', 'aria-hidden': 'true' }, h.glyph);
      heart.style.left = `${String(h.x)}px`;
      heart.style.top = `${String(h.y)}px`;
      heart.style.fontSize = `${String(h.size)}px`;
      heart.style.setProperty('--rot', `${String(h.rot)}deg`);
      if (h.tint) heart.classList.add('battle-heart-tint');
      layer.append(heart);
      added.push(heart);
    }
    layer.className = `battle-hearts ${rarityClass(cheer.rare.rarity)}${
      options.reducedMotion ? ' battle-result-calm' : ''
    }`;
  }
  return () => {
    for (const node of added) node.remove();
    card.classList.remove(...classes);
    layer.className = 'battle-hearts';
  };
}
