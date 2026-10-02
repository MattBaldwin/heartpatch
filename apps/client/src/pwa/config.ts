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
