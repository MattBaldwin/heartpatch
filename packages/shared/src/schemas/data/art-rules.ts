import { z } from 'zod';
import { ContentIdSchema, RaritySchema, type Rarity } from './common.js';
import { ElementIdSchema, FeelingIdSchema, type ElementId, type FeelingId } from './elements.js';
import type { Path, Report } from './issues.js';
import { FinishSchema, GlowSchema, HexColorSchema, type SpeciesVisual } from './species.js';
import { SURFACE_SLOTS, type Part, type VisualRegistry } from './visuals.js';

/**
 * The squishy art rules (docs/ART_BIBLE.md §1) as data, so `checkGameData`
 * can hold every species to them: readable faces, rarity material tiers,
 * glowing Light and Fire, a face kit per feeling, evolutions that grow, and
 * silhouettes kids can tell apart.
 */
export const ArtRulesSchema = z.strictObject({
  /** Face ink when a species doesn't set its own. */
  defaultInk: HexColorSchema,
  /** Minimum WCAG contrast between face ink and what it sits on. */
  minInkContrast: z.number().min(1).max(21),
  /** Face patterns at least this wide (relative to body height) count as part of the face. */
  facePatchWidth: z.number().min(0).max(1.5),
  finishByRarity: z.record(RaritySchema, FinishSchema),
  /** Elements that must glow, and how. Other species may opt in. */
  glowByElement: z.partialRecord(ElementIdSchema, GlowSchema),
  /** An evolution's size over its base's: [min, max]. */
  evolutionScale: z.tuple([z.number().min(1), z.number().min(1)]),
  /** Each feeling's face kit: every group lists parts, and a species needs one part from each. */
  feelingFaces: z.record(FeelingIdSchema, z.array(z.array(ContentIdSchema).min(1)).min(1)),
});
export type ArtRules = z.infer<typeof ArtRulesSchema>;

type Rgb = readonly [number, number, number];

function rgbOf(hex: string): Rgb {
  const c = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return [c(1), c(3), c(5)];
}

/** x^(1/5) for x in (0, 1] by Newton's method: only + − × ÷, so every engine agrees (tech spec §8). */
function fifthRoot(x: number): number {
  let y = 1;
  for (let i = 0; i < 40; i++) y = (4 * y + x / (y * y * y * y)) / 5;
  return y;
}

function luminance(hex: string): number {
  // sRGB to linear: ((c + 0.055) / 1.055)^2.4, written as v² · (v^(1/5))².
  const lin = (c: number) => {
    if (c <= 0.04045) return c / 12.92;
    const v = (c + 0.055) / 1.055;
    const r = fifthRoot(v);
    return v * v * r * r;
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two `#rrggbb` colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export type HueFamily =
  | 'white'
  | 'dark'
  | 'neutral'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'pink';

const HUES: readonly [HueFamily, number][] = [
  ['red', 15],
  ['orange', 42],
  ['yellow', 70],
  ['green', 165],
  ['cyan', 195],
  ['blue', 235],
  ['purple', 290],
  ['pink', 345],
  ['red', 360],
];

/** The colour family a kid would name: very light, very dark, greyish, or a hue. */
export function hueFamily(hex: string): HueFamily {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l >= 0.9) return 'white';
  if (l <= 0.3) return 'dark';
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.18) return 'neutral';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return HUES.find(([, end]) => h < end)?.[0] ?? 'red';
}

const surface: ReadonlySet<string> = new Set(SURFACE_SLOTS);
const INKED: ReadonlySet<string> = new Set(['eyes', 'brows', 'mouth']);

function partsOf(visual: SpeciesVisual, registry: VisualRegistry): Part[] {
  return visual.parts.flatMap((id) => registry.parts.get(id) ?? []);
}

/**
 * The line's biggest sticking-out part by silhouette area (width × length),
 * or `none` for a plain body.
 */
export function dominantPart(visual: SpeciesVisual, registry: VisualRegistry): string {
  let best: Part | null = null;
  for (const part of partsOf(visual, registry)) {
    if (surface.has(part.slot) || part.slot === 'legs') continue;
    if (!best || part.size[0] * part.size[1] > best.size[0] * best.size[1]) best = part;
  }
  return best?.id ?? 'none';
}

/** The palette colour a part takes (missing colours fall back to the one before). */
function roleColor(visual: SpeciesVisual, role: Part['color']): string | null {
  const order = ['primary', 'secondary', 'accent', 'detail'] as const;
  const i = order.indexOf(role as (typeof order)[number]);
  if (i < 0) return null;
  for (let k = i; k >= 0; k--) {
    const c = visual.palette[k];
    if (c) return c;
  }
  return null;
}

