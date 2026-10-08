import {
  CLOTHING_BY_ID,
  GAME_DATA,
  heartSeedOf,
  hexDistance,
  isTradingPost,
  isTradableResource,
  jobOf,
  offerProblem,
  quickMessageById,
  sideProblem,
  TRADE_RULES,
  type OfferProblem,
  type OfferSide,
  type PickupRequest,
  type PostAtRequest,
  type PublicUser,
  type SendOfferRequest,
  type TradeLine,
  type TradeLineView,
  type TradeRules,
  type TradeShelf,
  type TradesView,
} from '@heartpatch/shared';
import type { Executor, Transaction } from '../../db/client.js';
import { appendGameEvent, type NewGameEvent } from '../../db/game-events.js';
import { AppError } from '../../lib/errors.js';
import type { Clock } from '../../lib/time.js';
import { consumeItems, grantItems, lockGrantRows } from '../inventory/service.js';
import { requirePostAccess } from '../journeys/service.js';
import { createMapsRepo } from '../maps/repo.js';
import { requireMember } from '../maps/members.js';
import { createSpawnsRepo } from '../spawns/repo.js';
import { createTerritoryRepo } from '../territory/repo.js';
import { createWardrobeRepo, WORN } from '../wardrobe/repo.js';
import {
  createTradesRepo,
  type LineRow,
  type MailboxRow,
  type OfferRow,
  type TradeSquishyRow,
  type TradesRepo,
} from './repo.js';

/*
 * Trades, gifts and the mailbox at the trading posts (#271; design doc §10,
 * owner decisions on #30). Patch-mates only. What a sender gives is held in
 * escrow the moment the offer goes: squishies wait `in-trade`, items leave
 * the bag into the offer (ledger `trade-escrow`), clothing is held for the
 * offer. A yes moves both sides in one transaction: the patch-mate's side
 * lands with them now, and the sender's side waits in the sender's mailbox
 * for them to pick up at any post they can visit. A no, a cancel, an expiry,
 * the owner turning trading off or a player leaving sends the held things
 * straight back (a `return` note in the mailbox says so).
 *
 * Lock order (tech spec §7): the sender's member row (step 2, a send only),
 * `outfits` (4), offers then mailbox rows (9b, id order), both players'
 * squishies in one id-ordered lock (10), clothing pieces (10b, id order),
 * inventory rows (11, `lockGrantRows`), `species_seen`, then `maps` last.
 */

// Kid-readable messages (style guide §6).
const MESSAGES = {
  tradingOff: 'Trading is taking a nap on this patch. Ask the patch owner!',
  notPatchMate: "We couldn't find that patch-mate.",
  self: "You can't trade with yourself, silly!",
  badNote: "We don't know that note. Pick one from the list!",
  tooManyOpen: (n: number) =>
    `You have ${String(n)} offers waiting already. Give them a little time!`,
  onePerPair: 'You already have an offer waiting with them. One at a time!',
  noOffer: "We couldn't find that offer.",
  answered: 'That offer was already answered.',
  ranOut: 'That offer ran out of time, so everything went home.',
  giftPickup: 'Gifts are picked up from your mailbox! 📬',
  notOwner: 'Only the patch owner can change that.',
  gone: "That patch-mate isn't on this patch any more.",
  noPost: "We couldn't find a trading post near your home.",
  problem: {
    empty: 'Pick something to give, and something to ask for!',
    'gift-wants': 'A gift is just for giving. Nothing to ask for back!',
    'too-many-lines': `That's a lot! Up to ${String(TRADE_RULES.linesPerSide)} things on each side.`,
    'too-many-squishies': `Up to ${String(TRADE_RULES.squishiesPerSide)} squishies on each side.`,
    twice: 'Something is on the list twice. Once is plenty!',
    'not-theirs': "Something on the list isn't there any more.",
    busy: 'A squishy on the list is busy. Only resting squishies can go!',
    starter: 'Your first squishy friend stays with you. 💛',
    'last-friend': 'Keep at least one squishy friend at home!',
    'not-tradable': "Something on the list can't be traded. It stays with its Keeper.",
  } satisfies Record<OfferProblem, string>,
} as const;

/** How many return notes the post screen shows. */
const RETURNS_SHOWN = 5; // TUNE:

const TRADABLE_ITEMS = new Set(GAME_DATA.resources.filter(isTradableResource).map((r) => r.id));
const PUBLIC_SPECIES = new Set(GAME_DATA.species.map((s) => s.id));

