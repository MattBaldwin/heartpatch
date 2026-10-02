import type { z } from 'zod';
import type { GameEvent } from '../db/game-events.js';

/**
 * Game event types from tech spec §5. A stand-in until the shared event
 * registry (`packages/shared/src/schemas/events.ts`, issue #4) lands; then
 * this list should come from there.
 */
export const GAME_EVENT_TYPES = [
  'tile.updated',
  'raid.resolved',
  'building.updated',
  'squishy.updated',
  'hollow.nightfall',
  'member.joined',
  'member.left',
  'chat.quick',
  'milestone.earned',
] as const;
export type GameEventType = (typeof GAME_EVENT_TYPES)[number];

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
 * The views live sync sends. **Default deny:** an event type with no entry is
 * not broadcast (clients just move their cursor past it). Each module adds the
 * view for the event types it writes, next to the event's internal schema.
 */
export const PUBLIC_VIEWS = {} as const satisfies Partial<Record<GameEventType, PublicView>>;

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
