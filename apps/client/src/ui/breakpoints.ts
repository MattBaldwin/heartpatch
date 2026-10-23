// The one list of screen-shape breakpoints (controls D). CSS can't read a
// variable inside `@media`, so the values live here as documented constants
// and `breakpoints.test.ts` fails any stylesheet whose `@media` height or
// orientation query uses a value that isn't listed. Spell a query out in CSS
// exactly as its constant reads; use the constant itself for `matchMedia`.

/**
 * A phone on its side: iPhone SE 667×375, iPhone 15 844×390, Pro Max 932×430.
 * Short enough that a bottom card or a column of rows has no room, wide enough
 * to rule out a portrait phone. Not an iPad (1024×768 and up).
 */
export const LANDSCAPE_PHONE_QUERY = '(max-height: 520px) and (min-width: 640px)';

/** The `max-height` px of the landscape-phone query above. */
export const LANDSCAPE_PHONE_MAX_HEIGHT = 520;

/**
 * Every `max-height` step a stylesheet may use, in px. 520 is the landscape
 * phone; the rest are portrait-phone steps (Safari's bars showing, an SE) that
 * predate this file. Add a step here, with the screen it is for, before using it.
 */
export const MAX_HEIGHT_STEPS = [
  520, // landscape phone (LANDSCAPE_PHONE_QUERY)
  600, // the shortest portrait screens
  700, // iPhone SE, or a phone in a Safari tab
  740, // a phone in a Safari tab
  840, // an iPhone 15 with Safari's bars
  880, // a tall phone with Safari's bars
] as const;

/** Every `min-height` px a stylesheet may use. */
export const MIN_HEIGHT_STEPS = [
  900, // an iPad (the house's big layout)
] as const;

/** The `orientation` values a stylesheet may use (a phone on its side is the query above, not this alone). */
export const ORIENTATIONS = ['landscape'] as const;

/** True while the screen is a phone on its side. */
export function isLandscapePhone(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia(LANDSCAPE_PHONE_QUERY).matches
  );
}
