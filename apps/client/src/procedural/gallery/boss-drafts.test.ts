import {
  ART_RULES,
  BODIES,
  BodySchema,
  checkRosterArt,
  checkSpeciesArt,
  checkSpeciesVisual,
  PARTS,
  PartSchema,
  SPECIES,
  SpeciesVisualSchema,
  visualRegistry,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  DRAFT_BODIES,
  DRAFT_BOSS_LINES,
  DRAFT_PARTS,
  DRAFT_PREFIX,
  draftLooks,
} from './boss-drafts.js';

const registry = visualRegistry({
  bodies: [...BODIES, ...DRAFT_BODIES],
  parts: [...PARTS, ...DRAFT_PARTS],
});
const forms = DRAFT_BOSS_LINES.flatMap((line) =>
  line.forms.map((form, i) => ({
    id: form.id,
    name: form.name,
    element: line.element,
    feeling: line.feeling,
    rarity: form.plannedRarity,
    visual: form.visual,
    evolutions: line.forms[i + 1] ? [{ into: line.forms[i + 1]!.id }] : [],
  })),
);

describe('the #234 mini-boss drafts', () => {
  it('stays out of the shipped data', () => {
    const ids = [...DRAFT_BODIES, ...DRAFT_PARTS, ...forms].map((x) => x.id);
    for (const id of ids) expect(id.startsWith(DRAFT_PREFIX), id).toBe(true);
    const shipped = new Set([...SPECIES, ...BODIES, ...PARTS].map((x) => x.id));
    expect(ids.filter((id) => shipped.has(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('validates against the shared schemas (with the #234 kit extension)', () => {
    for (const b of DRAFT_BODIES) expect(BodySchema.safeParse(b).success, b.id).toBe(true);
    for (const p of DRAFT_PARTS) expect(PartSchema.safeParse(p).success, p.id).toBe(true);
    for (const f of forms) {
      expect(SpeciesVisualSchema.safeParse(f.visual).success, f.id).toBe(true);
    }
  });

  it('builds every form as a squishy could be built, within the art rules', () => {
    const problems: string[] = [];
    const report = (path: readonly (string | number)[], message: string) => {
      problems.push(`${path.join('.')}: ${message}`);
    };
    for (const f of forms) {
      expect(f.visual.parts.length, f.id).toBeLessThanOrEqual(12);
      checkSpeciesVisual(f.visual, registry, [f.id], report);
      checkSpeciesArt(f, registry, ART_RULES, [f.id], report);
    }
    // Evolution growth, a new sticking-out part per step, and no line sharing
    // body + dominant part + hue family with the roster.
    checkRosterArt('drafts', [...SPECIES, ...forms], registry, ART_RULES, report);
    expect(problems).toEqual([]);
  });

  it('plans three stages per line: legendary base and middle, mythic boss', () => {
    expect(DRAFT_BOSS_LINES.map((l) => l.key)).toEqual(['rakelet', 'mom', 'dad', 'rickeyride']);
    for (const line of DRAFT_BOSS_LINES) {
      expect(line.forms.map((f) => [f.stage, f.plannedRarity])).toEqual([
        ['base', 'legendary'],
        ['middle', 'legendary'],
        ['boss', 'mythic'],
      ]);
    }
    expect(new Set(DRAFT_BOSS_LINES.map((l) => l.element)).size).toBe(4);
  });

  it('gives every form a name no shipped species has', () => {
    const names = new Set(SPECIES.map((s) => s.name.toLowerCase()));
    expect(forms.filter((f) => names.has(f.name.toLowerCase())).map((f) => f.name)).toEqual([]);
  });

  it('shows every form in the gallery', () => {
    expect(draftLooks().map((l) => l.id)).toEqual(forms.map((f) => f.id));
  });

  it('gives Rakelet no handle at any stage: its mouth is the rake', () => {
    const rakelet = DRAFT_BOSS_LINES[0]!.forms;
    for (const f of rakelet) {
      expect(
        f.visual.parts.filter((id) => /handle|caps/.test(id)),
        f.id,
      ).toEqual([]);
      const mouth = f.visual.parts.map((id) => registry.parts.get(id)!).filter((p) => p.replaces);
      expect(
        mouth.map((p) => p.shape),
        f.id,
      ).toEqual(['box']);
      const tines = f.visual.parts
        .map((id) => registry.parts.get(id)!)
        .find((p) => p.slot === 'fangs');
      // Hooked metal tines off the bar's front face, 3, 4 and 5 by stage (round 11).
      expect([tines?.shape, tines?.color, tines?.anchor], f.id).toEqual(['bent', 'metal', 'front']);
    }
    expect(
      rakelet.map((f) => {
        const tines = f.visual.parts
          .map((id) => registry.parts.get(id)!)
          .find((p) => p.slot === 'fangs');
        return tines?.layout.kind === 'ring' ? tines.layout.count : 0;
      }),
    ).toEqual([3, 4, 5]);
  });
});
