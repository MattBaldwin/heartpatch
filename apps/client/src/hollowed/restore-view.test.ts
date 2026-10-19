import {
  COMMUNITY_RULES,
  pieceCost,
  type MapMember,
  type RestoreTileResponse,
} from '@heartpatch/shared';
import { describe, expect, it } from 'vitest';
import { RESTORE_TEXT, giftLine, restoreSheetWords, villageNameIdeas } from './restore-view.js';

const ME = '00000000-0000-4000-8000-000000000001';
const MIA = '00000000-0000-4000-8000-000000000002';
const members = [
  { user: { id: MIA, username: 'Mia' } },
  { user: { id: ME, username: 'Sam' } },
] as unknown as MapMember[];

const sheet = (over: Partial<RestoreTileResponse> = {}): RestoreTileResponse => ({
  community: {
    id: '00000000-0000-4000-8000-0000000000aa',
    name: 'Bramble Hollow',
    kind: 'old-well',
    square: { q: 4, r: -2 },
    tiles: [
      { q: 4, r: -2 },
      { q: 3, r: -2 },
      { q: 4, r: -3 },
      { q: 5, r: -2 },
      { q: 5, r: -3 },
    ],
    restored: 1,
    ownerUserId: null,
    reach: 'touching',
    distance: null,
  },
  tile: { q: 3, r: -2, piecesDone: 2, piecesNeeded: 4, restoredBy: null },
  cost: pieceCost('meadow', COMMUNITY_RULES),
  have: { timber: 14, stone: 9, heartdust: 3 },
  helpers: [{ userId: MIA, pieces: 2 }],
  problem: null,
  ...over,
});

describe('restoreSheetWords (#306 PR 3)', () => {
  it('shows the plan’s sheet from the server’s reply', () => {
    const words = restoreSheetWords(sheet(), 'meadow', members);
    expect(words.kicker).toBe('BRAMBLE HOLLOW · 1 of 5 tiles restored');
    expect(words.title).toBe('Restore this Meadow 🛠️');
    expect(words.pieces).toBe('Pieces put back: 2 of 4');
    expect(words.helpers).toEqual(['Mia put back 2 pieces']);
    expect(words.costs.map((c) => c.label)).toEqual([
      '🪵 Timber × 6',
      '🪨 Stone × 4',
      '💖 Heartdust × 1',
    ]);
    expect(words.costs.map((c) => c.have)).toEqual(['you have 14', 'you have 9', 'you have 3']);
    expect(words.note).toBe(RESTORE_TEXT.note);
    expect(words.blocked).toBeNull();
  });

  it('names the square’s building, from the village’s kind', () => {
    const words = restoreSheetWords(
      sheet({ tile: { q: 4, r: -2, piecesDone: 0, piecesNeeded: 4, restoredBy: null } }),
      'meadow',
      members,
    );
    expect(words.title).toBe('Restore the Old Well ⛲');
  });

  it('says when the next piece is the one that claims the tile', () => {
    const words = restoreSheetWords(
      sheet({ tile: { q: 3, r: -2, piecesDone: 3, piecesNeeded: 4, restoredBy: null } }),
      'meadow',
      members,
    );
    expect(words.note).toBe(RESTORE_TEXT.lastPiece);
  });

  it('says why the button waits: the server’s reason first, then what I’m short of', () => {
    expect(restoreSheetWords(sheet({ problem: 'night' }), 'meadow', members).blocked).toBe(
      RESTORE_TEXT.problem.night,
    );
    const short = restoreSheetWords(
      sheet({ have: { timber: 4, stone: 9, heartdust: 0 } }),
      'meadow',
      members,
    );
    expect(short.blocked).toBe('You need 2 more Timber and 1 more Heartdust first!');
    expect(short.costs.map((c) => c.short)).toEqual([true, false, true]);
  });

  it('thanks a helper with what they got', () => {
    expect(RESTORE_TEXT.thanks(giftLine({ treats: 2 }))).toMatch(/^Thank you! \+2 .* Treats 🎁$/);
  });

  it('offers three restored names that fit the name field', () => {
    for (const name of ['Bramble Hollow', 'Bramble Glen']) {
      const ideas = villageNameIdeas({ name });
      expect(ideas).toEqual(['Bramble Glen', 'Bramble Meadow', 'Bramble Hearth']);
    }
  });
});
