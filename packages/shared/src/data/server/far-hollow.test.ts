import { describe, expect, it } from 'vitest';
import { checkExploreFinds, type ExploreFindTable } from '../../schemas/data/explore-finds.js';
import { FarHollowSecretsSchema } from '../../schemas/data/far-hollow.js';
import { COMMUNITY_RULES } from '../communities.js';
import { EXPLORE_RULES } from '../explore.js';
import { GAME_DATA } from '../index.js';
import { RESOURCES } from '../resources.js';
import { EXPLORE_FINDS } from './explore-finds.js';
import { FAR_HOLLOW_SECRETS } from './far-hollow.js';
import { FAR_HOLLOW_FINDS, HOLLOWED_FINDS } from './hollowed-finds.js';
import { LORE_PAGES } from './lore-pages.js';

const share = (table: ExploreFindTable, joy = COMMUNITY_RULES.joyResource) => {
  const t = table.finds.reduce((a, f) => a + f.weight, 0);
  const h = table.finds.filter((f) => (f.items?.[joy] ?? 0) > 0).reduce((a, f) => a + f.weight, 0);
  return h / t;
};

describe('the far Hollow secrets (#306 PR 6)', () => {
  it('parse', () => {
    expect(FarHollowSecretsSchema.parse(FAR_HOLLOW_SECRETS)).toEqual(FAR_HOLLOW_SECRETS);
  });

  it('find Heartdust 4× as often as ordinary land, more than a grey village', () => {
    expect(FAR_HOLLOW_SECRETS.heartdustFindMultiplier).toBe(4);
    EXPLORE_FINDS.forEach((table, i) => {
      const far = FAR_HOLLOW_FINDS[i]!;
      expect(far.kind).toBe(table.kind);
      expect(share(far)).toBeCloseTo(Math.min(1, share(table) * 4), 10);
      expect(share(far)).toBeGreaterThanOrEqual(share(HOLLOWED_FINDS[i]!));
    });
    const pages = LORE_PAGES.map((p) => p.id);
    expect(checkExploreFinds(FAR_HOLLOW_FINDS, GAME_DATA, EXPLORE_RULES, pages)).toEqual([]);
  });

  it('guarantee pages an explore search grants, each once', () => {
    const { lorePages } = FAR_HOLLOW_SECRETS;
    expect(new Set(lorePages).size).toBe(lorePages.length);
    for (const id of lorePages) {
      const page = LORE_PAGES.find((p) => p.id === id);
      expect(page?.trigger.eventType).toBe('explore.searched');
      expect(page?.trigger.mapKinds).toContain('multiplayer');
    }
  });

  it('give a gift of real resources', () => {
    const resources = new Set(RESOURCES.map((r) => r.id));
    for (const id of Object.keys(FAR_HOLLOW_SECRETS.completionGift)) {
      expect(resources.has(id)).toBe(true);
    }
  });
});
