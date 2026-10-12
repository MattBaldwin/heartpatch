import type { PlayerBattle, Rarity, Species } from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { rarityClass } from '../ui/rarity/rarity.js';
import { RARE_REVEAL } from './battle-config.js';
import type { BattleClock } from './battle-clock.js';
import './rare-reveal.css';

/*
 * Finding a rare one (#391, owner decision 2026-10-12): when a rare-or-better
 * wild squishy shows up, the screen dims a touch around it, sparkles burst, a
 * banner says how rare it is and a rising chime plays (the screen's
 * `onRareFind`). The full moment plays the first time the player meets that
 * kind on the patch (the server's `firstMeeting`); after that only the banner
 * shows, briefly, with no pause. Page elements over the 3D scene: no draw
 * calls, and only transform and opacity move (battle.css).
 */

/** The rarities with a moment (secret kinds wait on the owner's call, #391). */
export type RevealRarity = keyof typeof RARE_REVEAL.kinds;

// Player-facing text (style guide §2: short, cozy, kid-readable).
export const REVEAL_TEXT = {
  rare: '✨ Something rare is here! ✨',
  epic: '✨ Something epic is here! ✨',
  legendary: '🌟 Something legendary is here! 🌟',
  mythic: '🌈 Something mythic is here! 🌈',
} as const satisfies Record<RevealRarity, string>;

export function isRevealRarity(rarity: Rarity | undefined): rarity is RevealRarity {
  return rarity !== undefined && Object.hasOwn(RARE_REVEAL.kinds, rarity);
}

export interface RevealPlan {
  readonly rarity: RevealRarity;
  /** The whole moment (first meeting) or just the banner (met before). */
  readonly full: boolean;
}

/**
 * The moment a battle opens with, if any: a wild battle before its first
 * move whose wild squishy is rare or better. A replay never has one.
 */
export function revealPlan(
  battle: Pick<PlayerBattle, 'kind' | 'status' | 'mySide' | 'view' | 'firstMeeting'>,
  species: ReadonlyMap<string, Pick<Species, 'rarity'>>,
  replay = false,
): RevealPlan | null {
  if (replay || battle.kind !== 'wild' || battle.status !== 'active') return null;
  if (battle.view.log.length > 0) return null;
  const side = battle.view.sides[battle.mySide === 'a' ? 'b' : 'a'];
  const wild = side.squishies[side.active];
  const rarity = wild ? species.get(wild.speciesId)?.rarity : undefined;
  if (!isRevealRarity(rarity)) return null;
  return { rarity, full: battle.firstMeeting === true };
}

/** Where things go on the page, CSS px from the top left. */
export interface RevealLayout {
  /** The wild squishy's middle and half its height; null puts the dim mid-screen. */
  readonly spot: { x: number; y: number; r: number } | null;
  /** The bottom sheet's top edge, and the name pills' bottom edge. */
  readonly sheetTop: number;
  readonly pillsBottom: number;
  readonly width: number;
  readonly height: number;
}

export interface RevealOptions {
  readonly plan: RevealPlan;
  readonly layout: RevealLayout;
  readonly reducedMotion: boolean;
  readonly clock: BattleClock;
  /** The moment ended, skipped or not (not called after `dispose`). */
  readonly onDone: () => void;
}

export interface RareReveal {
  readonly element: HTMLElement;
  /** Ends the moment now (a tap does this too). */
  skip: () => void;
  /** Takes it away without `onDone` (the battle closed). */
  dispose: () => void;
}

/** A little seeded random, so a kind's sparkles land the same way each time. */
function seeded(seed: number): () => number {
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
}

