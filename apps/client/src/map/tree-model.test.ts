import { PATCH_TREE } from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import {
  decorate,
  heartsFor,
  HEARTS_MAX,
  STAR_AT,
  treeNotice,
  treeOf,
  TREE_TEXT,
} from './tree-model.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

describe('the Patch Tree model (#37 2d)', () => {
  it("mirrors the server's star count (it can't import it: rule 6)", () => {
    expect(STAR_AT).toBe(PATCH_TREE.starAt);
  });

  it("reads the server's tree, and nothing before it's planted", () => {
    expect(treeOf(null)).toBeNull();
    expect(treeOf({})).toBeNull();
    expect(treeOf({ christmas: { presentWaiting: false } })).toBeNull();
    const tree = { postIndex: 2, ornaments: 3, starLit: false };
    expect(treeOf({ christmas: { presentWaiting: false, tree } })).toEqual(tree);
  });

  it('takes the new total and star from a decoration, and plants a tree it lacked', () => {
    expect(decorate(null, { postIndex: 1, ornaments: 1, starLit: false })).toEqual({
      postIndex: 1,
      ornaments: 1,
      starLit: false,
    });
    const tree = { postIndex: 1, ornaments: 5, starLit: false };
    expect(decorate(tree, { postIndex: 1, ornaments: 7, starLit: false })).toEqual({
      ...tree,
      ornaments: 7,
    });
    expect(decorate(tree, { postIndex: 1, ornaments: 12, starLit: true }).starLit).toBe(true);
  });

  it('never counts down or puts the star out for a late event', () => {
    const lit = { postIndex: 1, ornaments: 14, starLit: true };
    expect(decorate(lit, { postIndex: 1, ornaments: 12, starLit: false })).toEqual(lit);
  });

  it('says an ornament went up, with how many light the star, and never who gave it', () => {
    const before = { postIndex: 0, ornaments: 5, starLit: false };
    const one = treeNotice(before, { ...before, ornaments: 6 });
    expect(one).toBe(`${TREE_TEXT.ornament} ${TREE_TEXT.toGo(PATCH_TREE.starAt - 6)}`);
    expect(treeNotice(before, { ...before, ornaments: 7 })).toContain('2 ornaments went up');
    expect(treeNotice(before, { ...before, ornaments: 12, starLit: true })).toBe(TREE_TEXT.starLit);
    // Past the star: just the ornament.
    const lit = { postIndex: 0, ornaments: 13, starLit: true };
    expect(treeNotice(lit, { ...lit, ornaments: 14 })).toBe(TREE_TEXT.ornament);
    // Nothing new: nothing said.
    expect(treeNotice(before, before)).toBeNull();
    expect(treeNotice(before, null)).toBeNull();
    // Kid safety: the words never carry a name.
    for (const line of Object.values(TREE_TEXT)) {
      const text = typeof line === 'string' ? line : line(3);
      expect(text).not.toMatch(/gave|from|to you/i);
    }
  });

  it('shows hearts for my warmth with a patch-mate, capped, and none on my own card', () => {
    const warmth = [
      { userId: A, warmth: 2 },
      { userId: B, warmth: 40 },
    ];
    expect(heartsFor(warmth, A, B)).toBe(2);
    expect(heartsFor(warmth, B, A)).toBe(HEARTS_MAX);
    expect(heartsFor(warmth, A, A)).toBe(0);
    expect(heartsFor([], A, B)).toBe(0);
    expect(heartsFor(undefined, A, B)).toBe(0);
  });
});
