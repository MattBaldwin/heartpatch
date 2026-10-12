import {
  rareFindTier,
  type PlayerBattle,
  type RareFindTier,
  type RareFindTiers,
  type Rarity,
  type Species,
} from '@heartpatch/shared';
import { el } from '../ui/dom.js';
import { rarityClass } from '../ui/rarity/rarity.js';
import { RARE_REVEAL, revealStep } from './battle-config.js';
import type { BattleClock } from './battle-clock.js';
import './rare-reveal.css';

/*
 * Finding a rare one (#391, owner decision 2026-10-12): when a rare-or-better
 * wild squishy shows up, the screen dims a touch around it, sparkles burst, a
 * banner says how rare it is and a rising chime plays (the screen's
 * `onRareFind`). Each tier's length, words and size are shared data
 * (`RARE_FIND_TIERS`). The full moment plays the first time the player meets
 * that kind on the patch (the server's `firstMeeting`); after that only the
 * banner shows, briefly, with no pause. Page elements over the 3D scene: no
 * draw calls, and only transform and opacity move (rare-reveal.css).
 */

export interface RevealPlan {
  /** The wild squishy's rarity (its colour), and its tier's moment. */
  readonly rarity: Rarity;
  readonly tier: RareFindTier;
  /** The whole moment (first meeting) or just the banner (met before). */
  readonly full: boolean;
}

/** The wild squishy of a battle opening against one (the side the player isn't). */
export function wildOf(
  battle: Pick<PlayerBattle, 'mySide' | 'view'>,
): { speciesId: string } | undefined {
  const side = battle.view.sides[battle.mySide === 'a' ? 'b' : 'a'];
  return side.squishies[side.active];
}

/**
 * The moment a battle opens with, if any: a wild battle before its first
 * move whose wild squishy has a rare-find tier (Rare and up, secret kinds
 * too). A replay never has one.
 */
export function revealPlan(
  battle: Pick<PlayerBattle, 'kind' | 'status' | 'mySide' | 'view' | 'firstMeeting'>,
  species: ReadonlyMap<string, Pick<Species, 'rarity'>>,
  replay = false,
  tiers?: RareFindTiers,
): RevealPlan | null {
  if (replay || battle.kind !== 'wild' || battle.status !== 'active') return null;
  if (battle.view.log.length > 0) return null;
  const wild = wildOf(battle);
  const rarity = wild ? species.get(wild.speciesId)?.rarity : undefined;
  const tier = rarity ? rareFindTier(rarity, tiers) : null;
  if (!rarity || !tier) return null;
  return { rarity, tier, full: battle.firstMeeting === true };
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
      glyph: k % 3 === 0 ? '✦' : k % 3 === 1 ? '✧' : '✶',
    };
  });
}

/** Puts the moment on screen inside `host`. */
export function showRareReveal(host: HTMLElement, options: RevealOptions): RareReveal {
  const { plan, layout, clock } = options;
  const { scale } = plan.tier;
  const ms = plan.full ? plan.tier.ms : RARE_REVEAL.briefMs;
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
    dim.style.setProperty('--reveal-dim', String(revealStep(RARE_REVEAL.dim, scale)));
    root.append(dim);
    if (!options.reducedMotion) {
      const seed = plan.rarity.length * 97 + Math.round(layout.width);
      for (const s of sparkleSpots(
        revealStep(RARE_REVEAL.sparkles, scale),
        { ...layout, spot },
        seed,
      )) {
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
  // Its words go in just after it's on the page, so VoiceOver reads them out
  // (a live region that arrives already filled is often not announced).
  const banner = el('div', { class: 'rare-reveal-banner', role: 'status' });
  const wide = layout.width > RARE_REVEAL.wideScreen ? RARE_REVEAL.wideBanner : 1;
  banner.style.fontSize = `${Math.round(revealStep(RARE_REVEAL.banner, scale) * wide)}px`;
  banner.style.setProperty('--reveal-ring', `${revealStep(RARE_REVEAL.ring, scale)}px`);
  banner.style.bottom = `${Math.round(layout.height - layout.sheetTop + RARE_REVEAL.sheetGap)}px`;
  root.append(banner);

  let done = false;
  /** A finger or button is down on the moment: it stays until that tap's click. */
  let pressed = false;
  let due = false;
  const timers: number[] = [];
  const doc = root.ownerDocument;
  const finish = (notify: boolean): void => {
    if (done) return;
    done = true;
    for (const id of timers) clock.cancel(id);
    doc.removeEventListener('keydown', onKey, true);
    root.remove();
    if (notify) options.onDone();
  };
  // Ends on time, unless a tap is halfway through: then on that tap's click,
  // so the click can't land on a battle button the moment uncovered.
  const end = (): void => {
    if (pressed) due = true;
    else finish(true);
  };
  // The full moment holds the battle buttons. A tap skips it, ending on the
  // tap's own click (on the moment, not on a button under it: the browser
  // still sends that click after a pointerdown, so the moment stays till then).
  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(true);
  }
  if (plan.full) {
    root.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      pressed = true;
    });
    root.addEventListener('pointercancel', () => {
      pressed = false;
      if (due) finish(true);
    });
    root.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    });
    doc.addEventListener('keydown', onKey, true);
  }
  timers.push(
    clock.later(0, () => {
      banner.textContent = plan.tier.banner;
    }),
    clock.later(Math.max(0, ms - RARE_REVEAL.fadeMs), () => {
      root.classList.add('rare-reveal-out');
    }),
    clock.later(ms, end),
  );
  host.append(root);
  return {
    element: root,
    skip: () => {
      finish(true);
    },
    dispose: () => {
      finish(false);
    },
  };
}