/** Sparkle landing spots around the squishy, kept off the pills, the sheet and the edges. */
export function sparkleSpots(
  count: number,
  layout: RevealLayout & { spot: NonNullable<RevealLayout['spot']> },
  seed: number,
): { dx: number; dy: number; rot: number; size: number; tint: boolean; glyph: string }[] {
  const rand = seeded(seed);
  const { spot } = layout;
  const [near, far] = RARE_REVEAL.sparkleReach;
  const clear = RARE_REVEAL.sparkleClear;
  const minY = layout.pillsBottom + clear.pills;
  const maxY = Math.max(minY, layout.sheetTop - clear.sheet);
  return Array.from({ length: count }, (_, k) => {
    const angle = (k / count) * Math.PI * 2 + rand() * 0.4;
    const reach = spot.r * (near + rand() * (far - near));
    const x = Math.min(Math.max(spot.x + Math.cos(angle) * reach, 14), layout.width - 14);
    const y = Math.min(Math.max(spot.y + Math.sin(angle) * reach, minY), maxY);
    return {
      dx: Math.round(x - spot.x),
      dy: Math.round(y - spot.y),
      rot: Math.round(rand() * 40 - 20),
      size: Math.round(10 + rand() * 12),
      tint: k % 2 === 1,
      glyph: ['✦', '✧', '✶'][k % 3]!,
    };
  });
}

/** Puts the moment on screen inside `host`. */
export function showRareReveal(host: HTMLElement, options: RevealOptions): RareReveal {
  const { plan, layout, clock } = options;
  const look = RARE_REVEAL.kinds[plan.rarity];
  const ms = plan.full ? look.ms : RARE_REVEAL.briefMs;
  const root = el('div', {
    class: `rare-reveal ${rarityClass(plan.rarity)}${plan.full ? ' rare-reveal-full' : ''}${
      options.reducedMotion ? ' rare-reveal-calm' : ''
    }`,
    'data-rarity': plan.rarity,
  });
  root.style.setProperty('--reveal-ms', `${ms}ms`);
  root.style.setProperty('--reveal-fade-ms', `${RARE_REVEAL.fadeMs}ms`);

  const spot = layout.spot ?? {
    x: layout.width / 2,
    y: (layout.pillsBottom + layout.sheetTop) / 2,
    r: Math.min(layout.width, layout.height) / 5,
  };
  if (plan.full) {
    const dim = el('div', { class: 'rare-reveal-dim' });
    dim.style.setProperty('--reveal-x', `${Math.round(spot.x)}px`);
    dim.style.setProperty('--reveal-y', `${Math.round(spot.y)}px`);
    dim.style.setProperty('--reveal-r', `${Math.round(spot.r * 1.9)}px`);
    dim.style.setProperty('--reveal-dim', String(look.dim));
    root.append(dim);
    if (!options.reducedMotion) {
      const seed = plan.rarity.length * 97 + Math.round(layout.width);
      for (const s of sparkleSpots(look.sparkles, { ...layout, spot }, seed)) {
        const sparkle = el(
          'span',
          { class: 'rare-reveal-sparkle', 'aria-hidden': 'true' },
          s.glyph,
        );
        sparkle.style.left = `${Math.round(spot.x)}px`;
        sparkle.style.top = `${Math.round(spot.y)}px`;
        sparkle.style.setProperty('--dx', `${s.dx}px`);
        sparkle.style.setProperty('--dy', `${s.dy}px`);
        sparkle.style.setProperty('--rot', `${s.rot}deg`);
        sparkle.style.fontSize = `${s.size}px`;
        if (s.tint) sparkle.classList.add('rare-reveal-sparkle-tint');
        root.append(sparkle);
      }
    }
  }
  const banner = el(
    'div',
    { class: 'rare-reveal-banner', role: 'status' },
    REVEAL_TEXT[plan.rarity],
  );
  const wide = layout.width > RARE_REVEAL.wideScreen ? RARE_REVEAL.wideBanner : 1;
  banner.style.fontSize = `${Math.round(look.banner * wide)}px`;
  banner.style.setProperty('--reveal-ring', `${look.ring}px`);
  banner.style.bottom = `${Math.round(layout.height - layout.sheetTop + RARE_REVEAL.sheetGap)}px`;
  root.append(banner);

  let done = false;
  const timers: number[] = [];
  const finish = (notify: boolean): void => {
    if (done) return;
    done = true;
    for (const id of timers) clock.cancel(id);
    root.remove();
    if (notify) options.onDone();
  };
  // The full moment holds the battle buttons: a tap anywhere skips it instead.
  if (plan.full) {
    root.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    });
  }
  timers.push(
    clock.later(Math.max(0, ms - RARE_REVEAL.fadeMs), () => root.classList.add('rare-reveal-out')),
    clock.later(ms, () => finish(true)),
  );
  host.append(root);
  return { element: root, skip: () => finish(true), dispose: () => finish(false) };
}
