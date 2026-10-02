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

/**
 * The views live sync sends: one per type in the shared event registry
 * (`packages/shared/src/schemas/events.ts`), built from that type's `public`
 * schema. **Default deny:** a type that isn't registered has no entry and is
 * not broadcast (clients just move their cursor past it). A type that needs a
 * per-recipient view (e.g. a private event) overrides its entry here.
 */
export const PUBLIC_VIEWS: PublicViews = Object.fromEntries(
  GAME_EVENT_TYPES.map((type) => [type, registryView(type)]),
);

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
