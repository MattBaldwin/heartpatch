import {
  COMMUNITY_RULES,
  GAME_DATA,
  GAME_EVENTS,
  MAP_GEN,
  needMoreText,
  restoredNameIdeas,
  shortfall,
  type CommunityRules,
  type CommunityView,
  type MapMember,
  type RestoreProblem,
  type RestoreTileResponse,
  type WsEventMessage,
} from '@heartpatch/shared';
import { itemIcon } from '../inventory/item-icons.js';

// The restore sheet and the naming card's words (#306 PR 3, the plan's
// screens; copy follows docs/STYLE_GUIDE.md). Pure, so every case is
// unit-tested. Every number comes from the server's reply, which prices the
// piece from `COMMUNITY_RULES`: nothing here is a constant.

export const RESTORE_TEXT = {
  kicker: (name: string, restored: number, total: number) =>
    `${name.toUpperCase()} · ${String(restored)}/${String(total)} restored`,
  /** The square holds the kind's building; every other tile, its own little ruin. */
  squareTitle: (kind: string, emoji: string) => `Restore the ${kind} ${emoji}`,
  tileTitle: 'Restore this spot 🛠️',
  pieces: (done: number, needed: number) => `Pieces put back: ${String(done)} of ${String(needed)}`,
  helper: (who: string, n: number) =>
    `${who} put back ${String(n)} ${n === 1 ? 'piece' : 'pieces'}`,
  someone: 'A friend',
  cost: (item: string, n: number) => `${itemIcon(item)} ${nameOf(item)} × ${String(n)}`,
  have: (n: number) => `you have ${String(n)}`,
  note: 'Helpers get a thank-you 🎁 The last piece claims the tile!',
  lastPiece: 'The last piece! Whoever adds it claims this tile ✨',
  restore: 'Restore a piece 🛠️',
  working: 'Fixing it up… 🛠️',
  notNow: 'Not now',
  done: 'Done',
  problem: {
    won: 'This village is already restored! 🌈',
    restored: 'This spot is all fixed up! Try another grey tile 🛠️',
    night: 'Too spooky after dark! Come back in the morning 🌙',
    away: 'Claim land next to it to restore it!',
  } satisfies Record<RestoreProblem, string>,
  thanks: (gift: string) => `Thank you! ${gift} 🎁`,
  claimed: 'You restored it! This tile is yours ✨',
  // The full-restore moment, and naming the village.
  wonKicker: (name: string, total: number) =>
    `${name.toUpperCase()} · ${String(total)} of ${String(total)} restored ✨`,
  wonTitle: 'The joy is back! 🌈',
  wonLine: 'You brought this village back to life. What will you call it?',
  wonSeed: '🌱 A new Heart Seed! It and the tiles around it are yours for keeps.',
  later: 'Later',
  label: 'Its new name',
  placeholder: 'Type a name…',
  ideas: 'Name ideas',
  nameNote: 'Tap an idea, or type your own. Names are checked to keep the patch kind.',
  nameIt: 'Name it! ✨',
  naming: 'Naming… ✨',
} as const;

const nameOf = (item: string) => GAME_DATA.resources.find((r) => r.id === item)?.name ?? item;

/** "+2 Treats", for the thank-you line. */
export function giftLine(gift: Readonly<Record<string, number>>): string {
  return Object.entries(gift)
    .map(([id, n]) => `+${String(n)} ${itemIcon(id)} ${nameOf(id)}`)
    .join(', ');
}

/** One cost row: what, how many, how many I have, and whether that's enough. */
export interface CostRow {
  readonly label: string;
  readonly have: string;
  readonly short: boolean;
}

/** What the restore sheet shows for one tile, from the server's reply. */
export interface RestoreSheetWords {
  readonly kicker: string;
  readonly title: string;
  readonly pieces: string;
  readonly done: number;
  readonly needed: number;
  readonly helpers: readonly string[];
  readonly costs: readonly CostRow[];
  readonly note: string;
  /** Why "Restore a piece" waits (night, too far, short of something); null when it's open. */
  readonly blocked: string | null;
}

export function restoreSheetWords(
  sheet: RestoreTileResponse,
  members: readonly MapMember[],
  rules: CommunityRules = COMMUNITY_RULES,
): RestoreSheetWords {
  const { community: c, tile } = sheet;
  const square = tile.q === c.square.q && tile.r === c.square.r;
  const kind = rules.kinds.find((k) => k.id === c.kind);
  const short = shortfall(sheet.have, sheet.cost);
  const nameOfUser = (id: string) =>
    members.find((m) => m.user.id === id)?.user.username ?? RESTORE_TEXT.someone;
  return {
    kicker: RESTORE_TEXT.kicker(c.name, c.restored, c.tiles.length),
    title:
      square && kind ? RESTORE_TEXT.squareTitle(kind.name, kind.emoji) : RESTORE_TEXT.tileTitle,
    pieces: RESTORE_TEXT.pieces(tile.piecesDone, tile.piecesNeeded),
    done: tile.piecesDone,
    needed: tile.piecesNeeded,
    helpers: sheet.helpers
      .slice(0, 2)
      .map((h) => RESTORE_TEXT.helper(nameOfUser(h.userId), h.pieces)),
    costs: Object.entries(sheet.cost).map(([id, n]) => ({
      label: RESTORE_TEXT.cost(id, n),
      have: RESTORE_TEXT.have(sheet.have[id] ?? 0),
      short: (short[id] ?? 0) > 0,
    })),
    note: tile.piecesDone + 1 >= tile.piecesNeeded ? RESTORE_TEXT.lastPiece : RESTORE_TEXT.note,
    blocked:
      sheet.problem !== null
        ? RESTORE_TEXT.problem[sheet.problem]
        : Object.keys(short).length > 0
          ? needMoreText(short, GAME_DATA.resources)
          : null,
  };
}

/** The naming card's three tap-to-fill ideas for a won village. */
export function villageNameIdeas(c: Pick<CommunityView, 'name'>): string[] {
  return restoredNameIdeas(c.name, COMMUNITY_RULES, MAP_GEN.communities);
}

/**
 * A village I just won somewhere other than the restore sheet (#306 PR 4: its
 * last tile won in a battle, settled a moment later on the server): the
 * village as the joy card shows it. Null for anyone else's win, a village
 * the view doesn't have, or a gap planted in a village that was mine already:
 * that ring is the one tile, never the square (a win plants the square with
 * the rest). The view can't tell: the capture's resync may already show it won.
 */
export function wonElsewhere(
  event: WsEventMessage,
  me: string | null,
  communities: readonly CommunityView[],
): CommunityView | null {
  if (event.type !== 'community.restored' || me === null) return null;
  const parsed = GAME_EVENTS['community.restored'].public.safeParse(event.data);
  if (!parsed.success || parsed.data.userId !== me) return null;
  const { ring, square, communityId, name } = parsed.data;
  const [only] = ring;
  if (ring.length === 1 && only && (only.q !== square.q || only.r !== square.r)) return null;
  const c = communities.find((v) => v.id === communityId);
  if (!c) return null;
  return { ...c, name, ownerUserId: me, named: false };
}
