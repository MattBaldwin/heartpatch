import { PUSH_RULES, PushPayloadSchema, type PushKind } from '@heartpatch/shared';

// What the service worker shows for a push (#726 plan, "Service worker").
// Pure, so it's unit-tested; the worker must never throw on a bad push.
// The words are the server's (`PUSH_TEXT`, kid-safe at the source): the
// client never builds nudge text.

/** What `showNotification` gets. */
export interface NudgeNotification {
  title: string;
  body: string;
  tag: string;
  /** Read back by `notificationclick`: the patch to open. */
  data: { mapId: string | null; kind: PushKind | null };
}

/**
 * Shown when a push can't be read. iOS ends a subscription after a few pushes
 * that show nothing, so every push shows something (#726 plan, "No silent push").
 */
export const FALLBACK_NUDGE: NudgeNotification = {
  title: 'Heartpatch has news 💛',
  body: 'Come take a peek!',
  tag: 'heartpatch',
  data: { mapId: null, kind: null },
};

/**
 * The notification for a push's data (its text, or already-parsed JSON), or
 * null when it isn't a payload this client knows: not JSON, over
 * `PUSH_RULES.maxPayloadBytes`, or not the shared `PushPayloadSchema`.
 */
export function notificationOf(data: unknown): NudgeNotification | null {
  let value = data;
  if (typeof data === 'string') {
    // Characters, not bytes, but a UTF-8 byte is never shorter than a character.
    if (data.length > PUSH_RULES.maxPayloadBytes) return null;
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const parsed = PushPayloadSchema.safeParse(value);
  if (!parsed.success) return null;
  const { title, body, tag, mapId, kind } = parsed.data;
  return { title, body, tag, data: { mapId, kind } };
}

/** `notificationOf`, or the fallback: what the worker always shows. */
export function nudgeFor(data: unknown): NudgeNotification {
  return notificationOf(data) ?? FALLBACK_NUDGE;
}

/** The patch a clicked notification names (its `data.mapId`), or null. */
export function mapIdOf(notificationData: unknown): string | null {
  if (typeof notificationData !== 'object' || notificationData === null) return null;
  const { mapId } = notificationData as { mapId?: unknown };
  return typeof mapId === 'string' && mapId.length > 0 ? mapId : null;
}
