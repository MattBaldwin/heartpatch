import { z } from 'zod';

/*
 * Push nudges (#726 plan, "Server" and "Kid safety"). A player's phone can
 * subscribe, unsubscribe and set four on/off switches; the server decides
 * every send from stored timestamps. Routes (`/api/v1/push`, #726b) answer
 * NOT_FOUND while `HP_PUSH` is off for the player, which the client reads as
 * "no nudges here".
 */

/** The five nudges. `push_sends.kind` holds these (its CHECK lists them). */
export const PushKindSchema = z.enum([
  'dusk',
  'gatherers',
  'friend',
  'long-night-soon',
  'long-night-start',
]);
export type PushKind = z.infer<typeof PushKindSchema>;

/**
 * The player's switches, one per kind of nudge (`longNight` covers both Long
 * Night calls). Server-side, so they follow the account across devices; an
 * account with no `push_settings` row has them all on.
 */
export const PushSettingsSchema = z.strictObject({
  dusk: z.boolean(),
  gatherers: z.boolean(),
  friend: z.boolean(),
  longNight: z.boolean(),
});
export type PushSettings = z.infer<typeof PushSettingsSchema>;

/** `PUT /push/settings`: the switches to change; at least one. */
export const PushSettingsPatchSchema = PushSettingsSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: 'change at least one setting' },
);
export type PushSettingsPatch = z.infer<typeof PushSettingsPatchSchema>;

/** A push service's URL. Always `https:`; real ones are well under 1 KB. */
export const PushEndpointSchema = z.url({ protocol: /^https$/ }).max(2048);

/** A base64url string (RFC 4648 §5, no padding), as `PushSubscription.toJSON()` gives. */
const base64Url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/);

/**
 * `PUT /push/subscription`: this device's `PushSubscription.toJSON()`, tied
 * to the session that sent it. `replaces` is the endpoint this one took over
 * from (a `pushsubscriptionchange`), deleted if it's mine.
 */
export const PushSubscribeRequestSchema = z.strictObject({
  endpoint: PushEndpointSchema,
  keys: z.strictObject({
    // The device's P-256 public key: 65 bytes, 87 characters.
    p256dh: base64Url(128),
    // The 16-byte auth secret: 22 characters.
    auth: base64Url(64),
  }),
  // Milliseconds since the epoch; browsers almost always send null.
  expirationTime: z.number().int().nonnegative().nullable().optional(),
  replaces: PushEndpointSchema.optional(),
});
export type PushSubscribeRequest = z.infer<typeof PushSubscribeRequestSchema>;

/** `DELETE /push/subscription`: idempotent, and only ever my own row. */
export const PushUnsubscribeRequestSchema = z.strictObject({ endpoint: PushEndpointSchema });
export type PushUnsubscribeRequest = z.infer<typeof PushUnsubscribeRequestSchema>;

/** `GET /push`: the key a device subscribes with, and my switches. */
export const PushStatusResponseSchema = z.object({
  vapidPublicKey: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
  settings: PushSettingsSchema,
});
export type PushStatusResponse = z.infer<typeof PushStatusResponseSchema>;

/** `PUT` and `DELETE /push/subscription`. */
export const PushOkResponseSchema = z.object({ ok: z.literal(true) });
export type PushOkResponse = z.infer<typeof PushOkResponseSchema>;

/**
 * What a nudge carries to the service worker (kid safety, rule 9): text
 * from `PUSH_TEXT` only, plus the patch to open. No account id, session,
 * squishy or secret. `tag` lets a newer nudge of the same kind replace an
 * older one on the lock screen. `v` lets the worker skip a shape it doesn't
 * know.
 */
export const PushPayloadSchema = z.object({
  v: z.literal(1),
  kind: PushKindSchema,
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(160),
  mapId: z.uuid().nullable(),
  tag: z.string().min(1).max(128),
});
export type PushPayload = z.infer<typeof PushPayloadSchema>;
