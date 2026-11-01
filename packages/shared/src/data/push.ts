import type { PushKind } from '../schemas/push.js';
import {
  PUSH_NAME_PLACEHOLDER,
  type PushLine,
  type PushRules,
  type PushText,
} from '../schemas/data/push.js';

/**
 * Push nudges' public rules (#726 plan, owner answers 2026-11-01). Checked
 * by `checkPushRules` in tests; the server enforces every one.
 */
export const PUSH_RULES: PushRules = {
  quietHours: { from: 21 * 60, to: 7 * 60 }, // TUNE: owner answer 3, 9 PM–7 AM in the player's zone
  dailyCap: 3, // TUNE: nudges per account per day
  // TUNE: the Long Night calls first, then dusk (a squishy at risk), then chores, then friends.
  priority: ['long-night-start', 'long-night-soon', 'dusk', 'gatherers', 'friend'],
  duskLeadMinutes: 60, // TUNE: an hour before nightfall, time to light a fire
  longNightLeadMinutes: 60, // TUNE: the Long Night's "coming" call, an hour ahead
  longNightStartWindowMinutes: 10, // TUNE: a late "begun" call is noise
  gatherersIdleMinutes: 30, // TUNE: done half an hour before we nudge
  friendAwayMinutes: 10, // TUNE: only patch-mates who've been gone a while
  friendArriverAwayMinutes: 5, // TUNE: under this, the arriver just reopened the app
  friendRepeatHours: 2, // TUNE: one "Moonberry is here" per friend per two hours
  ttlSeconds: {
    dusk: 55 * 60, // TUNE: stale once night falls
    gatherers: 6 * 60 * 60, // TUNE: the goodies wait
    friend: 20 * 60, // TUNE: they've likely gone by then
    'long-night-soon': 55 * 60, // TUNE: stale once the Night begins
    'long-night-start': 2 * 60 * 60, // TUNE: still worth hearing while the Night runs
  },
  maxDevicesPerAccount: 5, // TUNE: a phone, an iPad and a couple of spares
  maxFailures: 8, // TUNE: failures in a row before a subscription is dropped
  sendLogDays: 14, // TUNE: send log kept a fortnight
  maxPayloadBytes: 2_048, // TUNE: well under Web Push's 4 KB
};

/**
 * Every nudge's words (STYLE_GUIDE §6 toasts; the plan's draft). Checked by
 * `checkPushText`. The Long Night's "It starts at 7" is nightfall
 * (`HOME_BASE_RULES.nightfallMinute`; a test keeps them in step).
 */
export const PUSH_TEXT: PushText = {
  dusk: {
    title: "It's getting dark on your land 🔥",
    body: "Someone's sleeping out tonight. Light a fire?",
  },
  gatherers: { title: 'Your gatherers are done! 🧺', body: 'Come collect the goodies.' },
  friend: { title: `${PUSH_NAME_PLACEHOLDER} is in your patch! 👋`, body: 'Pop in and say hi.' },
  'long-night-soon': { title: 'The Long Night is coming 🌙', body: 'It starts at 7. Fires ready?' },
  'long-night-start': { title: 'The Long Night has begun 🌙', body: 'Keep the fires lit!' },
};

/**
 * A nudge's words with the friend's name filled in. `name` is a username
 * (already through the server filter); only the friend title uses it.
 */
export function pushLineFor(kind: PushKind, name = '', text: PushText = PUSH_TEXT): PushLine {
  const line = text[kind];
  if (kind !== 'friend') return { ...line };
  // A replacer function, so `$&`-style patterns in a name stay literal.
  return { title: line.title.replaceAll(PUSH_NAME_PLACEHOLDER, () => name), body: line.body };
}

/**
 * True when `minuteOfDay` (0–1439, in the player's zone) falls in quiet
 * hours: `from` inclusive, `to` exclusive, wrapping past midnight when
 * `from > to` (9 PM–7 AM).
 */
export function quietHoursContain(
  minuteOfDay: number,
  quietHours: PushRules['quietHours'] = PUSH_RULES.quietHours,
): boolean {
  const { from, to } = quietHours;
  return from < to
    ? minuteOfDay >= from && minuteOfDay < to
    : minuteOfDay >= from || minuteOfDay < to;
}