export interface TradesService {
  /** My open offers, my mailbox and recent returns (expires what's due first). */
  view: (user: PublicUser, mapId: string) => Promise<TradesView>;
  /**
   * What `targetUserId` could trade right now (me or a patch-mate), with
   * secret species I haven't met hidden. NOT_FOUND unless we're both members.
   */
  shelf: (user: PublicUser, mapId: string, targetUserId: string) => Promise<TradeShelf>;
  /**
   * Dev only (`HP_DEV_SQUISHY_GRANTS`; e2e and phone testing): claims the
   * neutral tiles on the straight way from my Heart Seed to the nearest
   * trading post, so my land reaches it. Returns the post. No events: the
   * map shows it when it next loads.
   */
  devConnect: (user: PublicUser, mapId: string) => Promise<{ q: number; r: number }>;
  /** Sends a trade offer or a gift at the post at (q, r); the give side goes into escrow. */
  send: (user: PublicUser, mapId: string, request: SendOfferRequest) => Promise<TradesView>;
  /** Says yes to a trade at the post at (q, r): both sides move now. */
  accept: (
    user: PublicUser,
    mapId: string,
    offerId: string,
    at: PostAtRequest,
  ) => Promise<TradesView>;
  /** Says no thanks (anywhere): the sender's things go back. */
  decline: (user: PublicUser, mapId: string, offerId: string) => Promise<TradesView>;
  /** The sender calls their offer off (anywhere): their things go back. */
  cancel: (user: PublicUser, mapId: string, offerId: string) => Promise<TradesView>;
  /** Picks up what waits in my mailbox at the post at (q, r): every entry, or `ids`. */
  pickup: (user: PublicUser, mapId: string, request: PickupRequest) => Promise<TradesView>;
  /** The patch owner's switch; off calls off every open offer. */
  setTrading: (user: PublicUser, mapId: string, on: boolean) => Promise<boolean>;
  /** A player left (or was removed): their open offers, both ways, go back. */
  memberLeft: (mapId: string, userId: string) => Promise<void>;
}

export interface TradesServiceOptions {
  db: Executor;
  clock?: Clock;
  /** Live sync (`wsHub.publish`), called after commit. Never rejects. */
  publish?: (mapId: string) => Promise<void>;
  /** Tests pass their own rules. */
  rules?: TradeRules;
}

type Counts = Record<string, number>;

/** Item lines as counts. */
const itemCounts = (lines: readonly TradeLine[]): Counts => {
  const counts: Counts = {};
  for (const line of lines) {
    if (line.kind === 'item') counts[line.itemId] = (counts[line.itemId] ?? 0) + line.quantity;
  }
  return counts;
};
const squishyIds = (lines: readonly TradeLine[]) =>
  lines.flatMap((l) => (l.kind === 'squishy' ? [l.squishyId] : []));
const pieceIds = (lines: readonly TradeLine[]) =>
  lines.flatMap((l) => (l.kind === 'clothing' ? [l.clothingId] : []));
const hasAny = (counts: Counts) => Object.keys(counts).length > 0;
const sortedIds = (ids: readonly string[]) => [...new Set(ids)].sort();

/** Appends events in `maps` id order (several maps' rows: id order, tech spec §7). */
async function appendAll(tx: Transaction, events: readonly NewGameEvent[]): Promise<string[]> {
  const ordered = events
    .map((event, i) => ({ event, i }))
    .sort((a, b) =>
      a.event.mapId === b.event.mapId ? a.i - b.i : a.event.mapId < b.event.mapId ? -1 : 1,
    );
  for (const { event } of ordered) await appendGameEvent(tx, event);
  return sortedIds(events.map((e) => e.mapId));
}

