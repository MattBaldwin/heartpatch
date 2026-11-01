import type { PushKind } from '@heartpatch/shared';

// What the service worker shows for a push (#726 plan, "Service worker").
// Pure, so it's unit-tested; the worker must never throw on a bad push.
// It checks the shared `PushPayloadSchema` by hand, without zod, so the
// worker stays small (13 KB rather than 107 KB); push-payload.test.ts keeps
// the two in step. Only type imports from `@heartpatch/shared` here.
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

/** `PushKindSchema.options` (a test checks they match). */
export const PUSH_KINDS: readonly PushKind[] = [
  'dusk',
  'gatherers',
  'friend',
  'long-night-soon',
  'long-night-start',
];

/** `PUSH_RULES.maxPayloadBytes` (a test checks they match). */
export const MAX_PAYLOAD_BYTES = 2_048;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= max ? value : null;
}

function isKind(value: unknown): value is PushKind {
  return PUSH_KINDS.some((kind) => kind === value);
}

/**
 * The notification for a push's data (its text, or already-parsed JSON), or
 * null when it isn't a payload this client knows: not JSON, over
 * `PUSH_RULES.maxPayloadBytes`, or not the shared `PushPayloadSchema`'s shape.
 */
export function notificationOf(data: unknown): NudgeNotification | null {
  let value = data;
  if (typeof data === 'string') {
    // Characters, not bytes, but a UTF-8 byte is never shorter than a character.
    if (data.length > MAX_PAYLOAD_BYTES) return null;
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const title = text(payload['title'], 80);
  const body = text(payload['body'], 160);
  const tag = text(payload['tag'], 128);
  const { v, kind, mapId } = payload;
  if (v !== 1 || !isKind(kind) || title === null || body === null || tag === null) return null;
  if (mapId !== null && !(typeof mapId === 'string' && UUID.test(mapId))) return null;
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
