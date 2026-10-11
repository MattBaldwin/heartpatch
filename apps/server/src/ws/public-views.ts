import {
  GAME_EVENT_TYPES,
  GAME_EVENTS,
  parseGameEventPayload,
  type GameEventType,
} from '@heartpatch/shared';
import type { z } from 'zod';
import type { GameEvent } from '../db/game-events.js';

/** Who a view is being built for. */
export interface ViewRecipient {
  userId: string;
}

/**
 * How one event type looks to players (tech spec §7 "Public vs internal
 * payloads"). `game_events.payload` is internal and may hold server-only
 * detail, so it is never sent as is.
 *
 * - `build` returns the view for one recipient, or null to send them nothing
 *   (e.g. a private event meant for one player). The payload arrives as
 *   stored (`unknown`); parse it with the event's internal schema.
 * - `schema` is a `z.object` the result is parsed with before sending.
 *   Unknown keys are stripped, so a careless `{ ...payload }` in `build`
 *   still can't leak an internal field. Avoid `z.record`, `z.unknown` and
 *   `.loose()` in it, which would let them through.
 */
export interface PublicView<S extends z.ZodObject = z.ZodObject> {
  schema: S;
  build: (event: GameEvent, recipient: ViewRecipient) => z.input<S> | null;
}

/** Public views by event type. A type without one is never broadcast. */
export type PublicViews = Readonly<Partial<Record<string, PublicView>>>;

/** Typed helper so `build`'s return type is checked against `schema`. */
export function definePublicView<S extends z.ZodObject>(view: PublicView<S>): PublicView {
  return view;
}

/**
 * The view every member gets for a registry event: the stored payload checked
 * against its internal schema, then cut down to its `public` schema.
 */
function registryView(type: GameEventType): PublicView {
  return definePublicView({
    schema: GAME_EVENTS[type].public,
    build: (event) => parseGameEventPayload(type, event.payload),
  });
}

/** A registry view sent only to the player the event is about (`payload.userId`). */
function ownerOnlyView(
  type:
    | 'squishy.hollowed'
    | 'squishy.rescued'
    | 'team.picked'
    | 'journey.started'
    | 'journey.ended'
    | 'mailbox.collected',
): PublicView {
  return definePublicView({
    schema: GAME_EVENTS[type].public,
    build: (event, recipient) => {
      const payload = parseGameEventPayload(type, event.payload);
      return payload.userId === recipient.userId ? payload : null;
    },
  });
}

/**
 * A registry view sent only to an offer's or an ask's two players
 * (`fromUserId`, `toUserId`; trades #271, friendly battles and live defense #29).
 */
function twoPlayerView(
  type:
    | 'trade.offered'
    | 'trade.cancelled'
    | 'trade.expired'
    | 'challenge.sent'
    | 'challenge.answered'
    | 'challenge.cancelled'
    | 'defense.prompted'
    | 'defense.answered',
): PublicView {
  return definePublicView({
    schema: GAME_EVENTS[type].public,
    build: (event, recipient) => {
      const payload = parseGameEventPayload(type, event.payload);
      const theirs = [payload.fromUserId, payload.toUserId].includes(recipient.userId);
      return theirs ? payload : null;
    },
  });
}

/** A live battle's view (#29): only its two players (`aUserId`, `bUserId`) hear it. */
function livePairView(type: 'battle.picked' | 'battle.turned' | 'battle.cheered'): PublicView {
  return definePublicView({
    schema: GAME_EVENTS[type].public,
    build: (event, recipient) => {
      const payload = parseGameEventPayload(type, event.payload);
      const theirs = [payload.aUserId, payload.bUserId].includes(recipient.userId);
      return theirs ? payload : null;
    },
  });
}

/**
 * A trade's answer (#271): the two players hear which, with the offer; everyone
 * else hears only that a trade happened, and nothing of a "no thanks".
 */
const tradeAnsweredView = definePublicView({
  schema: GAME_EVENTS['trade.answered'].public,
  build: (event, recipient) => {
    const payload = parseGameEventPayload('trade.answered', event.payload);
    if ([payload.fromUserId, payload.toUserId].includes(recipient.userId)) return payload;
    if (payload.answer !== 'accepted') return null;
    const { fromUserId, toUserId, answer } = payload;
    return { fromUserId, toUserId, answer };
  },
});

/**
 * The views live sync sends: one per type in the shared event registry
 * (`packages/shared/src/schemas/events.ts`), built from that type's `public`
 * schema. **Default deny:** a type that isn't registered has no entry and is
 * not broadcast (clients just move their cursor past it). A type that needs a
 * per-recipient view (e.g. a private event) overrides its entry here.
 */
export const PUBLIC_VIEWS: PublicViews = {
  ...Object.fromEntries(GAME_EVENT_TYPES.map((type) => [type, registryView(type)])),
  // Which squishy the Hollow Man took, or which came home, is the owner's
  // news (#21); everyone sees who lost someone in `hollow.nightfall`.
  'squishy.hollowed': ownerOnlyView('squishy.hollowed'),
  'squishy.rescued': ownerOnlyView('squishy.rescued'),
  // A player's battle team is their own business (squishy jobs).
  'team.picked': ownerOnlyView('team.picked'),
  // Journeys (#270): only the player; everyone else sees `battle.*`.
  'journey.started': ownerOnlyView('journey.started'),
  'journey.ended': ownerOnlyView('journey.ended'),
  // Trades (#271): what an offer holds is the two players' business; others
  // hear "Lee and Sam traded!" and "Sam got a gift from Lee", never what.
  'trade.offered': twoPlayerView('trade.offered'),
  'trade.answered': tradeAnsweredView,
  'trade.cancelled': twoPlayerView('trade.cancelled'),
  'trade.expired': twoPlayerView('trade.expired'),
  'mailbox.collected': ownerOnlyView('mailbox.collected'),
  // A live battle's turns and cheers (#29) are its two players' business;
  // everyone else sees `battle.started` and `battle.ended`.
  // "Battle me?" (#29): the two Keepers' business; others see the battle start.
  'challenge.sent': twoPlayerView('challenge.sent'),
  'challenge.answered': twoPlayerView('challenge.answered'),
  'challenge.cancelled': twoPlayerView('challenge.cancelled'),
  'defense.prompted': twoPlayerView('defense.prompted'),
  'defense.answered': twoPlayerView('defense.answered'),
  'battle.picked': livePairView('battle.picked'),
  'battle.turned': livePairView('battle.turned'),
  'battle.cheered': livePairView('battle.cheered'),
};

/**
 * The public view of `event` for `recipient`, or null when they get nothing:
 * no view for this type, or `build` chose to skip them.
 */
export function publicViewFor(
  views: PublicViews,
  event: GameEvent,
  recipient: ViewRecipient,
): Record<string, unknown> | null {
  const view = Object.hasOwn(views, event.type) ? views[event.type] : undefined;
  if (!view) return null;
  const built = view.build(event, recipient);
  if (built === null) return null;
  return view.schema.parse(built);
}
