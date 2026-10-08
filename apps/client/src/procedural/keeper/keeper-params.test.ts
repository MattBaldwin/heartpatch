import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import {
  CLOTHING,
  defaultKeeperConfig,
  isKeeperClothing,
  KEEPER_DATA,
  STARTER_CLOTHING,
  WARDROBE_SLOTS,
  type KeeperConfig,
  type WardrobeSlot,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { hexToRgb } from '../params.js';
import { KEEPER } from './keeper-config.js';
import { keeperItems } from './keeper-items.js';
import { keeperHash, keeperParams, type KeeperParams, type KeeperPiece } from './keeper-params.js';

const BASES = KEEPER_DATA.bases;
/** The starter set: one item in every slot but costume (and a squishy bow, skipped). */
const ALL_BUT_COSTUME = keeperItems(STARTER_CLOTHING);
const itemFor = (slot: WardrobeSlot) => ALL_BUT_COSTUME.filter((i) => i.slot === slot);
const GHOST_SHEET = keeperItems(['ghost-sheet']);
/** Costume sockets that are mirrored pairs (#261). */
const PAIRED = new Set(['shoes', 'legs', 'arms', 'hands']);
const SLIPPERS = hexToRgb('#ffb84d');

/**
 * Same config as `GOLDEN_CONFIG` in tests/e2e/keeper-gallery.spec.ts. This
 * pins the hash in Node (V8); that test checks it in the browser under test,
 * proving every engine builds the same Keeper.
 */
const GOLDEN_CONFIG: KeeperConfig = {
  base: 'wren',
  hairColor: 'mint',
  eyeColor: 'violet',
  outfit: 'pumpkin',
};

const piecesOf = (p: KeeperParams, layer: KeeperPiece['layer']) =>
  p.pieces.filter((piece) => piece.layer === layer);
const head = (p: KeeperParams) => {
  // The head is the body layer's biggest ellipsoid.
  const heads = piecesOf(p, 'body').filter((piece) => piece.shape === 'ellipsoid');
  return heads.reduce((a, b) => (b.size[1] > a.size[1] ? b : a));
};
const lowest = (pieces: readonly KeeperPiece[]) =>
  Math.min(...pieces.map((piece) => piece.at[1] - piece.size[1] / 2));
const highest = (pieces: readonly KeeperPiece[]) =>
  Math.max(...pieces.map((piece) => piece.at[1] + piece.size[1] / 2));

describe('keeperParams', () => {
  it('is the same Keeper every time for the same config', () => {
    for (const base of BASES) {
      const config = defaultKeeperConfig(base);
      expect(keeperParams(config, KEEPER_DATA)).toEqual(keeperParams(config, KEEPER_DATA));
    }
  });

  it('changes with every pick: base, hair, eyes, outfit', () => {
    const config = defaultKeeperConfig(BASES[0]!);
    const hash = (c: KeeperConfig) => keeperHash(keeperParams(c, KEEPER_DATA));
    const variants = [
      config,
      { ...config, base: 'clover' },
      { ...config, hairColor: 'lilac' },
      { ...config, eyeColor: 'violet' },
      { ...config, outfit: 'meadow' },
    ];
    expect(new Set(variants.map(hash)).size).toBe(variants.length);
  });

  it('builds every base with a face, hair, outfit and positive sizes', () => {
    for (const base of BASES) {
      const p = keeperParams(defaultKeeperConfig(base), KEEPER_DATA);
      expect(p.missing).toEqual([]);
      for (const layer of ['body', 'face', 'hair', 'outfit'] as const) {
        expect(piecesOf(p, layer).length, `${base.id} ${layer}`).toBeGreaterThan(0);
      }
      for (const piece of p.pieces) for (const v of piece.size) expect(v).toBeGreaterThan(0);
      // Feet on the ground, hair on top, nothing below the floor.
      expect(lowest(p.pieces)).toBeGreaterThanOrEqual(-1e-9);
      expect(lowest(p.pieces)).toBeLessThan(0.01);
      expect(highest(p.pieces)).toBeCloseTo(p.height, 0);
      // The face looks towards the camera (−z), in front of the head's middle.
      for (const feature of piecesOf(p, 'face')) expect(feature.at[2]).toBeLessThan(head(p).at[2]);
    }
  });

  it('draws the same line face on every Keeper: no coloured mouth or blush (#289)', () => {
    const line = hexToRgb(KEEPER.colors.faceLine).join();
    const white = hexToRgb(KEEPER.colors.white).join();
    for (const base of BASES) {
      for (const eyeColor of KEEPER_DATA.eyeColors) {
        const p = keeperParams(
          { ...defaultKeeperConfig(base), eyeColor: eyeColor.id },
          KEEPER_DATA,
        );
        const eye = hexToRgb(eyeColor.color).join();
        const face = piecesOf(p, 'face');
        // Every face piece is a drawn line, an eye or a glint; nothing else.
        for (const piece of face) expect([line, eye, white]).toContain(piece.color.join());
        // Exactly two brows, a nose and a smile.
        const lines = face.filter((piece) => piece.color.join() === line);
        expect(lines.length, base.id).toBe(4);
        // The picked eye colour always shows, whatever the eye shape.
        expect(
          face.some((piece) => piece.color.join() === eye),
          base.id,
        ).toBe(true);
      }
    }
  });

  it('never hides the brows under the hair, for any base, style or hair colour (#289)', () => {
    // The hair is seeded by the colours, so check every hair colour. Each
    // brow is sampled along its length; a sample shows when a ray from it
    // towards the camera (−z) misses every hair ellipsoid.
    const DEG = Math.PI / 180;
    const matrixOf = (piece: KeeperPiece) =>
      Matrix.Compose(
        new Vector3(...piece.size),
        Quaternion.RotationYawPitchRoll(
          piece.turn[1] * DEG,
          piece.turn[0] * DEG,
          piece.turn[2] * DEG,
        ),
        new Vector3(...piece.at),
      );
    const line = hexToRgb(KEEPER.colors.faceLine).join();
    const towardsCamera = new Vector3(0, 0, -1);
    const hidden: string[] = [];
    for (const base of BASES) {
      for (const style of KEEPER_DATA.hairstyles) {
        for (const hairColor of KEEPER_DATA.hairColors) {
          const config = {
            ...defaultKeeperConfig(base),
            hairstyle: style.id,
            hairColor: hairColor.id,
          };
          const p = keeperParams(config, KEEPER_DATA);
          const hair = piecesOf(p, 'hair')
            .filter((piece) => piece.shape === 'ellipsoid')
            .map((piece) => matrixOf(piece).invert());
          // The first two lines are the brows (then the nose and the smile).
          const brows = piecesOf(p, 'face').filter((piece) => piece.color.join() === line);
          for (const brow of brows.slice(0, 2)) {
            const m = matrixOf(brow);
            let shown = 0;
            for (const x of [-0.35, -0.175, 0, 0.175, 0.35]) {
              const from = Vector3.TransformCoordinates(new Vector3(x, 0, 0), m);
              const blocked = hair.some((inverse) => {
                // Ray against the unit-diameter sphere in the ellipsoid's own space.
                const o = Vector3.TransformCoordinates(from, inverse);
                const d = Vector3.TransformNormal(towardsCamera, inverse);
                const a = Vector3.Dot(d, d);
                const b = 2 * Vector3.Dot(o, d);
                const c = Vector3.Dot(o, o) - 0.25;
                const disc = b * b - 4 * a * c;
                return c < 0 || (disc >= 0 && (-b + Math.sqrt(disc)) / (2 * a) > 0 && -b > 0);
              });
              if (!blocked) shown++;
            }
            if (shown < 3) hidden.push(`${base.id}/${style.id}/${hairColor.id}`);
          }
        }
      }
    }
    expect(hidden).toEqual([]);
  });

  it('uses the picked colours for hair, eyes and outfit', () => {
    const config: KeeperConfig = {
      base: 'pip',
      hairColor: 'mint',
      eyeColor: 'violet',
      outfit: 'meadow',
    };
    const p = keeperParams(config, KEEPER_DATA);
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mint = rgb(KEEPER_DATA.hairColors.find((c) => c.id === 'mint')!.color);
    const violet = rgb(KEEPER_DATA.eyeColors.find((c) => c.id === 'violet')!.color);
    const meadow = KEEPER_DATA.outfits.find((o) => o.id === 'meadow')!;
    expect(piecesOf(p, 'hair').every((piece) => piece.color.join() === mint.join())).toBe(true);
    expect(piecesOf(p, 'face').some((piece) => piece.color.join() === violet.join())).toBe(true);
    const outfitColors = new Set(piecesOf(p, 'outfit').map((piece) => piece.color.join()));
    for (const hex of [meadow.top, meadow.bottom, meadow.shoes]) {
      expect(outfitColors.has(rgb(hex).join())).toBe(true);
    }
  });

  it('draws an unknown id with the base’s own, and reports it', () => {
    const p = keeperParams(
      { base: 'robot', hairColor: 'plaid', eyeColor: 'laser', outfit: 'armor' },
      KEEPER_DATA,
    );
    expect(p.missing).toEqual(['robot', 'plaid', 'laser', 'armor']);
    expect(p.config.base).toBe('robot');
    expect(p.pieces.length).toBeGreaterThan(0);
  });

  it('wears any hairstyle on any base; the base’s own draws as it always did', () => {
    const pip = BASES[0]!;
    const own = keeperParams(defaultKeeperConfig(pip), KEEPER_DATA);
    // Picking the base's own style is the same Keeper as picking none.
    const same = keeperParams(
      { ...defaultKeeperConfig(pip), hairstyle: pip.hairstyle },
      KEEPER_DATA,
    );
    expect(same.pieces).toEqual(own.pieces);
    expect(same.sockets).toEqual(own.sockets);
    const hashes = new Set<string>();
    for (const style of KEEPER_DATA.hairstyles) {
      const p = keeperParams({ ...defaultKeeperConfig(pip), hairstyle: style.id }, KEEPER_DATA);
      expect(p.missing).toEqual([]);
      expect(piecesOf(p, 'hair')).toHaveLength(style.pieces.length);
      hashes.add(JSON.stringify(piecesOf(p, 'hair')));
      // Only the hair changes: same face and outfit.
      expect(piecesOf(p, 'face')).toEqual(piecesOf(own, 'face'));
      expect(piecesOf(p, 'outfit')).toEqual(piecesOf(own, 'outfit'));
    }
    expect(hashes.size).toBe(KEEPER_DATA.hairstyles.length);
  });

  it('draws an unknown hairstyle as the base’s own, and reports it', () => {
    const pip = BASES[0]!;
    const own = keeperParams(defaultKeeperConfig(pip), KEEPER_DATA);
    const p = keeperParams({ ...defaultKeeperConfig(pip), hairstyle: 'mohawk' }, KEEPER_DATA);
    expect(p.missing).toEqual(['mohawk']);
    expect(p.pieces).toEqual(own.pieces);
  });

  // Pinned so a change to the build (which would change every player's
  // Keeper) is a deliberate one. The e2e test checks the same hash in WebKit.
  it('keeps its build stable', () => {
    expect(keeperHash(keeperParams(GOLDEN_CONFIG, KEEPER_DATA))).toMatchInlineSnapshot(
      `"4c9ed66e81af00f0cc5379ce835aa96d"`,
    );
  });
});

describe('wardrobe sockets (design doc §23: everything fits every Keeper)', () => {
  it('every base has a socket for every slot', () => {
    for (const base of BASES) {
      const p = keeperParams(defaultKeeperConfig(base), KEEPER_DATA);
      expect(Object.keys(p.sockets).toSorted()).toEqual([...WARDROBE_SLOTS].toSorted());
      for (const slot of WARDROBE_SLOTS) {
        expect(p.sockets[slot].slot).toBe(slot);
        expect(p.sockets[slot].anchors.length).toBe(slot === 'shoes' ? 2 : 1);
        for (const v of p.sockets[slot].size) expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('attaches the same item to every base, in the right place', () => {
    for (const base of BASES) {
      const bare = keeperParams(defaultKeeperConfig(base), KEEPER_DATA);
      const p = keeperParams(defaultKeeperConfig(base), KEEPER_DATA, ALL_BUT_COSTUME);
      const top = head(bare);
      const where = (slot: WardrobeSlot) => piecesOf(p, slot);
      expect(p.worn, base.id).toEqual(ALL_BUT_COSTUME.map((i) => i.id));
      for (const slot of WARDROBE_SLOTS.filter((s) => s !== 'costume')) {
        const pieces = where(slot);
        const item = itemFor(slot)[0]!;
        // Shoes go on both feet.
        const copies = slot === 'shoes' ? 2 : 1;
        expect(pieces.length, `${base.id} ${slot}`).toBe(item.pieces.length * copies);
      }
      // Hats sit on top of the hair, above the face.
      expect(lowest(where('hat'))).toBeGreaterThan(top.at[1]);
      expect(highest(where('hat'))).toBeGreaterThan(bare.height);
      // A hair accessory sits on the head, to one side.
      for (const piece of where('hair-accessory')) {
        expect(Math.abs(piece.at[1] - top.at[1])).toBeLessThan(top.size[1]);
        expect(piece.at[0]).toBeGreaterThan(0);
      }
      // Tops and bottoms around the body, below the head.
      expect(highest(where('top'))).toBeLessThan(top.at[1]);
      expect(highest(where('bottom'))).toBeLessThan(highest(where('top')));
      // Shoes on the ground, one on each foot.
      expect(lowest(where('shoes'))).toBeLessThan(0.05);
      expect(new Set(where('shoes').map((piece) => Math.sign(piece.at[0])))).toEqual(
        new Set([-1, 1]),
      );
      // Backpacks behind (+z), held items in the right hand (+x).
      for (const piece of where('back')) expect(piece.at[2]).toBeGreaterThan(0);
      for (const piece of where('held')) expect(piece.at[0]).toBeGreaterThan(0);
    }
  });

  it('sits hats and hair accessories on every hairstyle, on every base', () => {
    for (const base of BASES) {
      for (const style of KEEPER_DATA.hairstyles) {
        const config = { ...defaultKeeperConfig(base), hairstyle: style.id };
        const bare = keeperParams(config, KEEPER_DATA);
        const p = keeperParams(config, KEEPER_DATA, [
          ...itemFor('hat'),
          ...itemFor('hair-accessory'),
        ]);
        const top = head(bare);
        const at = `${base.id} ${style.id}`;
        // The hat rests on the hair: above the face, over the top of the head.
        expect(lowest(piecesOf(p, 'hat')), at).toBeGreaterThan(top.at[1]);
        expect(highest(piecesOf(p, 'hat')), at).toBeGreaterThan(bare.height);
        // At or above the top of the head (a crew cut's hat rests right on it).
        expect(bare.sockets.hat.anchors[0]![1], at).toBeGreaterThanOrEqual(
          top.at[1] + top.size[1] / 2 - 1e-9,
        );
        // Not floating: the hat socket is inside the hair's top.
        expect(bare.sockets.hat.anchors[0]![1], at).toBeLessThan(bare.height);
        for (const piece of piecesOf(p, 'hair-accessory')) {
          expect(Math.abs(piece.at[1] - top.at[1]), at).toBeLessThan(top.size[1]);
        }
      }
    }
  });

  it('scales items to the base: a bigger head gets a bigger hat', () => {
    const hatWidth = (id: string) => {
      const base = BASES.find((b) => b.id === id)!;
      const p = keeperParams(defaultKeeperConfig(base), KEEPER_DATA, itemFor('hat'));
      return Math.max(...piecesOf(p, 'hat').map((piece) => piece.size[0]));
    };
    // Pip's round head and spikes are wider than Hazel's long head and bun.
    expect(hatWidth('pip')).toBeGreaterThan(hatWidth('hazel'));
  });

  it('a costume covers the whole Keeper and hides the other items and the hair', () => {
    for (const base of BASES) {
      const p = keeperParams(defaultKeeperConfig(base), KEEPER_DATA, [
        ...ALL_BUT_COSTUME,
        ...GHOST_SHEET,
      ]);
      expect(p.worn).toEqual(['ghost-sheet']);
      expect(piecesOf(p, 'hat')).toEqual([]);
      expect(piecesOf(p, 'hair')).toEqual([]);
      const sheet = piecesOf(p, 'costume')[0]!;
      expect(sheet.size[1]).toBeGreaterThan(p.height);
      expect(sheet.size[0]).toBeGreaterThan(p.width);
    }
  });

  it('fits every catalog item on every base, near the Keeper (no body-type locks)', () => {
    for (const base of BASES) {
      const bare = keeperParams(defaultKeeperConfig(base), KEEPER_DATA);
      for (const item of CLOTHING.filter(isKeeperClothing)) {
        const p = keeperParams(defaultKeeperConfig(base), KEEPER_DATA, keeperItems([item.id]));
        const pieces = piecesOf(p, item.slot);
        // Shoes, and costume pieces on legs, arms, hands or shoes, come in mirrored pairs.
        const copies = item.visual.pieces.reduce(
          (n, piece) => n + (item.slot === 'shoes' || PAIRED.has(piece.on ?? 'costume') ? 2 : 1),
          0,
        );
        expect(pieces.length, `${base.id} ${item.id}`).toBe(copies);
        for (const piece of pieces) {
          // Inside a box around the Keeper: nothing floats off on a small or tall base.
          expect(Math.abs(piece.at[0]), `${base.id} ${item.id} x`).toBeLessThan(bare.width * 1.6);
          expect(piece.at[1], `${base.id} ${item.id} y`).toBeGreaterThan(-0.05);
          expect(piece.at[1], `${base.id} ${item.id} y`).toBeLessThan(bare.height * 1.5);
          expect(Math.abs(piece.at[2]), `${base.id} ${item.id} z`).toBeLessThan(bare.width * 1.6);
        }
      }
    }
  });

  it('puts head-to-toe costume pieces on the right body part of every base (#261)', () => {
    for (const base of BASES) {
      const p = keeperParams(
        defaultKeeperConfig(base),
        KEEPER_DATA,
        keeperItems(['zippy-hedgehog']),
      );
      const pieces = piecesOf(p, 'costume');
      const hood = pieces[0]!;
      // The orange slippers (`on: 'shoes'`), one per foot.
      const feet = pieces.filter((piece) => piece.color.join() === SLIPPERS.join());
      expect(hood.at[1], base.id).toBeGreaterThan(p.height * 0.45);
      expect(feet.length, base.id).toBe(2);
      for (const foot of feet) expect(foot.at[1], base.id).toBeLessThan(p.height * 0.15);
      expect(piecesOf(p, 'hair')).toEqual([]);
    }
  });

  it('gives costumes their rarity finish and glowing pieces their glow (#261)', () => {
    const base = BASES[0]!;
    const wearing = (id: string) =>
      piecesOf(keeperParams(defaultKeeperConfig(base), KEEPER_DATA, keeperItems([id])), 'costume');
    const hollow = wearing('hollow-man-costume');
    const eyes = hollow.filter((piece) => piece.glow);
    expect(eyes.length).toBeGreaterThanOrEqual(2);
    for (const eye of eyes) expect(eye.finish).toBeUndefined();
    for (const piece of hollow.filter((x) => !x.glow)) expect(piece.finish).toBe('shimmer');
    for (const piece of wearing('marigold-calavera')) expect(piece.finish).toBe('iridescent');
    for (const piece of wearing('zippy-hedgehog')) expect(piece.finish).toBe('sparkle');
    for (const piece of wearing('candy-corn-cutie')) expect(piece.finish).toBeUndefined();
    // Other clothing stays plain vinyl, however rare (owner, #261).
    const wings = keeperParams(defaultKeeperConfig(base), KEEPER_DATA, keeperItems(['bat-wings']));
    for (const piece of piecesOf(wings, 'back')) expect(piece.finish).toBeUndefined();
  });

  it('draws worn ids from the catalog, skipping ones this client does not know', () => {
    expect(keeperItems(['witch-hat', 'from-the-future', 'tiny-bow']).map((i) => i.id)).toEqual([
      'witch-hat',
    ]);
  });
});