interface ArtSpecies {
  readonly id: string;
  readonly element: ElementId;
  readonly feeling: FeelingId;
  readonly rarity: Rarity;
  readonly visual: SpeciesVisual;
}

/** One species against the art rules: ink contrast, material tier, glow and face kit. */
export function checkSpeciesArt(
  species: ArtSpecies,
  registry: VisualRegistry,
  rules: ArtRules,
  path: Path,
  report: Report,
): void {
  const { visual } = species;
  const at = [...path, 'visual'];
  const parts = partsOf(visual, registry);
  // A visual with unknown, repeated or missing parts is already reported by checkSpeciesVisual.
  const repeated = new Set(visual.parts).size !== visual.parts.length;
  if (repeated || parts.length !== visual.parts.length || !parts.some((p) => p.slot === 'eyes'))
    return;
  const ink = visual.ink ?? rules.defaultInk;

  if (parts.some((p) => INKED.has(p.slot) && p.color === 'ink')) {
    const behind = [visual.palette[0] ?? '#ffffff'];
    for (const p of parts) {
      if (p.slot !== 'pattern' || p.size[0] < rules.facePatchWidth || p.around > 45) continue;
      const c = roleColor(visual, p.color);
      if (c) behind.push(c);
    }
    for (const c of behind) {
      const ratio = contrastRatio(ink, c);
      if (ratio < rules.minInkContrast) {
        report(
          [...at, 'ink'],
          `face ink ${ink} on ${c} is ${ratio.toFixed(2)}:1; faces need at least ${rules.minInkContrast}:1 (set visual.ink)`,
        );
      }
    }
  }

  const finish = visual.finish ?? 'vinyl';
  const wanted = rules.finishByRarity[species.rarity];
  if (finish !== wanted) {
    report(
      [...at, 'finish'],
      `${species.rarity} squishies use the "${wanted}" finish, not "${finish}"`,
    );
  }

  const glow = rules.glowByElement[species.element];
  if (glow && visual.glow !== glow) {
    report([...at, 'glow'], `${species.element} squishies glow ("${glow}")`);
  }

  const ids = new Set(visual.parts);
  for (const group of rules.feelingFaces[species.feeling]) {
    if (!group.some((id) => ids.has(id))) {
      report(
        [...at, 'parts'],
        `${species.feeling} squishies need one of ${group.map((id) => `"${id}"`).join(', ')}`,
      );
    }
  }
}

interface ArtLineSpecies extends ArtSpecies {
  readonly evolutions: readonly { readonly into: string }[];
}

/**
 * Across a roster: every evolution grows ×`evolutionScale` and adds a new
 * sticking-out part, and no two lines share body + dominant part + hue family.
 */
export function checkRosterArt(
  table: string,
  species: readonly ArtLineSpecies[],
  registry: VisualRegistry,
  rules: ArtRules,
  report: Report,
): void {
  const index = new Map(species.map((s, i) => [s.id, i]));
  const line = new Map<string, string>();
  const rootOf = (id: string): string => line.get(id) ?? id;

  for (const s of species) {
    for (const evo of s.evolutions) {
      const j = index.get(evo.into);
      if (j === undefined) continue;
      const into = species[j];
      // Self-evolutions and loops are reported by checkGameData; a loop's way back isn't a growth step.
      if (!into || into.id === s.id || rootOf(s.id) === into.id || line.has(into.id)) continue;
      line.set(into.id, rootOf(s.id));
      const ratio = (into.visual.size ?? 1) / (s.visual.size ?? 1);
      const [min, max] = rules.evolutionScale;
      if (ratio < min - 1e-9 || ratio > max + 1e-9) {
        report(
          [table, j, 'visual', 'size'],
          `an evolution is ×${min}–${max} the size of ${s.id}, not ×${ratio.toFixed(2)}`,
        );
      }
      const before = new Set(s.visual.parts);
      const grows = partsOf(into.visual, registry).some(
        (p) => !surface.has(p.slot) && !before.has(p.id),
      );
      if (!grows) {
        report(
          [table, j, 'visual', 'parts'],
          `an evolution adds a new sticking-out part to ${s.id}'s silhouette`,
        );
      }
    }
  }

  const seen = new Map<string, { id: string; line: string }>();
  species.forEach((s, i) => {
    const key = [
      s.visual.body,
      dominantPart(s.visual, registry),
      hueFamily(s.visual.palette[0] ?? '#ffffff'),
    ].join(' + ');
    const mine = rootOf(s.id);
    const other = seen.get(key);
    if (other && other.line !== mine) {
      report(
        [table, i, 'visual'],
        `${s.id} and ${other.id} share body + dominant part + hue family (${key})`,
      );
    }
    if (!other) seen.set(key, { id: s.id, line: mine });
  });
}
