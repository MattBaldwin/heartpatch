import { describe, expect, it } from 'vitest';
import { checkGameData } from '../schemas/data/game-data.js';
import { CommunityKindIdSchema, CommunityRulesSchema } from '../schemas/data/communities.js';
import { MapGenSettingsSchema } from '../schemas/data/map-gen.js';
import { findAvoidedWords } from './avoided-words.js';
import { COMMUNITY_RULES } from './communities.js';
import { GAME_DATA } from './index.js';
import { MAP_GEN } from './map-gen.js';
import { RESOURCES } from './resources.js';

describe('COMMUNITY_RULES (#306)', () => {
  it('parses, and so does MAP_GEN with its village placement', () => {
    expect(CommunityRulesSchema.parse(COMMUNITY_RULES)).toEqual(COMMUNITY_RULES);
    expect(MapGenSettingsSchema.parse(MAP_GEN)).toEqual(MAP_GEN);
    expect(checkGameData(GAME_DATA)).toEqual([]);
  });

  it('has one row per village kind', () => {
    expect(COMMUNITY_RULES.kinds.map((k) => k.id)).toEqual(CommunityKindIdSchema.options);
  });

  it('prices every village size the map can make, in real resources', () => {
    const { size } = MAP_GEN.communities;
    for (let n = size.min; n <= size.max; n++) {
      expect(COMMUNITY_RULES.piecesBySize[String(n)]).toBeGreaterThan(0);
    }
    expect(COMMUNITY_RULES.pieceCost['default']).toBeDefined();
    const resources = new Set(RESOURCES.map((r) => r.id));
    for (const cost of Object.values(COMMUNITY_RULES.pieceCost)) {
      for (const id of Object.keys(cost)) expect(resources.has(id)).toBe(true);
    }
    expect(resources.has(COMMUNITY_RULES.joyResource)).toBe(true);
  });

  it('keeps every village name and kind kid-friendly', () => {
    const { nameStems, nameSuffix } = MAP_GEN.communities;
    for (const stem of nameStems) expect(findAvoidedWords(`${stem} ${nameSuffix}`)).toEqual([]);
    for (const kind of COMMUNITY_RULES.kinds) {
      expect(findAvoidedWords(`${kind.name} ${kind.perk}`)).toEqual([]);
    }
  });
});
