import { SURFACE_SLOTS, type Body, type Part, type Species } from '@heartpatch/shared';
import type { SquishySpecies } from '../params.js';

/**
 * What the dev gallery shows: every real species, then "showcase" looks that
 * put every body and every part in the registry on screen at least once,
 * so new registry entries can be judged before any species uses them.
 */

/** Pastel palettes for showcase looks (primary, secondary, accent). */
const PALETTES: readonly (readonly string[])[] = [
  ['#ffb3c7', '#fff4ea', '#ff7aa2'],
  ['#a9cdf7', '#eaf4ff', '#6f9fe0'],
  ['#ffe79a', '#fffaf0', '#f2a93b'],
  ['#a8e6c9', '#f0fff7', '#5bbf8f'],
  ['#cdb6f4', '#f7f0ff', '#9776d6'],
  ['#ffc9a3', '#fff6ee', '#f08a4b'],
  ['#ff9f43', '#ffe2c2', '#6ab04c'],
];

const FACE: ReadonlySet<string> = new Set(SURFACE_SLOTS.filter((s) => s !== 'pattern'));

function cycle<T>(items: readonly T[], i: number): T | undefined {
  return items.length === 0 ? undefined : items[i % items.length];
}

/** Round-robin across slots, so neighbours in the list are in different slots. */
function interleaveSlots(parts: readonly Part[]): Part[] {
  const bySlot = new Map<string, Part[]>();
  for (const p of parts) bySlot.set(p.slot, [...(bySlot.get(p.slot) ?? []), p]);
  const groups = [...bySlot.values()];
  const out: Part[] = [];
  for (let i = 0; out.length < parts.length; i++) {
    for (const group of groups) {
      const part = group[i];
      if (part) out.push(part);
    }
  }
  return out;
}

export function showcaseLooks(bodies: readonly Body[], parts: readonly Part[]): SquishySpecies[] {
  const eyes = parts.filter((p) => p.slot === 'eyes');
  const mouths = parts.filter((p) => p.slot === 'mouth');
  const cheeks = parts.filter((p) => p.slot === 'cheeks');
  const features = interleaveSlots(parts.filter((p) => !FACE.has(p.slot)));
  const count = Math.max(
    bodies.length,
    eyes.length,
    mouths.length,
    cheeks.length * 2,
    Math.ceil(features.length / 2),
  );
  const looks: SquishySpecies[] = [];
  for (let i = 0; i < count; i++) {
    const body = cycle(bodies, i);
    if (!body) break;
    const chosen: Part[] = [];
    const add = (part: Part | undefined) => {
      if (part && !chosen.some((p) => p.slot === part.slot)) chosen.push(part);
    };
    add(cycle(eyes, i));
    add(cycle(mouths, i));
    if (i % 2 === 0) add(cycle(cheeks, i / 2));
    // Two features each (ears, horns, crown…), stepping through the list so all appear.
    let picked = 0;
    for (let k = 0; k < features.length && picked < 2; k++) {
      const before = chosen.length;
      add(cycle(features, 2 * i + k));
      if (chosen.length > before) picked++;
    }
    looks.push({
      id: `showcase-${i + 1}`,
      visual: {
        body: body.id,
        palette: [...(cycle(PALETTES, i) ?? ['#ffb3c7'])],
        parts: chosen.map((p) => p.id),
      },
    });
  }
  return looks;
}

/** Real species first, then the showcase. */
export function galleryLooks(
  species: readonly Species[],
  bodies: readonly Body[],
  parts: readonly Part[],
): SquishySpecies[] {
  return [...species, ...showcaseLooks(bodies, parts)];
}
