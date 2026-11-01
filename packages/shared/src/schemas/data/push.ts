import { z } from 'zod';
import { findAvoidedWords } from '../../data/avoided-words.js';
import { PushKindSchema, type PushKind } from '../push.js';
import { formatDataIssues } from './issues.js';

/** A minute of the day, 0 (midnight) to 1439 (11:59 PM), in the player's time zone. */
const MinuteOfDaySchema = z
  .number()
  .int()
  .min(0)
  .max(24 * 60 - 1);

/**
 * Push nudges' public rules (#726 plan, "Kid safety"). Public: the client can
 * explain them in Settings; the server enforces every one when it decides
 * a send.
 */
export const PushRulesSchema = z
  .strictObject({
    /**
     * No nudge from `from` until `to`, in the player's `users.time_zone`
     * (owner answer 3). Wraps past midnight when `from > to`. A nudge that
     * comes due in quiet hours is dropped, not held.
     */
    quietHours: z.strictObject({ from: MinuteOfDaySchema, to: MinuteOfDaySchema }),
    /** At most this many nudges per account per account-local day. */
    dailyCap: z.number().int().min(1).max(10),
    /** When the cap is near, the sweep sends the earliest kind here first. Every kind, once. */
    priority: z.array(PushKindSchema).length(PushKindSchema.options.length),
    /** The dusk nudge (and the Long Night's "coming" call) goes this long before nightfall. */
    duskLeadMinutes: z.number().int().min(5).max(180),
    /** The Long Night's "begun" call goes within this long after nightfall, or not at all. */
    longNightStartWindowMinutes: z.number().int().min(1).max(60),
    /** Gatherers are done this long before the nudge (so a kid who's about to look isn't nagged). */
    gatherersIdleMinutes: z.number().int().min(0).max(240),
    /** A friend nudge only to a patch-mate who's been away from the patch this long. */
    friendAwayMinutes: z.number().int().min(1).max(120),
    /** An arriver away less than this is a tab resume, not an arrival. */
    friendArriverAwayMinutes: z.number().int().min(1).max(120),
    /** One friend nudge per recipient per arriver in this many hours. */
    friendRepeatHours: z.number().int().min(1).max(24),
    /** How long a push service keeps trying to deliver each kind (Web Push `TTL`), in seconds. */
    ttlSeconds: z.strictObject(
      Object.fromEntries(
        PushKindSchema.options.map((kind) => [kind, z.number().int().min(60).max(86_400)]),
      ) as Record<PushKind, z.ZodNumber>,
    ),
    /** A player's devices; past this the one heard from least recently goes. */
    maxDevicesPerAccount: z.number().int().min(1).max(20),
    /** A subscription that failed this many times in a row is deleted. */
    maxFailures: z.number().int().min(1).max(50),
    /** `push_sends` rows are kept this many days (caps and windows need a day; ops a fortnight). */
    sendLogDays: z.number().int().min(2).max(90),
    /** The JSON payload's most bytes (Web Push carries 4 KB after encryption overhead). */
    maxPayloadBytes: z.number().int().min(256).max(3_000),
  })
  .refine((rules) => new Set(rules.priority).size === rules.priority.length, {
    path: ['priority'],
    message: 'list every kind once',
  })
  .refine((rules) => rules.quietHours.from !== rules.quietHours.to, {
    path: ['quietHours'],
    message: 'from and to are the same minute',
  });
export type PushRules = z.infer<typeof PushRulesSchema>;

/** A nudge's words: one short upbeat line and a nudge to act (STYLE_GUIDE §6, toasts). */
export const PushLineSchema = z.strictObject({
  title: z.string().trim().min(1).max(48),
  body: z.string().trim().min(1).max(80),
});
export type PushLine = z.infer<typeof PushLineSchema>;

/**
 * Every nudge's words, by kind. Only the friend nudge names anyone: `{name}`
 * in its title is the arriving patch-mate's username, which passed the
 * server filter at signup (owner answer 1). No other placeholder exists, so
 * nothing else user-typed can reach a lock screen.
 */
export const PushTextSchema = z.strictObject(
  Object.fromEntries(PushKindSchema.options.map((kind) => [kind, PushLineSchema])) as Record<
    PushKind,
    typeof PushLineSchema
  >,
);
export type PushText = z.infer<typeof PushTextSchema>;

/** The one placeholder a nudge may hold. */
export const PUSH_NAME_PLACEHOLDER = '{name}';

/** Validates push nudges' public rules and returns readable problems, or `[]`. */
export function checkPushRules(input: unknown): string[] {
  const result = PushRulesSchema.safeParse(input);
  return result.success ? [] : formatDataIssues(input, result.error);
}

/**
 * Validates the nudges' words and returns readable problems, or `[]`: the
 * shape, the style guide's avoided words, and `{name}` only in the friend
 * title (exactly once) and nowhere else.
 */
export function checkPushText(input: unknown): string[] {
  const result = PushTextSchema.safeParse(input);
  if (!result.success) return formatDataIssues(input, result.error);
  const problems: string[] = [];
  for (const kind of PushKindSchema.options) {
    for (const field of ['title', 'body'] as const) {
      const text = result.data[kind][field];
      const path = `${kind}.${field}`;
      for (const word of findAvoidedWords(text.toLowerCase())) {
        problems.push(`${path}: avoided words: ${word}`);
      }
      const names = text.split(PUSH_NAME_PLACEHOLDER).length - 1;
      const wanted = kind === 'friend' && field === 'title' ? 1 : 0;
      if (names !== wanted) {
        problems.push(
          `${path}: needs ${PUSH_NAME_PLACEHOLDER} ${String(wanted)} time(s), has ${String(names)}`,
        );
      }
      const others = text.replaceAll(PUSH_NAME_PLACEHOLDER, '').match(/\{[^}]*\}/g);
      if (others) problems.push(`${path}: unknown placeholder ${others.join(', ')}`);
    }
  }
  return problems;
}
