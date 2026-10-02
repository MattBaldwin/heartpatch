import { describe, expect, it } from 'vitest';
import { scanPlayerFacingText } from '../../data/avoided-words.js';
import { KEEPER_DATA } from '../../data/keepers.js';
import { MapMemberSchema } from '../maps.js';
import {
  checkKeeperData,
  defaultKeeperConfig,
  KeeperConfigSchema,
  keeperConfigProblem,
  WARDROBE_SLOTS,
  type KeeperData,
} from './keepers.js';

const copy = (): KeeperData => structuredClone(KEEPER_DATA);

describe('checkKeeperData', () => {
  it('accepts the shipped Keepers', () => {
    expect(checkKeeperData(KEEPER_DATA)).toEqual([]);
  });

  it('ships 8 bases and 6 outfit palettes (design doc §23 defaults)', () => {
    expect(KEEPER_DATA.bases).toHaveLength(8);
    expect(KEEPER_DATA.outfits).toHaveLength(6);
  });

  it('varies body shape, skin tone, face and hairstyle across the bases', () => {
    const distinct = (pick: (b: KeeperData['bases'][number]) => unknown) =>
      new Set(KEEPER_DATA.bases.map((b) => JSON.stringify(pick(b)))).size;
    expect(distinct((b) => b.skin)).toBe(8);
    expect(distinct((b) => b.hairstyle)).toBe(8);
    expect(distinct((b) => b.body)).toBe(8);
    expect(distinct((b) => b.face)).toBeGreaterThanOrEqual(6);
    const heights = KEEPER_DATA.bases.map((b) => b.body.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.2);
  });

  it('reports unknown starting colours and duplicate ids by name', () => {
    const data = copy();
    data.bases[0]!.hairColor = 'rainbow';
    data.bases[1]!.outfit = 'tuxedo';
    data.eyeColors.push({ ...data.eyeColors[0]! });
    expect(checkKeeperData(data)).toEqual([
      'eyeColors["cocoa"].id: duplicate id "cocoa"',
      'bases["pip"].hairColor: unknown hair colour "rainbow"',
      'bases["clover"].outfit: unknown outfit "tuxedo"',
    ]);
  });

  it('keeps shapes inside the chibi ranges', () => {
    const data = copy();
    data.bases[0]!.body.head = 0.9;
    expect(checkKeeperData(data)).toEqual([
      'bases["pip"].body.head: Too big: expected number to be <=0.6',
    ]);
  });

  it('has no avoided words in names (style guide §9)', () => {
    expect(scanPlayerFacingText(KEEPER_DATA, 'KEEPER_DATA')).toEqual([]);
  });
});

describe('Keeper configs', () => {
  const pip = KEEPER_DATA.bases[0]!;

  it('every base starts with a config the data knows', () => {
    for (const base of KEEPER_DATA.bases) {
      expect(keeperConfigProblem(defaultKeeperConfig(base), KEEPER_DATA)).toBeNull();
    }
  });

  it('names the first unknown id', () => {
    const ok = defaultKeeperConfig(pip);
    expect(keeperConfigProblem({ ...ok, base: 'nobody' }, KEEPER_DATA)).toBe('base');
    expect(keeperConfigProblem({ ...ok, hairColor: 'plaid' }, KEEPER_DATA)).toBe('hairColor');
    expect(keeperConfigProblem({ ...ok, eyeColor: 'laser' }, KEEPER_DATA)).toBe('eyeColor');
    expect(keeperConfigProblem({ ...ok, outfit: 'armor' }, KEEPER_DATA)).toBe('outfit');
  });

  it('is a strict shape: no extra fields, ids only', () => {
    const ok = defaultKeeperConfig(pip);
    expect(KeeperConfigSchema.safeParse(ok).success).toBe(true);
    expect(KeeperConfigSchema.safeParse({ ...ok, hat: 'crown' }).success).toBe(false);
    expect(KeeperConfigSchema.safeParse({ ...ok, base: 'Not An Id' }).success).toBe(false);
  });

  it('rides on the public member view', () => {
    const member = {
      user: { id: '018f0000-0000-7000-8000-000000000001', username: 'pumpkin' },
      role: 'owner',
      homeSlot: 0,
      joinedAt: '2026-10-02T00:00:00.000Z',
    };
    // With what it wears (#43), so other players see outfits.
    const keeper = { ...defaultKeeperConfig(pip), wearing: ['sunny-cap', 'puddle-boots'] };
    expect(MapMemberSchema.parse({ ...member, keeper }).keeper).toEqual(keeper);
    expect(MapMemberSchema.safeParse({ ...member, keeper: defaultKeeperConfig(pip) }).success).toBe(
      false,
    );
    expect(MapMemberSchema.parse({ ...member, keeper: null }).keeper).toBeNull();
  });

  it('names the wardrobe slots #43 builds on (design doc §23)', () => {
    expect(WARDROBE_SLOTS).toEqual([
      'hat',
      'hair-accessory',
      'top',
      'bottom',
      'shoes',
      'back',
      'held',
      'costume',
    ]);
  });
});
