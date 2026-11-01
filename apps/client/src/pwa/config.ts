/** Installed-app tunables (issue #26). */

// TUNE: how often a long-running app checks for a new version. iOS keeps a
// home-screen app alive in the background for days, so it can't rely on reloads.
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;

// TUNE: coming back to the app checks again, but not more often than this.
export const UPDATE_CHECK_MIN_GAP_MS = 60_000;

// TUNE: away from the app at least this long, a waiting version is applied on
// return without asking (a fresh start is expected after a break).
export const UPDATE_APPLY_AFTER_HIDDEN_MS = 5 * 60_000;

/** localStorage key: the Add to Home Screen guide was dismissed on this browser. */
export const INSTALL_GUIDE_SEEN_KEY = 'heartpatch.installGuideSeen';

/** localStorage key: when this device last re-sent its push subscription (#726 self-heal). */
export const PUSH_HEALED_AT_KEY = 'heartpatch.pushHealedAt';

// TUNE: the start-up self-heal re-sends the subscription at most this often.
export const PUSH_HEAL_INTERVAL_MS = 24 * 60 * 60_000;

// TUNE: how long push helpers wait for the service worker before giving up
// (it never comes on the dev server).
export const PUSH_READY_TIMEOUT_MS = 5000;

// TUNE: logout waits at most this long to unsubscribe this device's push.
export const PUSH_LOGOUT_TIMEOUT_MS = 1500;

/** localStorage key: the nudge offer card (#726) was answered on this device; it never asks again. */
export const PUSH_OFFERED_KEY = 'heartpatch.pushOffered';

// TUNE: how often a nudge offer that found the screen busy looks again.
export const PUSH_OFFER_RETRY_MS = 3000;