export function createTradesService(options: TradesServiceOptions): TradesService {
  const { db } = options;
  const now = options.clock ?? (() => new Date());
  const rules = options.rules ?? TRADE_RULES;
  const published = (mapIds: readonly string[]) => {
    for (const mapId of mapIds) void options.publish?.(mapId);
  };

  /** Runs `fn` in a transaction, appends its events last, then publishes. */
  const run = async <T>(
    fn: (tx: Transaction, events: NewGameEvent[]) => Promise<T>,
  ): Promise<T> => {
    const { result, mapIds } = await createTradesRepo(db).transaction(async (tx) => {
      const events: NewGameEvent[] = [];
      const result = await fn(tx, events);
      return { result, mapIds: await appendAll(tx, events) };
    });
    published(mapIds);
    return result;
  };

  /**
   * Takes these clothing items off the player when they have no free piece
   * of them left (a piece went into an offer or to a patch-mate): off their
   * Keeper (`outfit.changed` on each of their maps) and off their squishies.
   * The caller holds the player's `outfits` row (step 4) and their pieces.
   */
  const takeOffGone = async (
    tx: Transaction,
    userId: string,
    itemIds: readonly string[],
    events: NewGameEvent[],
  ) => {
    const repo = createTradesRepo(tx);
    const gone: string[] = [];
    for (const itemId of sortedIds(itemIds)) {
      if ((await repo.freePiecesOf(userId, itemId)) === 0) gone.push(itemId);
    }
    if (gone.length === 0) return;
    await repo.takeOffAccessories(userId, gone);
    const wardrobe = createWardrobeRepo(tx);
    const worn = (await wardrobe.lockWorn(userId))?.wearing ?? [];
    const wearing = worn.filter((id) => !gone.includes(id));
    if (wearing.length === worn.length) return;
    await wardrobe.saveOutfit(userId, { preset: WORN, name: null, wearing }, now());
    for (const mapId of await wardrobe.activeMapIds(userId)) {
      events.push({
        mapId,
        type: 'outfit.changed',
        actorUserId: userId,
        payload: { userId, wearing },
      });
    }
  };

  /**
   * Sends these offers' held things straight back to their senders, in one
   * go: squishies rest at home again, items back in the bag (`trade-return`),
   * clothing free, a gift's waiting mailbox row gone, a `return` note for
   * the sender. The caller has locked the offers (step 9b, id order); this
   * takes the rest in order. Returns nothing to append: the caller adds its
   * own events, one per offer.
   */
  const sendBack = async (
    tx: Transaction,
    offers: readonly OfferRow[],
    status: 'declined' | 'cancelled' | 'expired',
    actorUserId: string | null,
    at: Date,
  ) => {
    if (offers.length === 0) return;
    const repo = createTradesRepo(tx);
    const ids = offers.map((o) => o.id);
    const lines = await repo.linesOf(ids);
    const giveOf = (offerId: string) =>
      lines.filter((l) => l.offerId === offerId && l.side === 'give').map((l) => l.line);
    // Mailbox (step 9b, after the offers): a gift that waited goes.
    await repo.deleteWaitingFor(offers.filter((o) => o.kind === 'gift').map((o) => o.id));
    for (const offer of offers) {
      await repo.insertMailbox({
        mapId: offer.mapId,
        userId: offer.fromUserId,
        offerId: offer.id,
        kind: 'return',
        lines: giveOf(offer.id),
        readyAt: at,
        pickedUpAt: at,
      });
    }
    // Squishies (step 10), then clothing (10b), each in one id-ordered lock.
    const held = await repo.lockSquishies(offers.flatMap((o) => squishyIds(giveOf(o.id))));
    for (const offer of offers) {
      const mine = held.filter(
        (s) => s.ownerUserId === offer.fromUserId && squishyIds(giveOf(offer.id)).includes(s.id),
      );
      await repo.setSquishyState(
        mine.filter((s) => s.state === 'in-trade').map((s) => s.id),
        'active',
      );
    }
    const pieces = await repo.lockPieces(offers.flatMap((o) => pieceIds(giveOf(o.id))));
    for (const offer of offers) {
      const mine = pieces.filter((p) => p.heldByOfferId === offer.id).map((p) => p.id);
      await repo.movePieces(mine, offer.fromUserId, null);
    }
    // Inventory (step 11): every row first, then the grants.
    const grants = offers.map((o) => ({ userId: o.fromUserId, items: itemCounts(giveOf(o.id)) }));
    const [first] = offers;
    if (first) await lockGrantRows(tx, first.mapId, grants);
    for (const [i, offer] of offers.entries()) {
      const items = grants[i]?.items ?? {};
      if (hasAny(items)) {
        await grantItems(
          tx,
          { mapId: offer.mapId, userId: offer.fromUserId },
          items,
          'trade-return',
          offer.id,
        );
      }
    }
    await repo.setStatus(ids, status, at);
    for (const offer of offers) {
      await repo.ledger({ mapId: offer.mapId, offerId: offer.id, event: status, actorUserId, at });
    }
  };

  /**
   * Sends back every open offer on the map that's past its time, in its own
   * transaction (lazy expiry: commands and reads call it first).
   */
  const expireDue = async (mapId: string) => {
    const at = now();
    if ((await createTradesRepo(db).dueOfferIds(mapId, at)).length === 0) return;
    await run(async (tx, events) => {
      const due = await createTradesRepo(tx).lockOpenOffers(mapId, { expiredBy: at });
      await sendBack(tx, due, 'expired', null, at);
      for (const o of due) {
        events.push({
          mapId,
          type: 'trade.expired',
          actorUserId: null,
          payload: { offerId: o.id, fromUserId: o.fromUserId, toUserId: o.toUserId },
        });
      }
    });
  };

  /** One side as `offerProblem` sees it: the player's squishies, bag and pieces. */
  const sideOf = async (
    repo: TradesRepo,
    mapId: string,
    userId: string,
    locked: readonly TradeSquishyRow[] = [],
  ): Promise<OfferSide> => {
    const [all, items, pieces, starter] = await Promise.all([
      repo.squishiesOf(mapId, userId),
      repo.bagOf(mapId, userId),
      repo.piecesOf(userId),
      repo.starterOf(mapId, userId),
    ]);
    // What we hold locks on wins over the plain read.
    const fresh = new Map(locked.map((s) => [s.id, s]));
    return {
      squishies: all
        .map((s) => fresh.get(s.id) ?? s)
        .filter((s) => s.ownerUserId === userId)
        .map((s) => ({
          id: s.id,
          state: s.state,
          resting: jobOf(s) === 'resting',
          starter: s.id === starter,
        })),
      items,
      tradableItems: TRADABLE_ITEMS,
      clothing: pieces.map((p) => ({
        id: p.id,
        tradable: CLOTHING_BY_ID.get(p.itemId)?.tradable ?? false,
        held: p.heldByOfferId !== null,
      })),
    };
  };

  const refuse = (problem: OfferProblem | null) => {
    if (problem) throw new AppError('CONFLICT', MESSAGES.problem[problem]);
  };

  const requireTrading = async (repo: TradesRepo, mapId: string) => {
    if (!(await repo.tradingEnabled(mapId))) throw new AppError('CONFLICT', MESSAGES.tradingOff);
  };

  /** The offer, locked (step 9b), still open and in time. */
  const openOffer = async (tx: Transaction, mapId: string, offerId: string, at: Date) => {
    const [offer] = await createTradesRepo(tx).lockOffers([offerId]);
    if (offer?.mapId !== mapId) throw new AppError('NOT_FOUND', MESSAGES.noOffer);
    if (offer.status !== 'open') throw new AppError('CONFLICT', MESSAGES.answered);
    if (offer.expiresAt <= at) throw new AppError('CONFLICT', MESSAGES.ranOut);
    return offer;
  };

  // ---- the post screen ------------------------------------------------------

  /** Lines as the viewer sees them (a secret species they haven't met hides). */
  const viewLines = async (
    repo: TradesRepo,
    mapId: string,
    viewerId: string,
    lines: readonly TradeLine[],
  ): Promise<Map<TradeLine, TradeLineView | null>> => {
    const [pets, pieces, seen] = await Promise.all([
      repo.squishiesByIds(squishyIds(lines)),
      repo.piecesByIds(pieceIds(lines)),
      repo.seenOf(mapId, viewerId),
    ]);
    const petById = new Map(pets.map((p) => [p.id, p]));
    const pieceById = new Map(pieces.map((p) => [p.id, p]));
    const out = new Map<TradeLine, TradeLineView | null>();
    for (const line of lines) {
      if (line.kind === 'item') {
        out.set(line, line);
      } else if (line.kind === 'squishy') {
        const pet = petById.get(line.squishyId);
        const known = pet && (PUBLIC_SPECIES.has(pet.speciesId) || seen.has(pet.speciesId));
        out.set(
          line,
          pet
            ? {
                kind: 'squishy',
                squishyId: pet.id,
                speciesId: known ? pet.speciesId : null,
                level: pet.level,
                nickname: pet.nickname,
              }
            : null,
        );
      } else {
        const piece = pieceById.get(line.clothingId);
        out.set(
          line,
          piece ? { kind: 'clothing', clothingId: piece.id, itemId: piece.itemId } : null,
        );
      }
    }
    return out;
  };

  const viewOf = async (exec: Executor, mapId: string, userId: string): Promise<TradesView> => {
    const repo = createTradesRepo(exec);
    const [on, offers, waiting, returns] = await Promise.all([
      repo.tradingEnabled(mapId),
      repo.openOffersOf(mapId, userId),
      repo.waitingOf(mapId, userId),
      repo.returnsOf(mapId, userId, RETURNS_SHOWN),
    ]);
    const lines = await repo.linesOf(offers.map((o) => o.id));
    const all = [
      ...lines.map((l) => l.line),
      ...waiting.flatMap((m) => m.lines),
      ...returns.flatMap((m) => m.lines),
    ];
    const views = await viewLines(repo, mapId, userId, all);
    const shown = (list: readonly TradeLine[]) =>
      list.flatMap((l) => {
        const v = views.get(l);
        return v ? [v] : [];
      });
    const sideLines = (offerId: string, side: LineRow['side']) =>
      shown(lines.filter((l) => l.offerId === offerId && l.side === side).map((l) => l.line));
    const parties = await repo.offerParties([...waiting, ...returns].map((m) => m.offerId));
    const entry = (m: MailboxRow) => {
      const p = parties.get(m.offerId);
      return {
        id: m.id,
        offerId: m.offerId,
        kind: m.kind,
        // The patch-mate it came from; a return note is from me.
        fromUserId:
          m.kind === 'return' || !p
            ? m.userId
            : p.fromUserId === m.userId
              ? p.toUserId
              : p.fromUserId,
        lines: shown(m.lines),
        readyAt: m.readyAt.toISOString(),
        pickedUpAt: m.pickedUpAt?.toISOString() ?? null,
      };
    };
    return {
      tradingEnabled: on,
      offers: offers.map((o) => ({
        id: o.id,
        kind: o.kind,
        fromUserId: o.fromUserId,
        toUserId: o.toUserId,
        status: o.status,
        noteId: o.noteId,
        createdAt: o.createdAt.toISOString(),
        expiresAt: o.expiresAt.toISOString(),
        give: sideLines(o.id, 'give'),
        want: sideLines(o.id, 'want'),
      })),
      mailbox: waiting.map(entry),
      returns: returns.map(entry),
      now: now().toISOString(),
    };
  };

  const view = async (user: PublicUser, mapId: string) => {
    await requireMember(db, user, mapId);
    await expireDue(mapId);
    return viewOf(db, mapId, user.id);
  };

  const shelf = async (user: PublicUser, mapId: string, targetUserId: string) => {
    await requireMember(db, user, mapId);
    const repo = createTradesRepo(db);
    if (!(await repo.isActiveMember(mapId, targetUserId))) {
      throw new AppError('NOT_FOUND', MESSAGES.notPatchMate);
    }
    await expireDue(mapId);
    const [pets, bag, pieces, starter, seen] = await Promise.all([
      repo.squishiesOf(mapId, targetUserId),
      repo.bagOf(mapId, targetUserId),
      repo.piecesOf(targetUserId),
      repo.starterOf(mapId, targetUserId),
      repo.seenOf(mapId, user.id),
    ]);
    const known = (speciesId: string) => PUBLIC_SPECIES.has(speciesId) || seen.has(speciesId);
    return {
      userId: targetUserId,
      squishies: pets
        .filter((s) => s.state === 'active' && jobOf(s) === 'resting' && s.id !== starter)
        .map((s) => ({
          kind: 'squishy' as const,
          squishyId: s.id,
          speciesId: known(s.speciesId) ? s.speciesId : null,
          level: s.level,
          nickname: s.nickname,
        })),
      items: Object.entries(bag)
        .filter(([itemId, quantity]) => quantity > 0 && TRADABLE_ITEMS.has(itemId))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([itemId, quantity]) => ({ kind: 'item' as const, itemId, quantity })),
      clothing: pieces
        .filter((p) => p.heldByOfferId === null && CLOTHING_BY_ID.get(p.itemId)?.tradable === true)
        .map((p) => ({ kind: 'clothing' as const, clothingId: p.id, itemId: p.itemId })),
    };
  };

  const devConnect = async (user: PublicUser, mapId: string) => {
    await requireMember(db, user, mapId);
    const tiles = await createTerritoryRepo(db).listTiles(mapId);
    const seed = heartSeedOf(tiles.filter((t) => t.ownerUserId === user.id && t.homeSlot !== null));
    const [post] = tiles
      .filter(isTradingPost)
      .sort((a, b) => (seed ? hexDistance(seed, a) - hexDistance(seed, b) : 0));
    if (!seed || !post) throw new AppError('NOT_FOUND', MESSAGES.noPost);
    const reach = hexDistance(seed, post);
    const path = tiles.filter(
      (t) =>
        t.ownerUserId === null &&
        t.homeSlot === null &&
        !isTradingPost(t) &&
        hexDistance(seed, t) < reach &&
        hexDistance(t, post) + hexDistance(seed, t) === reach,
    );
    await createTradesRepo(db).devClaimTiles(
      mapId,
      path.map((t) => t.id),
      user.id,
    );
    return { q: post.q, r: post.r };
  };

  // ---- commands -------------------------------------------------------------

  const send = async (user: PublicUser, mapId: string, request: SendOfferRequest) => {
    await requireMember(db, user, mapId);
    await expireDue(mapId);
    const noteId = request.noteId ?? null;
    if (noteId !== null && !quickMessageById(noteId)) {
      throw new AppError('VALIDATION_FAILED', MESSAGES.badNote);
    }
    if (request.toUserId === user.id) throw new AppError('VALIDATION_FAILED', MESSAGES.self);
    await run(async (tx, events) => {
      const at = now();
      const repo = createTradesRepo(tx);
      await requireMember(tx, user, mapId);
      // One send at a time per player (step 2), so the open-offer limits hold.
      await createMapsRepo(tx).lockMember(mapId, user.id);
      await requireTrading(repo, mapId);
      if (!(await repo.isActiveMember(mapId, request.toUserId))) {
        throw new AppError('NOT_FOUND', MESSAGES.notPatchMate);
      }
      await requirePostAccess(tx, { mapId, userId: user.id, post: request, at });
      const open = await repo.openCounts(mapId, user.id, request.toUserId);
      if (open.toThem >= rules.openPerPair) throw new AppError('CONFLICT', MESSAGES.onePerPair);
      if (open.sent >= rules.openPerSender) {
        throw new AppError('CONFLICT', MESSAGES.tooManyOpen(open.sent));
      }
      const { give, want } = request;
      // A quick look first, so a bad offer is refused before any lock.
      refuse(
        offerProblem(
          { kind: request.kind, give, want },
          await sideOf(repo, mapId, user.id),
          await sideOf(repo, mapId, request.toUserId),
          rules,
        ),
      );

      const gifts = pieceIds(give);
      if (gifts.length > 0) await createWardrobeRepo(tx).lockWorn(user.id); // step 4
      const offer = await repo.insertOffer({
        mapId,
        kind: request.kind,
        fromUserId: user.id,
        toUserId: request.toUserId,
        noteId,
        createdAt: at,
        expiresAt: new Date(at.getTime() + rules.offerDays * 24 * 60 * 60_000),
      });
      await repo.insertLines(offer.id, 'give', give);
      await repo.insertLines(offer.id, 'want', want);
      if (request.kind === 'gift') {
        await repo.insertMailbox({
          mapId,
          userId: request.toUserId,
          offerId: offer.id,
          kind: 'gift',
          lines: give,
          readyAt: at,
        });
      }

      // Escrow, under locks, checked again with what the locks hold.
      const pets = await repo.lockSquishies(squishyIds(give)); // step 10
      const pieces = await repo.lockPieces(gifts); // step 10b
      refuse(sideProblem(give, await sideOf(repo, mapId, user.id, pets), rules));
      if (pieces.some((p) => p.userId !== user.id || p.heldByOfferId !== null)) {
        refuse('not-theirs');
      }
      await repo.setSquishyState(squishyIds(give), 'in-trade');
      await repo.movePieces(gifts, user.id, offer.id);
      await takeOffGone(
        tx,
        user.id,
        pieces.map((p) => p.itemId),
        events,
      );
      const items = itemCounts(give);
      if (hasAny(items)) {
        await consumeItems(tx, { mapId, userId: user.id }, items, 'trade-escrow', offer.id); // step 11
      }
      await repo.ledger({ mapId, offerId: offer.id, event: 'offered', actorUserId: user.id, at });
      events.push({
        mapId,
        type: 'trade.offered',
        actorUserId: user.id,
        payload: {
          offerId: offer.id,
          kind: request.kind,
          fromUserId: user.id,
          toUserId: request.toUserId,
          noteId,
          give,
          want,
        },
      });
    });
    return viewOf(db, mapId, user.id);
  };

  const accept = async (user: PublicUser, mapId: string, offerId: string, post: PostAtRequest) => {
    await requireMember(db, user, mapId);
    await expireDue(mapId);
    await run(async (tx, events) => {
      const at = now();
      const repo = createTradesRepo(tx);
      await requireMember(tx, user, mapId);
      await requireTrading(repo, mapId);
      await requirePostAccess(tx, { mapId, userId: user.id, post, at });
      const peek = (await repo.linesOf([offerId])).filter((l) => l.side === 'want');
      if (peek.some((l) => l.line.kind === 'clothing')) {
        await createWardrobeRepo(tx).lockWorn(user.id); // step 4
      }
      const offer = await openOffer(tx, mapId, offerId, at); // step 9b
      if (offer.toUserId !== user.id) throw new AppError('NOT_FOUND', MESSAGES.noOffer);
      if (offer.kind === 'gift') throw new AppError('CONFLICT', MESSAGES.giftPickup);
      if (!(await repo.isActiveMember(mapId, offer.fromUserId))) {
        throw new AppError('CONFLICT', MESSAGES.gone);
      }
      const lines = await repo.linesOf([offer.id]);
      const give = lines.filter((l) => l.side === 'give').map((l) => l.line);
      const want = lines.filter((l) => l.side === 'want').map((l) => l.line);

      // Both players' squishies in one id-ordered lock (step 10), then pieces (10b).
      const pets = await repo.lockSquishies([...squishyIds(give), ...squishyIds(want)]);
      const pieces = await repo.lockPieces([...pieceIds(give), ...pieceIds(want)]);
      // The want side is checked again now: the patch-mate may have changed.
      refuse(sideProblem(want, await sideOf(repo, mapId, user.id, pets), rules));
      const wantPieces = pieces.filter((p) => pieceIds(want).includes(p.id));
      if (wantPieces.some((p) => p.userId !== user.id || p.heldByOfferId !== null)) {
        refuse('not-theirs');
      }
      const heldPets = pets.filter((p) => squishyIds(give).includes(p.id));
      if (heldPets.some((p) => p.ownerUserId !== offer.fromUserId || p.state !== 'in-trade')) {
        throw new Error(`trades: offer ${offer.id} lost a held squishy`);
      }

      // The sender's side lands with me now.
      await repo.moveSquishies(squishyIds(give), user.id, 'active');
      await repo.movePieces(pieceIds(give), user.id, null);
      // My side goes to the sender's mailbox, held until they pick it up.
      await repo.moveSquishies(squishyIds(want), offer.fromUserId, 'in-trade');
      await repo.movePieces(pieceIds(want), offer.fromUserId, offer.id);
      await takeOffGone(
        tx,
        user.id,
        wantPieces.map((p) => p.itemId),
        events,
      );
      await repo.insertMailbox({
        mapId,
        userId: offer.fromUserId,
        offerId: offer.id,
        kind: 'trade',
        lines: want,
        readyAt: at,
      });

      // Inventory (step 11): both item sets' rows first.
      const got = itemCounts(give);
      const paid = itemCounts(want);
      await lockGrantRows(tx, mapId, [{ userId: user.id, items: { ...got, ...paid } }]);
      if (hasAny(paid)) {
        await consumeItems(tx, { mapId, userId: user.id }, paid, 'trade-escrow', offer.id);
      }
      if (hasAny(got)) await grantItems(tx, { mapId, userId: user.id }, got, 'trade', offer.id);
      const spawns = createSpawnsRepo(tx);
      for (const pet of heldPets) await spawns.markCaught(mapId, user.id, pet.speciesId, at);

      await repo.setStatus([offer.id], 'accepted', at);
      await repo.ledger({ mapId, offerId: offer.id, event: 'accepted', actorUserId: user.id, at });
      events.push({
        mapId,
        type: 'trade.answered',
        actorUserId: user.id,
        payload: {
          offerId: offer.id,
          kind: offer.kind,
          fromUserId: offer.fromUserId,
          toUserId: offer.toUserId,
          answer: 'accepted',
        },
      });
    });
    return viewOf(db, mapId, user.id);
  };

  /** Decline and cancel: the offer goes back, from anywhere (no post needed). */
  const answerNo = async (user: PublicUser, mapId: string, offerId: string, who: 'to' | 'from') => {
    await requireMember(db, user, mapId);
    await expireDue(mapId);
    await run(async (tx, events) => {
      const at = now();
      await requireMember(tx, user, mapId);
      const offer = await openOffer(tx, mapId, offerId, at);
      const mine = who === 'to' ? offer.toUserId : offer.fromUserId;
      if (mine !== user.id) throw new AppError('NOT_FOUND', MESSAGES.noOffer);
      await sendBack(tx, [offer], who === 'to' ? 'declined' : 'cancelled', user.id, at);
      const { fromUserId, toUserId } = offer;
      events.push(
        who === 'to'
          ? {
              mapId,
              type: 'trade.answered',
              actorUserId: user.id,
              payload: { offerId, kind: offer.kind, fromUserId, toUserId, answer: 'declined' },
            }
          : {
              mapId,
              type: 'trade.cancelled',
              actorUserId: user.id,
              payload: { offerId, fromUserId, toUserId, reason: 'cancelled' },
            },
      );
    });
    return viewOf(db, mapId, user.id);
  };

  const pickup = async (user: PublicUser, mapId: string, request: PickupRequest) => {
    await requireMember(db, user, mapId);
    await expireDue(mapId);
    await run(async (tx, events) => {
      const at = now();
      const repo = createTradesRepo(tx);
      await requireMember(tx, user, mapId);
      // Picking up works even with trading off: it's already mine.
      await requirePostAccess(tx, { mapId, userId: user.id, post: request, at });
      const tile = await createTerritoryRepo(tx).findTile(mapId, request.q, request.r);
      const peek = await repo.waitingOf(mapId, user.id);
      const wanted = request.ids ? peek.filter((m) => request.ids?.includes(m.id)) : peek;
      if (wanted.length === 0 || !tile) return;
      // Offers then mailbox rows (step 9b), each in id order.
      const offers = await repo.lockOffers(wanted.map((m) => m.offerId));
      const rows = (
        await repo.lockWaiting(
          mapId,
          user.id,
          wanted.map((m) => m.id),
        )
      ).filter(
        (m) => m.kind !== 'gift' || offers.find((o) => o.id === m.offerId)?.status === 'open',
      );
      if (rows.length === 0) return;
      const gifts = offers.filter((o) => o.kind === 'gift' && rows.some((m) => m.offerId === o.id));
      const lines = rows.flatMap((m) => m.lines);

      const pets = await repo.lockSquishies(squishyIds(lines)); // step 10
      const pieces = await repo.lockPieces(pieceIds(lines)); // step 10b
      const heldPets = pets.filter((p) => p.state === 'in-trade');
      await repo.moveSquishies(
        heldPets.map((p) => p.id),
        user.id,
        'active',
      );
      const offerIds = new Set(rows.map((m) => m.offerId));
      await repo.movePieces(
        pieces
          .filter((p) => p.heldByOfferId !== null && offerIds.has(p.heldByOfferId))
          .map((p) => p.id),
        user.id,
        null,
      );
      const items = itemCounts(lines);
      await lockGrantRows(tx, mapId, [{ userId: user.id, items }]); // step 11
      for (const row of rows) {
        const counts = itemCounts(row.lines);
        if (hasAny(counts)) {
          await grantItems(tx, { mapId, userId: user.id }, counts, 'trade', row.offerId);
        }
      }
      const spawns = createSpawnsRepo(tx);
      for (const pet of heldPets) await spawns.markCaught(mapId, user.id, pet.speciesId, at);

      await repo.pickedUp(
        rows.map((m) => m.id),
        at,
        tile.id,
      );
      await repo.setStatus(
        gifts.map((g) => g.id),
        'accepted',
        at,
      );
      for (const row of rows) {
        await repo.ledger({
          mapId,
          offerId: row.offerId,
          event: 'picked-up',
          actorUserId: user.id,
          at,
        });
      }
      for (const gift of gifts) {
        events.push({
          mapId,
          type: 'gift.collected',
          actorUserId: user.id,
          payload: { offerId: gift.id, fromUserId: gift.fromUserId, toUserId: gift.toUserId },
        });
      }
      events.push({
        mapId,
        type: 'mailbox.collected',
        actorUserId: user.id,
        payload: { userId: user.id, mailboxIds: rows.map((m) => m.id), offerIds: [...offerIds] },
      });
    });
    return viewOf(db, mapId, user.id);
  };

  /** Calls off these open offers (locked by `lock`), with `reason`. */
  const callOff = (
    mapId: string,
    actorUserId: string | null,
    reason: 'trading-off' | 'left',
    lock: (repo: TradesRepo) => Promise<OfferRow[]>,
    tail?: (tx: Transaction, events: NewGameEvent[]) => Promise<void>,
  ) =>
    run(async (tx, events) => {
      const at = now();
      const offers = await lock(createTradesRepo(tx));
      await sendBack(tx, offers, 'cancelled', actorUserId, at);
      for (const o of offers) {
        events.push({
          mapId,
          type: 'trade.cancelled',
          actorUserId,
          payload: { offerId: o.id, fromUserId: o.fromUserId, toUserId: o.toUserId, reason },
        });
      }
      await tail?.(tx, events);
    });

  return {
    view,
    shelf,
    devConnect,
    send,
    accept,
    decline: (user, mapId, offerId) => answerNo(user, mapId, offerId, 'to'),
    cancel: (user, mapId, offerId) => answerNo(user, mapId, offerId, 'from'),
    pickup,

    setTrading: async (user, mapId, on) => {
      const { map, role } = await requireMember(db, user, mapId);
      if (role !== 'owner') throw new AppError('FORBIDDEN', MESSAGES.notOwner);
      if (map.tradingEnabled === on) return on;
      await callOff(
        mapId,
        user.id,
        'trading-off',
        (repo) => (on ? Promise.resolve([]) : repo.lockOpenOffers(mapId, {})),
        async (tx, events) => {
          const repo = createTradesRepo(tx);
          if ((await repo.tradingEnabled(mapId)) === on) return;
          await repo.setTrading(mapId, on);
          events.push({
            mapId,
            type: 'map.updated',
            actorUserId: user.id,
            payload: { pvpMode: map.pvpMode, tradingEnabled: on },
          });
        },
      );
      return on;
    },

    memberLeft: async (mapId, userId) => {
      await callOff(mapId, userId, 'left', (repo) => repo.lockOpenOffers(mapId, { userId }));
    },
  };
}
